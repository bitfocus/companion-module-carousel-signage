export type AuthMode = 'apiKey' | 'password' | 'capOnly'
export type ScheduleBehavior = 'preserve' | 'remove'
export type OverrideScheduleMode = 'preserve' | 'suspend'
export type RestorePolicy = 'always' | 'ifUnchanged'

export interface CarouselPlayer {
	id: number
	Name: string
	HostName?: string | null
	HostAddress?: string | null
	Version?: string | null
	LastCheckinUTC?: string | null
	SecondsSinceLastCheckin?: number | null
	DefaultChannelID: number | null
	CurrentChannelID: number | null
	ChannelScheduleID: number | null
	Status?: string | null
	ConfigurationStatus?: string | null
	Type?: string | null
	[key: string]: unknown
}

export interface CarouselChannel {
	id: number
	Name: string
	Height?: number
	Width?: number
	Type?: string | null
	[key: string]: unknown
}

export type TimedOverrideRecord = {
	playerId: number
	originalDefaultChannelId: number | null
	originalChannelScheduleId: number | null
	temporaryChannelId: number
	expiresAt: number
	scheduleMode: OverrideScheduleMode
	restorePolicy: RestorePolicy
	// Possible previous targets while a routing write has no confirmed outcome.
	pendingChannelIds?: number[]
}

export type ModuleConfig = {
	emergencyZoneId?: number
	emergencyEnabled?: boolean
	shelterTag?: string
	evacuateTag?: string
	baseUrl: string
	authMode: AuthMode
	pollIntervalSeconds: number
	discoveryIntervalMinutes: number
	requestTimeoutSeconds: number
	offlineThresholdSeconds: number
	debug: boolean
	persistedOverrides?: TimedOverrideRecord[]
	persistedOverridesBaseUrl?: string
}

export type ModuleSecrets = {
	capToken?: string
	username?: string
	password?: string
	clientId?: string
	clientSecret?: string
}

export interface RoutingUpdate {
	defaultChannelId: number
	channelScheduleId?: number | null
}

export interface CarouselApi {
	getPlayers(): Promise<CarouselPlayer[]>
	getPlayer(playerId: number): Promise<CarouselPlayer>
	getChannels(): Promise<CarouselChannel[]>
	updatePlayerRouting(playerId: number, update: RoutingUpdate): Promise<void>
}
