import { InstanceBase, InstanceStatus, type InstanceTypes, type SomeCompanionConfigField } from '@companion-module/base'
import { BulletinVerifier } from './bulletin-verifier.js'
import { EmergencyController, type EmergencySelection } from './emergency.js'
import { UpdateActions } from './actions.js'
import { CarouselApiClient, CarouselApiError, normalizeApiBaseUrl } from './api.js'
import { GetConfigFields, normalizeConfig, validateConnectionConfig } from './config.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { TimedOverrideManager } from './override-manager.js'
import { UpdatePresets } from './presets.js'
import type {
	CarouselChannel,
	CarouselPlayer,
	ModuleConfig,
	ModuleSecrets,
	OverrideScheduleMode,
	RestorePolicy,
	ScheduleBehavior,
	TimedOverrideRecord,
} from './types.js'
import { BuildVariableValues, UpdateVariableDefinitions } from './variables.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: InstanceTypes['actions']
	feedbacks: InstanceTypes['feedbacks']
	variables: InstanceTypes['variables']
}

export class ModuleInstance extends InstanceBase<ModuleSchema> {
	config: ModuleConfig = normalizeConfig({})
	secrets: ModuleSecrets = {}
	emergency?: EmergencyController
	emergencyConfigError = ''
	lastAction = ''
	lastError = ''

	private api?: CarouselApiClient
	private overrideManager?: TimedOverrideManager
	private players = new Map<number, CarouselPlayer>()
	private channels = new Map<number, CarouselChannel>()
	private pollTimer?: NodeJS.Timeout
	private discoveryTimer?: NodeJS.Timeout
	private pollInFlight = false
	private discoveryInFlight = false
	private connectionGeneration = 0
	private resourceHash = ''
	private stopping = false
	private recovered = false

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = normalizeConfig(config ?? {})
		this.secrets = secrets ?? {}
		this.updateDefinitions()
		this.updateVariables()
		this.restartConnection()
	}

	async destroy(): Promise<void> {
		this.stopping = true
		this.stopTimers()
		await this.emergency?.destroy()
		await this.overrideManager?.destroy()
		this.connectionGeneration++
		this.overrideManager = undefined
		this.api = undefined
		this.log('debug', 'Carousel module destroyed')
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.stopping = true
		this.stopTimers()
		await this.emergency?.destroy()
		await this.overrideManager?.destroy()
		const previousPersisted = this.config.persistedOverrides ?? []
		this.config = normalizeConfig({
			...config,
			persistedOverrides: previousPersisted,
			persistedOverridesBaseUrl: this.config.persistedOverridesBaseUrl ?? this.config.baseUrl,
		})
		this.secrets = secrets ?? {}
		this.updateDefinitions()
		this.restartConnection()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	getPlayers(): CarouselPlayer[] {
		return [...this.players.values()].sort((a, b) => a.Name.localeCompare(b.Name))
	}

	getChannels(): CarouselChannel[] {
		return [...this.channels.values()].sort((a, b) => a.Name.localeCompare(b.Name))
	}

	getPlayer(playerId: number): CarouselPlayer | undefined {
		return this.players.get(playerId)
	}

	getPlayerChoices(): Array<{ id: string; label: string }> {
		const choices = this.getPlayers().map((player) => ({ id: String(player.id), label: player.Name }))
		return choices.length ? choices : [{ id: '', label: 'No players discovered' }]
	}

	getChannelChoices(): Array<{ id: string; label: string }> {
		const choices = this.getChannels().map((channel) => ({ id: String(channel.id), label: channel.Name }))
		return choices.length ? choices : [{ id: '', label: 'No channels discovered' }]
	}

	getOverrideRecords(): TimedOverrideRecord[] {
		return (this.recovered ? this.overrideManager?.getRecords() : undefined) ?? this.config.persistedOverrides ?? []
	}

	hasActiveOverride(playerId: number): boolean {
		return this.getOverrideRecords().some((record) => record.playerId === playerId)
	}

	isPlayerOffline(player: CarouselPlayer, thresholdSeconds = this.config.offlineThresholdSeconds): boolean {
		if (typeof player.SecondsSinceLastCheckin === 'number' && Number.isFinite(player.SecondsSinceLastCheckin)) {
			return player.SecondsSinceLastCheckin >= thresholdSeconds
		}
		const status = String(player.Status ?? '').toLowerCase()
		return status === 'offline' || status === 'bad' || status === 'error'
	}

	async executePermanent(playerId: number, channelId: number, behavior: ScheduleBehavior): Promise<void> {
		await this.runAction(`Set player ${playerId} permanently to channel ${channelId}`, async () => {
			this.requireResources(playerId, channelId)
			await this.requireOverrideManager().setPermanent(playerId, channelId, behavior)
		})
	}

	async executeTimedOverride(
		playerId: number,
		channelId: number,
		durationMs: number,
		scheduleMode: OverrideScheduleMode,
		restorePolicy: RestorePolicy,
	): Promise<void> {
		await this.runAction(`Temporarily set player ${playerId} to channel ${channelId}`, async () => {
			this.requireResources(playerId, channelId)
			await this.requireOverrideManager().setTimedOverride({
				playerId,
				channelId,
				durationMs,
				scheduleMode,
				restorePolicy,
			})
		})
	}

	async executeRestore(playerId: number): Promise<void> {
		await this.runAction(`Restore player ${playerId} timed override`, async () => {
			if (!this.players.has(playerId)) throw new Error(`Player ${playerId} is no longer available`)
			const hadActiveOverride = this.requireOverrideManager().hasActiveOverride(playerId)
			const restored = await this.requireOverrideManager().restoreNow(playerId)
			if (!restored && !hadActiveOverride) throw new Error(`Player ${playerId} has no active timed override to restore`)
		})
	}

	async executeRefresh(): Promise<void> {
		await this.runAction('Refresh Carousel players and channels', async () =>
			this.refreshDiscovery(this.connectionGeneration),
		)
	}

	reportActionError(description: string, error: unknown): void {
		this.lastError = errorMessage(error)
		this.log('error', `${description} failed: ${this.lastError}`)
		this.updateVariables()
	}

	armEmergency(): void {
		this.requireEmergency().arm()
	}
	async selectEmergency(selection: EmergencySelection, requireArm = true): Promise<void> {
		await this.requireEmergency().select(selection, requireArm)
	}
	private requireEmergency(): EmergencyController {
		if (this.stopping || !this.emergency)
			throw new Error(this.emergencyConfigError || 'Enable and configure emergency CAP controls first')
		return this.emergency
	}

	private restartConnection(): void {
		this.stopping = false
		this.emergency = undefined
		this.emergencyConfigError = ''
		if (this.config.emergencyEnabled) {
			try {
				this.emergency = new EmergencyController({
					baseUrl: this.config.baseUrl,
					token: this.secrets.capToken ?? '',
					shelterTag: this.config.shelterTag ?? '',
					evacuateTag: this.config.evacuateTag ?? '',
					timeoutMs: this.config.requestTimeoutSeconds * 1000,
					verifier:
						this.config.authMode === 'capOnly'
							? undefined
							: new BulletinVerifier(
									{
										getBulletins: (zoneId) => this.requireApi().getBulletins(zoneId),
										getBulletin: (bulletinId) => this.requireApi().getBulletin(bulletinId),
										getCapLog: () => this.requireApi().getCapLog(),
									},
									this.config.emergencyZoneId ?? 0,
									[this.config.shelterTag ?? '', this.config.evacuateTag ?? ''],
								),
					onChange: () => {
						this.updateVariables()
						this.checkFeedbacks('emergencyArmed', 'emergencyRequestState')
					},
				})
			} catch (error) {
				this.emergencyConfigError = errorMessage(error)
			}
		}
		this.recovered = false
		const generation = ++this.connectionGeneration
		this.stopTimers()
		void this.overrideManager?.destroy()
		this.overrideManager = undefined
		this.api = undefined
		this.pollInFlight = false
		this.discoveryInFlight = false
		this.players.clear()
		this.channels.clear()
		this.resourceHash = ''
		this.updateDefinitions()
		this.updateVariables()

		const configError = validateConnectionConfig(this.config, this.secrets)
		if (configError) {
			this.lastError = configError
			this.updateStatus(InstanceStatus.BadConfig, configError)
			this.updateVariables()
			return
		}

		if (this.config.authMode === 'capOnly') {
			this.lastError = this.emergencyConfigError
			this.updateStatus(
				this.emergency ? InstanceStatus.Ok : InstanceStatus.BadConfig,
				this.emergency ? 'CAP configured; requests unverified until tested' : this.emergencyConfigError,
			)
			this.updateVariables()
			return
		}

		try {
			if (
				(this.config.persistedOverrides?.length ?? 0) > 0 &&
				this.config.persistedOverridesBaseUrl &&
				normalizeApiBaseUrl(this.config.persistedOverridesBaseUrl) !== normalizeApiBaseUrl(this.config.baseUrl)
			) {
				throw new CarouselApiError(
					'Pending overrides belong to another Carousel server. Restore the previous server URL to recover them before changing servers.',
					'config',
				)
			}
			const api = new CarouselApiClient({
				baseUrl: this.config.baseUrl,
				authMode: this.config.authMode,
				secrets: this.secrets,
				timeoutMs: this.config.requestTimeoutSeconds * 1000,
				debug: this.config.debug ? (message) => this.log('debug', message) : undefined,
			})
			this.api = api
			this.overrideManager = new TimedOverrideManager(api, {
				persist: (records) => {
					if (generation === this.connectionGeneration) return this.persistOverrides(records)
					return undefined
				},
				onStateChanged: () => {
					if (generation === this.connectionGeneration) this.handleOverrideStateChanged()
				},
				log: (level, message) => this.log(level, message),
			})
			this.updateStatus(InstanceStatus.Connecting, 'Authenticating with Carousel')
			void this.connect(generation)
		} catch (error) {
			this.handleConnectionError(error, 'Configuration error')
		}
	}

	private async connect(generation: number): Promise<void> {
		if (this.stopping || generation !== this.connectionGeneration) return
		try {
			const api = this.requireApi()
			await api.authenticate()
			if (this.stopping || generation !== this.connectionGeneration) return
			if (!this.recovered) {
				await this.requireOverrideManager().recover(this.config.persistedOverrides ?? [])
				if (this.stopping || generation !== this.connectionGeneration) return
				this.recovered = true
			}
			if (this.stopping || generation !== this.connectionGeneration) return
			await this.refreshDiscovery(generation)
			if (this.stopping || generation !== this.connectionGeneration) return
			this.reportConnectedStatus()
			this.startTimers(generation)
		} catch (error) {
			if (!this.stopping && generation === this.connectionGeneration) {
				this.handleConnectionError(error, 'Carousel connection failed')
				if (error instanceof CarouselApiError && error.kind !== 'config') {
					this.pollTimer = setTimeout(
						() => void this.connect(generation),
						Math.max(5000, this.config.pollIntervalSeconds * 1000),
					)
				}
			}
		}
	}

	private reportConnectedStatus(): void {
		this.lastError = this.emergencyConfigError
		this.updateStatus(
			this.emergencyConfigError ? InstanceStatus.BadConfig : InstanceStatus.Ok,
			this.emergencyConfigError || `${this.players.size} players, ${this.channels.size} channels`,
		)
		this.updateVariables()
	}

	private startTimers(generation: number): void {
		this.stopTimers()
		this.pollTimer = setInterval(() => void this.pollPlayers(generation), this.config.pollIntervalSeconds * 1000)
		this.discoveryTimer = setInterval(
			() =>
				void this.refreshDiscovery(generation).catch((error) => {
					if (!this.stopping && generation === this.connectionGeneration)
						this.handleConnectionError(error, 'Discovery failed')
				}),
			this.config.discoveryIntervalMinutes * 60_000,
		)
	}

	private stopTimers(): void {
		if (this.pollTimer) clearInterval(this.pollTimer)
		if (this.discoveryTimer) clearInterval(this.discoveryTimer)
		this.pollTimer = undefined
		this.discoveryTimer = undefined
	}

	private async pollPlayers(generation: number): Promise<void> {
		if (this.stopping || this.pollInFlight || generation !== this.connectionGeneration) return
		this.pollInFlight = true
		try {
			const players = await this.requireApi().getPlayers()
			if (this.stopping || generation !== this.connectionGeneration) return
			this.applyPlayers(players)
			this.lastError = ''
			this.reportConnectedStatus()
		} catch (error) {
			if (!this.stopping && generation === this.connectionGeneration)
				this.handleConnectionError(error, 'Player polling failed')
		} finally {
			if (generation === this.connectionGeneration) this.pollInFlight = false
		}
	}

	private async refreshDiscovery(generation: number): Promise<void> {
		if (this.stopping || this.discoveryInFlight || generation !== this.connectionGeneration) return
		this.discoveryInFlight = true
		try {
			const api = this.requireApi()
			const [players, channels] = await Promise.all([api.getPlayers(), api.getChannels()])
			if (this.stopping || generation !== this.connectionGeneration) return
			this.applyPlayers(players)
			this.channels = new Map(channels.map((channel) => [channel.id, channel]))
			this.refreshDefinitionsIfResourcesChanged()
			this.lastError = ''
			this.updateVariables()
			this.checkFeedbacks('playerOnChannel', 'playerTimedOverrideActive', 'playerOffline')
		} finally {
			if (generation === this.connectionGeneration) this.discoveryInFlight = false
		}
	}

	private applyPlayers(players: CarouselPlayer[]): void {
		this.players = new Map(players.map((player) => [player.id, player]))
		this.refreshDefinitionsIfResourcesChanged()
		this.updateVariables()
		this.checkFeedbacks('playerOnChannel', 'playerTimedOverrideActive', 'playerOffline')
	}

	private refreshDefinitionsIfResourcesChanged(): void {
		const hash = JSON.stringify({
			players: this.getPlayers().map((player) => [player.id, player.Name]),
			channels: this.getChannels().map((channel) => [channel.id, channel.Name]),
		})
		if (hash === this.resourceHash) return
		this.resourceHash = hash
		this.updateDefinitions()
	}

	private updateDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdateVariableDefinitions(this)
		UpdatePresets(this)
	}

	private updateVariables(): void {
		this.setVariableValues(BuildVariableValues(this))
	}

	private handleOverrideStateChanged(): void {
		this.config.persistedOverrides = this.overrideManager?.getRecords() ?? []
		this.updateVariables()
		this.checkFeedbacks('playerTimedOverrideActive')
	}

	private async persistOverrides(records: TimedOverrideRecord[]): Promise<void> {
		this.config = { ...this.config, persistedOverrides: records, persistedOverridesBaseUrl: this.config.baseUrl }
		await this.saveConfig(this.config, undefined)
	}

	private async runAction(description: string, operation: () => Promise<void>): Promise<void> {
		try {
			await operation()
			this.lastAction = description
			this.lastError = ''
			this.log('info', description)
			this.updateVariables()
			void this.pollPlayers(this.connectionGeneration)
		} catch (error) {
			this.lastError = errorMessage(error)
			this.log('error', `${description} failed: ${this.lastError}`)
			this.updateVariables()
		}
	}

	private requireResources(playerId: number, channelId: number): void {
		if (!this.players.has(playerId)) throw new Error(`Player ${playerId} is no longer available`)
		if (!this.channels.has(channelId)) throw new Error(`Channel ${channelId} is no longer available`)
	}

	private requireApi(): CarouselApiClient {
		if (!this.api) throw new Error('Carousel API is not configured')
		return this.api
	}

	private requireOverrideManager(): TimedOverrideManager {
		if (this.stopping || !this.overrideManager) throw new Error('Carousel API is not connected')
		return this.overrideManager
	}

	private handleConnectionError(error: unknown, context: string): void {
		const message = `${context}: ${errorMessage(error)}`
		this.lastError = message
		this.log('error', message)
		if (error instanceof CarouselApiError) {
			if (error.kind === 'auth') this.updateStatus(InstanceStatus.AuthenticationFailure, message)
			else if (error.kind === 'config') this.updateStatus(InstanceStatus.BadConfig, message)
			else if (error.kind === 'network' || error.kind === 'timeout') {
				this.updateStatus(InstanceStatus.ConnectionFailure, message)
			} else this.updateStatus(InstanceStatus.UnknownError, message)
		} else {
			this.updateStatus(InstanceStatus.UnknownError, message)
		}
		this.updateVariables()
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export { UpgradeScripts } from './upgrades.js'
export default ModuleInstance
