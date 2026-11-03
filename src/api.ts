import type { AuthMode, CarouselApi, CarouselChannel, CarouselPlayer, ModuleSecrets, RoutingUpdate } from './types.js'

export type CarouselApiErrorKind = 'auth' | 'config' | 'http' | 'malformed' | 'network' | 'timeout'

export class CarouselApiError extends Error {
	constructor(
		message: string,
		readonly kind: CarouselApiErrorKind,
		readonly status?: number,
	) {
		super(message)
		this.name = 'CarouselApiError'
	}
}

export interface CarouselApiClientOptions {
	baseUrl: string
	authMode: Exclude<AuthMode, 'capOnly'>
	secrets: ModuleSecrets
	timeoutMs: number
	fetchImpl?: typeof fetch
	debug?: (message: string) => void
	now?: () => number
}

interface AccessTokenResponse {
	access_token: string
	token_type?: string
	expires_in?: number | string
}

export function normalizeApiBaseUrl(input: string): string {
	let url: URL
	try {
		url = new URL(input.trim())
	} catch {
		throw new CarouselApiError('Carousel server URL is invalid', 'config')
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new CarouselApiError('Carousel server URL must use http or https', 'config')
	}
	if (url.username || url.password) {
		throw new CarouselApiError('Do not embed credentials in the Carousel server URL', 'config')
	}

	url.search = ''
	url.hash = ''
	const path = url.pathname.replace(/\/+$/, '')
	if (/\/CarouselAPI\/v1$/i.test(path)) {
		url.pathname = path
	} else if (/\/CarouselAPI$/i.test(path)) {
		url.pathname = `${path}/v1`
	} else {
		url.pathname = `${path}/CarouselAPI/v1`.replace(/\/{2,}/g, '/')
	}

	return url.toString().replace(/\/$/, '')
}

export class CarouselApiClient implements CarouselApi {
	private readonly apiBaseUrl: string
	private readonly fetchImpl: typeof fetch
	private readonly now: () => number
	private token?: { value: string; expiresAt: number }
	private tokenRequest?: Promise<string>

	constructor(private readonly options: CarouselApiClientOptions) {
		this.apiBaseUrl = normalizeApiBaseUrl(options.baseUrl)
		this.fetchImpl = options.fetchImpl ?? fetch
		this.now = options.now ?? Date.now
	}

	async authenticate(): Promise<void> {
		await this.getAccessToken(true)
	}

	async getBulletins(zoneId: number): Promise<unknown> {
		return this.requestJson('GET', `/Bulletins?zoneID=${encodeURIComponent(String(zoneId))}`)
	}

	async getBulletin(bulletinId: string): Promise<unknown> {
		return this.requestJson('GET', `/Bulletins/${encodeURIComponent(bulletinId)}`)
	}

	async getCapLog(): Promise<unknown> {
		return this.requestJson('GET', '/CAPLog')
	}

	async getPlayers(): Promise<CarouselPlayer[]> {
		const value = await this.requestJson('GET', '/Players')
		if (!Array.isArray(value)) throw new CarouselApiError('Players response was not an array', 'malformed')
		return value.map((entry, index) => parsePlayer(entry, `Players[${index}]`))
	}

	async getPlayer(playerId: number): Promise<CarouselPlayer> {
		const value = await this.requestJson('GET', `/Players/${encodeURIComponent(String(playerId))}`)
		const player = parsePlayer(value, `Player ${playerId}`)
		if (player.id !== playerId)
			throw new CarouselApiError('Player response ID did not match the requested player', 'malformed')
		return player
	}

	async getChannels(): Promise<CarouselChannel[]> {
		const value = await this.requestJson('GET', '/Channels')
		if (!Array.isArray(value)) throw new CarouselApiError('Channels response was not an array', 'malformed')
		return value.map((entry, index) => parseChannel(entry, `Channels[${index}]`))
	}

	async updatePlayerRouting(playerId: number, update: RoutingUpdate): Promise<void> {
		const properties: Record<string, string | null> = {
			DefaultChannelID: String(update.defaultChannelId),
		}
		if (update.channelScheduleId !== undefined)
			properties.ChannelScheduleID = update.channelScheduleId === null ? null : String(update.channelScheduleId)

		const response = await this.request('POST', '/Players/bulkupdate', {
			body: JSON.stringify({ IDs: [playerId], Properties: properties }),
			headers: { 'content-type': 'application/json' },
		})
		await response.body?.cancel().catch(() => undefined)
	}

	private async requestJson(method: string, path: string, init: RequestInit = {}): Promise<unknown> {
		const response = await this.request(method, path, init)
		let text: string
		try {
			text = await response.text()
		} catch (error) {
			throw normalizeFetchError(error, method, path)
		}
		if (!text.trim()) throw new CarouselApiError(`${method} ${path} returned an empty response`, 'malformed')
		try {
			return JSON.parse(text)
		} catch {
			throw new CarouselApiError(`${method} ${path} returned malformed JSON`, 'malformed')
		}
	}

	private async request(method: string, path: string, init: RequestInit = {}, retryAuth = true): Promise<Response> {
		const token = await this.getAccessToken(false)
		const started = this.now()
		let response: Response
		try {
			response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
				...init,
				method,
				redirect: 'error',
				headers: {
					accept: 'application/json',
					...headersToObject(init.headers),
					authorization: `Bearer ${token}`,
				},
				signal: AbortSignal.timeout(this.options.timeoutMs),
			})
		} catch (error) {
			throw normalizeFetchError(error, method, path)
		}

		this.options.debug?.(`${method} ${path} -> ${response.status} (${this.now() - started}ms)`)
		if (response.status === 401 && retryAuth) {
			await response.body?.cancel().catch(() => undefined)
			if (this.token?.value === token) this.token = undefined
			return this.request(method, path, init, false)
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined)
			const kind: CarouselApiErrorKind = response.status === 401 || response.status === 403 ? 'auth' : 'http'
			throw new CarouselApiError(`${method} ${path} failed with HTTP ${response.status}`, kind, response.status)
		}
		return response
	}

	private async getAccessToken(force: boolean): Promise<string> {
		if (!force && this.token && this.token.expiresAt - 30_000 > this.now()) return this.token.value
		if (this.tokenRequest) return this.tokenRequest

		this.tokenRequest = this.fetchAccessToken()
		try {
			return await this.tokenRequest
		} finally {
			this.tokenRequest = undefined
		}
	}

	private async fetchAccessToken(): Promise<string> {
		const body = new URLSearchParams()
		const headers: Record<string, string> = {
			accept: 'application/json',
			'content-type': 'application/x-www-form-urlencoded',
		}

		if (this.options.authMode === 'apiKey') {
			const clientId = this.options.secrets.clientId?.trim()
			const clientSecret = this.options.secrets.clientSecret
			if (!clientId || !clientSecret) throw new CarouselApiError('Carousel API key and secret are required', 'config')
			body.set('grant_type', 'client_credentials')
			body.set('client_id', clientId)
			body.set('client_secret', clientSecret)
		} else {
			const username = this.options.secrets.username?.trim()
			const password = this.options.secrets.password
			if (!username || !password) throw new CarouselApiError('Carousel username and password are required', 'config')
			body.set('grant_type', 'password')
			body.set('username', username)
			body.set('password', password)
		}

		let response: Response
		try {
			response = await this.fetchImpl(`${this.apiBaseUrl}/Auth/token`, {
				method: 'POST',
				redirect: 'error',
				headers,
				body: body.toString(),
				signal: AbortSignal.timeout(this.options.timeoutMs),
			})
		} catch (error) {
			throw normalizeFetchError(error, 'POST', '/Auth/token')
		}

		this.options.debug?.(`POST /Auth/token -> ${response.status}`)
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined)
			throw new CarouselApiError(`Carousel authentication failed with HTTP ${response.status}`, 'auth', response.status)
		}

		let tokenText: string
		try {
			tokenText = await response.text()
		} catch (error) {
			throw normalizeFetchError(error, 'POST', '/Auth/token')
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(tokenText)
		} catch {
			throw new CarouselApiError('Carousel token response was malformed JSON', 'malformed')
		}
		if (!isObject(parsed) || typeof parsed.access_token !== 'string' || !parsed.access_token) {
			throw new CarouselApiError('Carousel token response did not contain access_token', 'malformed')
		}

		const tokenResponse = parsed as unknown as AccessTokenResponse
		const expiresIn = Number(tokenResponse.expires_in)
		this.token = {
			value: tokenResponse.access_token,
			expiresAt: this.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 300_000),
		}
		return this.token.value
	}
}

function parsePlayer(value: unknown, context: string): CarouselPlayer {
	if (!isObject(value)) throw new CarouselApiError(`${context} was not an object`, 'malformed')
	const id = parseId(value.id)
	if (id === undefined || typeof value.Name !== 'string') {
		throw new CarouselApiError(`${context} was missing a numeric id or Name`, 'malformed')
	}
	return {
		...value,
		id,
		Name: value.Name,
		DefaultChannelID: parseNullableId(value.DefaultChannelID, `${context}.DefaultChannelID`),
		CurrentChannelID: parseNullableId(value.CurrentChannelID ?? null, `${context}.CurrentChannelID`),
		ChannelScheduleID: parseNullableId(value.ChannelScheduleID, `${context}.ChannelScheduleID`),
		SecondsSinceLastCheckin:
			value.SecondsSinceLastCheckin == null
				? null
				: parseFiniteNumber(value.SecondsSinceLastCheckin, `${context}.SecondsSinceLastCheckin`),
	}
}

function parseChannel(value: unknown, context: string): CarouselChannel {
	if (!isObject(value)) throw new CarouselApiError(`${context} was not an object`, 'malformed')
	const id = parseId(value.id)
	if (id === undefined || typeof value.Name !== 'string') {
		throw new CarouselApiError(`${context} was missing a numeric id or Name`, 'malformed')
	}
	return { ...value, id, Name: value.Name }
}

function parseNullableId(value: unknown, context: string): number | null {
	if (value === null) return null
	const parsed = parseId(value)
	if (parsed === undefined) throw new CarouselApiError(`${context} was not a numeric ID or null`, 'malformed')
	return parsed
}

function parseId(value: unknown): number | undefined {
	const parsed =
		typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function parseFiniteNumber(value: unknown, context: string): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) throw new CarouselApiError(`${context} was not numeric`, 'malformed')
	return parsed
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function headersToObject(headers: RequestInit['headers']): Record<string, string> {
	if (!headers) return {}
	return Object.fromEntries(new Headers(headers).entries())
}

function normalizeFetchError(error: unknown, method: string, path: string): CarouselApiError {
	if (error instanceof CarouselApiError) return error
	const name = error instanceof Error ? error.name : ''
	if (name === 'AbortError' || name === 'TimeoutError') {
		return new CarouselApiError(`${method} ${path} timed out`, 'timeout')
	}
	return new CarouselApiError(`${method} ${path} failed: network request failed`, 'network')
}
