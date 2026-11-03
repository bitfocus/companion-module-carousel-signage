import { PlayerOperationQueue } from './player-queue.js'
import type {
	CarouselApi,
	OverrideScheduleMode,
	RestorePolicy,
	ScheduleBehavior,
	TimedOverrideRecord,
} from './types.js'

const MAX_TIMER_DELAY_MS = 2_147_000_000
const RESTORE_RETRY_MS = 30_000

export interface OverrideManagerHooks {
	persist: (records: TimedOverrideRecord[]) => void | Promise<void>
	onStateChanged?: () => void
	log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
	now?: () => number
}

export interface TimedOverrideRequest {
	playerId: number
	channelId: number
	durationMs: number
	scheduleMode: OverrideScheduleMode
	restorePolicy: RestorePolicy
}

export class TimedOverrideManager {
	private readonly records = new Map<number, TimedOverrideRecord>()
	private readonly timers = new Map<number, NodeJS.Timeout>()
	private readonly now: () => number
	private destroyed = false

	constructor(
		private readonly api: CarouselApi,
		private readonly hooks: OverrideManagerHooks,
		private readonly queue = new PlayerOperationQueue(),
	) {
		this.now = hooks.now ?? Date.now
	}

	getRecords(): TimedOverrideRecord[] {
		return [...this.records.values()].map((record) => ({ ...record })).sort((a, b) => a.playerId - b.playerId)
	}

	getRecord(playerId: number): TimedOverrideRecord | undefined {
		const record = this.records.get(playerId)
		return record ? { ...record } : undefined
	}

	hasActiveOverride(playerId: number): boolean {
		return this.records.has(playerId)
	}

	async recover(records: TimedOverrideRecord[]): Promise<void> {
		if (this.destroyed) return
		this.clearTimers()
		this.records.clear()
		for (const record of records) {
			if (isValidRecord(record)) this.records.set(record.playerId, { ...record })
			else this.hooks.log?.('warn', 'Ignored an invalid persisted timed override record')
		}
		await this.persistAndNotify()
		for (const record of this.records.values()) this.schedule(record)
	}

	async setPermanent(playerId: number, channelId: number, scheduleBehavior: ScheduleBehavior): Promise<void> {
		await this.queue.run(playerId, async () => {
			this.assertRunning()
			await this.api.updatePlayerRouting(playerId, {
				defaultChannelId: channelId,
				channelScheduleId: scheduleBehavior === 'remove' ? null : undefined,
			})
			if (this.records.delete(playerId)) {
				this.clearTimer(playerId)
				await this.persistAndNotify()
				this.hooks.log?.('info', `Player ${playerId}: permanent routing replaced the active timed override`)
			}
		})
	}

	async setTimedOverride(request: TimedOverrideRequest): Promise<void> {
		if (!Number.isFinite(request.durationMs) || request.durationMs <= 0)
			throw new Error('Override duration must be positive')

		await this.queue.run(request.playerId, async () => {
			this.assertRunning()
			const previous = this.records.get(request.playerId)
			const player = previous ? undefined : await this.api.getPlayer(request.playerId)
			this.assertRunning()
			const originalDefaultChannelId = previous?.originalDefaultChannelId ?? player?.DefaultChannelID ?? null
			if (originalDefaultChannelId === null) {
				throw new Error(`Player ${request.playerId} has no DefaultChannelID to restore after a timed override`)
			}
			const next: TimedOverrideRecord = {
				playerId: request.playerId,
				originalDefaultChannelId,
				originalChannelScheduleId: previous?.originalChannelScheduleId ?? player?.ChannelScheduleID ?? null,
				temporaryChannelId: request.channelId,
				expiresAt: this.now() + request.durationMs,
				scheduleMode: request.scheduleMode,
				restorePolicy: request.restorePolicy,
				pendingChannelIds: previous
					? [...new Set([previous.temporaryChannelId, ...(previous.pendingChannelIds ?? [])])]
					: [],
			}

			this.records.set(request.playerId, next)
			try {
				await this.persistAndNotify()
			} catch (error) {
				if (previous) this.records.set(request.playerId, previous)
				else this.records.delete(request.playerId)
				throw error
			}

			try {
				this.assertRunning()
				await this.api.updatePlayerRouting(request.playerId, {
					defaultChannelId: request.channelId,
					channelScheduleId: request.scheduleMode === 'suspend' ? null : next.originalChannelScheduleId,
				})
			} catch (error) {
				// A timeout or server error does not prove the write was rejected.
				// Keep the durable baseline and both possible conditional targets.
				this.schedule(next)
				throw error
			}

			delete next.pendingChannelIds
			this.schedule(next)
			await this.persistAndNotify()
			this.hooks.log?.(
				'info',
				`Player ${request.playerId}: timed override to channel ${request.channelId} until ${new Date(next.expiresAt).toISOString()}`,
			)
		})
	}

	async restoreNow(playerId: number): Promise<boolean> {
		return this.restore(playerId, 'manual')
	}

	async destroy(): Promise<void> {
		this.destroyed = true
		this.clearTimers()
		await this.queue.idle()
	}

	private assertRunning(): void {
		if (this.destroyed) throw new Error('Carousel connection is stopping')
	}

	private async restore(playerId: number, reason: 'expired' | 'manual', expectedExpiresAt?: number): Promise<boolean> {
		return this.queue.run(playerId, async () => {
			if (this.destroyed) return false
			const record = this.records.get(playerId)
			if (!record) return false
			if (expectedExpiresAt !== undefined && record.expiresAt !== expectedExpiresAt) return false
			if (reason === 'expired' && record.expiresAt > this.now()) {
				this.schedule(record)
				return false
			}

			try {
				if (record.restorePolicy === 'ifUnchanged') {
					const current = await this.api.getPlayer(playerId)
					if (this.destroyed) return false
					if (
						current.DefaultChannelID !== record.temporaryChannelId &&
						!record.pendingChannelIds?.includes(current.DefaultChannelID ?? -1)
					) {
						this.records.delete(playerId)
						this.clearTimer(playerId)
						await this.persistAndNotify()
						this.hooks.log?.(
							'warn',
							`Player ${playerId}: skipped timed restore because its default channel changed externally`,
						)
						return false
					}
				}

				if (record.originalDefaultChannelId === null) {
					throw new Error(`Player ${playerId} had no original DefaultChannelID to restore`)
				}
				await this.api.updatePlayerRouting(playerId, {
					defaultChannelId: record.originalDefaultChannelId,
					channelScheduleId: record.originalChannelScheduleId,
				})
				this.records.delete(playerId)
				this.clearTimer(playerId)
				await this.persistAndNotify()
				this.hooks.log?.('info', `Player ${playerId}: restored the pre-override channel and schedule`)
				return true
			} catch (error) {
				this.records.set(playerId, record)
				this.hooks.log?.(
					'error',
					`Player ${playerId}: timed restore failed; retaining the snapshot and retrying in 30 seconds: ${errorMessage(error)}`,
				)
				this.scheduleRetry(record, reason)
				throw error
			}
		})
	}

	private schedule(record: TimedOverrideRecord): void {
		if (this.destroyed) return
		this.clearTimer(record.playerId)
		const remaining = record.expiresAt - this.now()
		if (remaining <= 0) {
			queueMicrotask(() => void this.restore(record.playerId, 'expired', record.expiresAt).catch(() => undefined))
			return
		}
		const timer = setTimeout(
			() => {
				if (remaining > MAX_TIMER_DELAY_MS) this.schedule(record)
				else void this.restore(record.playerId, 'expired', record.expiresAt).catch(() => undefined)
			},
			Math.min(remaining, MAX_TIMER_DELAY_MS),
		)
		this.timers.set(record.playerId, timer)
	}

	private scheduleRetry(record: TimedOverrideRecord, reason: 'expired' | 'manual'): void {
		if (this.destroyed) return
		this.clearTimer(record.playerId)
		const timer = setTimeout(
			() => void this.restore(record.playerId, reason, record.expiresAt).catch(() => undefined),
			RESTORE_RETRY_MS,
		)
		this.timers.set(record.playerId, timer)
	}

	private clearTimer(playerId: number): void {
		const timer = this.timers.get(playerId)
		if (timer) clearTimeout(timer)
		this.timers.delete(playerId)
	}

	private clearTimers(): void {
		for (const timer of this.timers.values()) clearTimeout(timer)
		this.timers.clear()
	}

	private async persistAndNotify(): Promise<void> {
		await this.hooks.persist(this.getRecords())
		this.hooks.onStateChanged?.()
	}
}

export function isValidRecord(value: TimedOverrideRecord): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		Number.isSafeInteger(value.playerId) &&
		value.playerId >= 0 &&
		Number.isSafeInteger(value.originalDefaultChannelId) &&
		value.originalDefaultChannelId! >= 0 &&
		(value.originalChannelScheduleId === null ||
			(Number.isSafeInteger(value.originalChannelScheduleId) && value.originalChannelScheduleId >= 0)) &&
		Number.isSafeInteger(value.temporaryChannelId) &&
		value.temporaryChannelId >= 0 &&
		(value.pendingChannelIds === undefined ||
			(Array.isArray(value.pendingChannelIds) &&
				value.pendingChannelIds.every((id) => Number.isSafeInteger(id) && id >= 0))) &&
		Number.isFinite(value.expiresAt) &&
		(value.scheduleMode === 'preserve' || value.scheduleMode === 'suspend') &&
		(value.restorePolicy === 'always' || value.restorePolicy === 'ifUnchanged')
	)
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
