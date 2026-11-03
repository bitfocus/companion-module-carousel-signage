import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimedOverrideManager } from '../override-manager.js'
import type { CarouselApi, CarouselChannel, CarouselPlayer, RoutingUpdate, TimedOverrideRecord } from '../types.js'

class FakeApi implements CarouselApi {
	player: CarouselPlayer = {
		id: 90,
		Name: 'Hallway',
		DefaultChannelID: 4,
		CurrentChannelID: 4,
		ChannelScheduleID: 2,
	}
	updates: RoutingUpdate[] = []
	failNextUpdate = false
	delayMs = 0
	activeUpdates = 0
	maxActiveUpdates = 0

	async getPlayers(): Promise<CarouselPlayer[]> {
		return [{ ...this.player }]
	}

	async getPlayer(): Promise<CarouselPlayer> {
		return { ...this.player }
	}

	async getChannels(): Promise<CarouselChannel[]> {
		return []
	}

	async updatePlayerRouting(_playerId: number, update: RoutingUpdate): Promise<void> {
		this.activeUpdates++
		this.maxActiveUpdates = Math.max(this.maxActiveUpdates, this.activeUpdates)
		try {
			if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
			if (this.failNextUpdate) {
				this.failNextUpdate = false
				throw new Error('rejected update')
			}
			this.updates.push({ ...update })
			this.player.DefaultChannelID = update.defaultChannelId
			if (update.channelScheduleId !== undefined) this.player.ChannelScheduleID = update.channelScheduleId
		} finally {
			this.activeUpdates--
		}
	}
}

describe('TimedOverrideManager', () => {
	let api: FakeApi
	let persisted: TimedOverrideRecord[]
	let manager: TimedOverrideManager

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-20T16:00:00Z'))
		api = new FakeApi()
		persisted = []
		manager = createManager(api, (records) => {
			persisted = structuredClone(records)
		})
	})

	afterEach(() => {
		manager.destroy()
		vi.useRealTimers()
	})

	it('performs permanent switching while preserving or removing a schedule', async () => {
		await manager.setPermanent(90, 8, 'preserve')
		await manager.setPermanent(90, 9, 'remove')
		expect(api.updates).toEqual([
			{ defaultChannelId: 8, channelScheduleId: undefined },
			{ defaultChannelId: 9, channelScheduleId: null },
		])
	})

	it('takes a snapshot, applies a temporary channel, and restores channel and schedule', async () => {
		await manager.setTimedOverride({
			playerId: 90,
			channelId: 8,
			durationMs: 60_000,
			scheduleMode: 'suspend',
			restorePolicy: 'always',
		})
		expect(persisted[0]).toMatchObject({
			originalDefaultChannelId: 4,
			originalChannelScheduleId: 2,
			temporaryChannelId: 8,
		})
		expect(api.updates[0]).toEqual({ defaultChannelId: 8, channelScheduleId: null })

		await vi.advanceTimersByTimeAsync(60_000)
		expect(api.updates[1]).toEqual({ defaultChannelId: 4, channelScheduleId: 2 })
		expect(manager.hasActiveOverride(90)).toBe(false)
		expect(persisted).toEqual([])
	})

	it('retains the original snapshot when a timed override is replaced', async () => {
		await manager.setTimedOverride({
			playerId: 90,
			channelId: 8,
			durationMs: 20 * 60_000,
			scheduleMode: 'suspend',
			restorePolicy: 'always',
		})
		await vi.advanceTimersByTimeAsync(5 * 60_000)
		await manager.setTimedOverride({
			playerId: 90,
			channelId: 9,
			durationMs: 10 * 60_000,
			scheduleMode: 'preserve',
			restorePolicy: 'always',
		})

		expect(manager.getRecord(90)).toMatchObject({
			originalDefaultChannelId: 4,
			originalChannelScheduleId: 2,
			temporaryChannelId: 9,
		})
		expect(api.updates[1]).toEqual({ defaultChannelId: 9, channelScheduleId: 2 })
		await vi.advanceTimersByTimeAsync(10 * 60_000)
		expect(api.updates.at(-1)).toEqual({ defaultChannelId: 4, channelScheduleId: 2 })
	})

	it('retains the recovery snapshot when applying an override has an uncertain outcome', async () => {
		api.failNextUpdate = true
		await expect(
			manager.setTimedOverride({
				playerId: 90,
				channelId: 8,
				durationMs: 60_000,
				scheduleMode: 'suspend',
				restorePolicy: 'always',
			}),
		).rejects.toThrow('rejected update')
		expect(manager.hasActiveOverride(90)).toBe(true)
		expect(persisted[0]).toMatchObject({ originalDefaultChannelId: 4, originalChannelScheduleId: 2 })
		await vi.advanceTimersByTimeAsync(60_000)
		expect(api.player).toMatchObject({ DefaultChannelID: 4, ChannelScheduleID: 2 })
	})

	it('retains state and retries after a failed restore', async () => {
		await manager.setTimedOverride({
			playerId: 90,
			channelId: 8,
			durationMs: 60_000,
			scheduleMode: 'suspend',
			restorePolicy: 'always',
		})
		api.failNextUpdate = true
		await expect(manager.restoreNow(90)).rejects.toThrow('rejected update')
		expect(manager.hasActiveOverride(90)).toBe(true)
		await vi.advanceTimersByTimeAsync(30_000)
		await flushMicrotasks()
		expect(manager.hasActiveOverride(90)).toBe(false)
		expect(api.updates.at(-1)).toEqual({ defaultChannelId: 4, channelScheduleId: 2 })
	})

	it('recovers an override that expired while Companion was offline', async () => {
		await manager.recover([
			{
				playerId: 90,
				originalDefaultChannelId: 4,
				originalChannelScheduleId: 2,
				temporaryChannelId: 8,
				expiresAt: Date.now() - 1000,
				scheduleMode: 'suspend',
				restorePolicy: 'always',
			},
		])
		await vi.runAllTicks()
		await flushMicrotasks()
		expect(api.updates.at(-1)).toEqual({ defaultChannelId: 4, channelScheduleId: 2 })
		expect(manager.hasActiveOverride(90)).toBe(false)
	})

	it('skips a conditional restore after an external default-channel change', async () => {
		await manager.setTimedOverride({
			playerId: 90,
			channelId: 8,
			durationMs: 60_000,
			scheduleMode: 'suspend',
			restorePolicy: 'ifUnchanged',
		})
		api.player.DefaultChannelID = 12
		await expect(manager.restoreNow(90)).resolves.toBe(false)
		expect(manager.hasActiveOverride(90)).toBe(false)
		expect(api.updates).toHaveLength(1)
	})

	it('serializes rapid operations against one player', async () => {
		vi.useRealTimers()
		api.delayMs = 15
		const first = manager.setPermanent(90, 8, 'preserve')
		const second = manager.setPermanent(90, 9, 'preserve')
		await Promise.all([first, second])
		expect(api.maxActiveUpdates).toBe(1)
		expect(api.updates.map((update) => update.defaultChannelId)).toEqual([8, 9])
	})

	it('drains an in-flight write and rejects queued writes when stopped', async () => {
		api.delayMs = 50
		const first = manager.setPermanent(90, 8, 'preserve')
		await flushMicrotasks()
		const second = manager.setPermanent(90, 9, 'preserve')
		const rejected = expect(second).rejects.toThrow('stopping')
		const stopped = manager.destroy()
		await vi.advanceTimersByTimeAsync(50)
		await Promise.all([first, rejected, stopped])
		expect(api.updates.map((update) => update.defaultChannelId)).toEqual([8])
	})

	it('ignores malformed persisted records without crashing recovery', async () => {
		await manager.recover([null, {}, { playerId: -1 }] as unknown as TimedOverrideRecord[])
		expect(persisted).toEqual([])
	})

	it('restores a previous conditional target after an unsuccessful replacement', async () => {
		const request = {
			playerId: 90,
			channelId: 8,
			durationMs: 60_000,
			scheduleMode: 'suspend',
			restorePolicy: 'ifUnchanged',
		} as const
		await manager.setTimedOverride(request)
		api.failNextUpdate = true
		await expect(manager.setTimedOverride({ ...request, channelId: 9 })).rejects.toThrow()
		await manager.destroy()
		manager = createManager(api, (records) => {
			persisted = structuredClone(records)
		})
		await manager.recover(persisted)
		await manager.restoreNow(90)
		expect(api.player).toMatchObject({ DefaultChannelID: 4, ChannelScheduleID: 2 })
	})
})

function createManager(api: CarouselApi, persist: (records: TimedOverrideRecord[]) => void): TimedOverrideManager {
	return new TimedOverrideManager(api, { persist })
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 10; index++) await Promise.resolve()
}
