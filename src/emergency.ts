import { randomUUID } from 'node:crypto'
import { normalizeApiBaseUrl } from './api.js'

export type EmergencySelection = 'shelter' | 'evacuate' | 'clear'
export type EmergencyState =
	| 'verifying'
	| 'shelter-verified'
	| 'evacuate-verified'
	| 'clear-verified'
	| 'unknown'
	| 'sending'
	| 'shelter-requested'
	| 'evacuate-requested'
	| 'clear-requested'
	| 'error'

export interface EmergencyOptions {
	baseUrl: string
	token: string
	shelterTag: string
	evacuateTag: string
	timeoutMs: number
	verifier?: { preflight(): Promise<void>; verify(messageId: string, tag: string, active: boolean): Promise<boolean> }
	fetchImpl?: typeof fetch
	onChange?: () => void
}

// CAP acknowledgements are command receipts, not player display telemetry.
export class EmergencyController {
	state: EmergencyState = 'unknown'
	error = ''
	verifiedAt = ''
	private armedUntil = 0
	private armTimer?: ReturnType<typeof setTimeout>
	private pending?: Promise<void>
	private stopped = false
	private readonly endpoint: URL

	constructor(private readonly options: EmergencyOptions) {
		this.endpoint = new URL(`${normalizeApiBaseUrl(options.baseUrl)}/CAP`)
		if (this.endpoint.protocol !== 'https:') throw new Error('Emergency CAP requires HTTPS')
		if (!options.token.trim()) throw new Error('Enter the Carousel CAP token')
		const tags = [options.shelterTag, options.evacuateTag]
		if (tags.some((tag) => !/^[a-zA-Z0-9_-]{1,100}$/.test(tag)) || tags[0].toLowerCase() === tags[1].toLowerCase()) {
			throw new Error('Emergency tags must be distinct single tags containing letters, numbers, hyphens or underscores')
		}
	}

	get armed(): boolean {
		return !this.stopped && Date.now() < this.armedUntil
	}
	arm(): void {
		if (this.stopped || this.pending) throw new Error('Emergency controls are busy or stopped')
		this.disarm()
		this.armedUntil = Date.now() + 10_000
		this.armTimer = setTimeout(() => this.disarm(), 10_000)
		this.options.onChange?.()
	}
	disarm(): void {
		this.armedUntil = 0
		if (this.armTimer) clearTimeout(this.armTimer)
		this.armTimer = undefined
		this.options.onChange?.()
	}
	async destroy(): Promise<void> {
		this.stopped = true
		this.disarm()
		await this.pending?.catch(() => undefined)
	}
	async select(selection: EmergencySelection, requireArm = true): Promise<void> {
		if (!['shelter', 'evacuate', 'clear'].includes(selection)) throw new Error('Invalid emergency selection')
		if (this.stopped || this.pending) throw new Error('Emergency controls are busy or stopped')
		if (requireArm && !this.armed) throw new Error('Press ARM, then select an emergency command within 10 seconds')
		this.disarm()
		this.pending = this.perform(selection)
		try {
			await this.pending
		} finally {
			this.pending = undefined
		}
	}
	private async perform(selection: EmergencySelection): Promise<void> {
		this.state = 'sending'
		this.error = ''
		this.verifiedAt = ''
		this.options.onChange?.()
		try {
			if (selection !== 'clear') {
				if (!this.options.verifier) throw new Error('API bulletin verification is required before activating an alert')
				await this.options.verifier.preflight()
			}
			// Clear the opposite tag first; never activate after an uncertain clear.
			// Clear-all attempts BOTH tags, even if the first request fails.
			if (selection === 'clear') {
				const results = await Promise.allSettled([
					this.send(this.options.shelterTag, 'CLEAR'),
					this.send(this.options.evacuateTag, 'CLEAR'),
				])
				if (results.some((result) => result.status === 'rejected'))
					throw new Error('Unable to confirm both clear requests; check Carousel before retrying')
			} else {
				await this.send(selection === 'shelter' ? this.options.evacuateTag : this.options.shelterTag, 'CLEAR')
				if (this.stopped) throw new Error('Configuration changed after clearing; activation was cancelled')
				await this.send(
					selection === 'shelter' ? this.options.shelterTag : this.options.evacuateTag,
					selection === 'shelter' ? 'SHELTER IN PLACE' : 'EVACUATION IN EFFECT',
				)
			}
			this.state = this.options.verifier ? `${selection}-verified` : `${selection}-requested`
			if (this.options.verifier) this.verifiedAt = new Date().toISOString()
		} catch (error) {
			this.state = 'error'
			this.error = error instanceof Error ? error.message : 'Emergency request failed'
			throw error
		} finally {
			this.options.onChange?.()
		}
	}
	private async send(tag: string, event: string): Promise<void> {
		if (this.stopped) throw new Error('Configuration changed; command was cancelled')
		const messageId = randomUUID()
		const url = new URL(this.endpoint)
		url.searchParams.set('token', this.options.token)
		url.searchParams.set('tags', tag)
		const body = `<?xml version="1.0" encoding="UTF-8"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>${messageId}</identifier><sender>companion</sender><sent>${new Date().toISOString()}</sent><status>Actual</status><msgType>Alert</msgType><scope>Public</scope><info><category>Safety</category><event>${event}</event><urgency>Immediate</urgency><severity>Severe</severity><certainty>Observed</certainty><description>${event}</description></info></alert>`
		let response: Response
		try {
			response = await (this.options.fetchImpl ?? fetch)(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/xml' },
				body,
				redirect: 'error',
				signal: AbortSignal.timeout(this.options.timeoutMs),
			})
		} catch {
			throw new Error('CAP network request failed or timed out; outcome unknown. Check Carousel before retrying')
		}
		// Never include response bodies or URLs: they may contain the CAP credential.
		await response.body?.cancel().catch(() => undefined)
		if (!response.ok) throw new Error(`CAP returned HTTP ${response.status}; check Carousel before retrying`)
		if (this.options.verifier) {
			this.state = 'verifying'
			this.options.onChange?.()
			for (let attempt = 0; attempt < 5; attempt++) {
				if (this.stopped) throw new Error('Configuration changed; verification was cancelled')
				if (await this.options.verifier.verify(messageId, tag, event !== 'CLEAR')) {
					if (this.stopped) throw new Error('Configuration changed; verification was cancelled')
					return
				}
				if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500))
			}
			throw new Error('Bulletin state could not be verified; outcome unknown. Check Carousel before retrying')
		}
	}
}
