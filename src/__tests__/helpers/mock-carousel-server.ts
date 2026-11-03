import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CarouselChannel, CarouselPlayer } from '../../types.js'

export interface CapturedRequest {
	method: string
	path: string
	headers: IncomingMessage['headers']
	body: string
}

export class MockCarouselServer {
	readonly requests: CapturedRequest[] = []
	players: CarouselPlayer[] = [
		{
			id: 90,
			Name: 'Test Player',
			DefaultChannelID: 4,
			CurrentChannelID: 4,
			ChannelScheduleID: 2,
			SecondsSinceLastCheckin: 3,
			Status: 'good',
		},
	]
	channels: CarouselChannel[] = [
		{ id: 4, Name: 'Full Screen Announcements' },
		{ id: 8, Name: 'Emergency Channel' },
	]
	malformedPlayers = false
	failBulkStatus?: number
	dropBulkConnection = false
	dropAfterBulkUpdate = false
	tokenStatus = 200

	private server?: Server
	baseUrl = ''

	async start(): Promise<void> {
		this.server = createServer((request, response) => void this.handle(request, response))
		await new Promise<void>((resolve, reject) => {
			this.server!.once('error', reject)
			this.server!.listen(0, '127.0.0.1', () => {
				this.server!.off('error', reject)
				resolve()
			})
		})
		const address = this.server.address() as AddressInfo
		this.baseUrl = `http://127.0.0.1:${address.port}`
	}

	async stop(): Promise<void> {
		if (!this.server) return
		await new Promise<void>((resolve, reject) => this.server!.close((error) => (error ? reject(error) : resolve())))
		this.server = undefined
	}

	private async handle(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
		const body = await readBody(request)
		const path = new URL(request.url ?? '/', this.baseUrl).pathname
		this.requests.push({ method: request.method ?? 'GET', path, headers: request.headers, body })

		if (/\/CarouselAPI\/v1\/Auth\/token$/i.test(path)) {
			if (this.tokenStatus !== 200) return sendJson(response, this.tokenStatus, { error: 'invalid_grant' })
			return sendJson(response, 200, { access_token: 'mock-token', token_type: 'Bearer', expires_in: 3600 })
		}

		if (request.headers.authorization !== 'Bearer mock-token')
			return sendJson(response, 401, { message: 'Unauthorized' })

		if (request.method === 'GET' && /\/CarouselAPI\/v1\/Players$/i.test(path)) {
			return sendJson(response, 200, this.malformedPlayers ? { players: this.players } : this.players)
		}
		const playerMatch = path.match(/\/CarouselAPI\/v1\/Players\/(\d+)$/i)
		if (request.method === 'GET' && playerMatch) {
			const player = this.players.find((entry) => entry.id === Number(playerMatch[1]))
			return player ? sendJson(response, 200, player) : sendJson(response, 404, { message: 'Not found' })
		}
		if (request.method === 'GET' && /\/CarouselAPI\/v1\/Channels$/i.test(path)) {
			return sendJson(response, 200, this.channels)
		}
		if (request.method === 'POST' && /\/CarouselAPI\/v1\/Players\/bulkupdate$/i.test(path)) {
			if (this.dropBulkConnection) {
				response.destroy()
				return
			}
			if (this.failBulkStatus) return sendJson(response, this.failBulkStatus, { message: 'Update rejected' })
			const parsed = JSON.parse(body) as { IDs: number[]; Properties: Record<string, string | null> }
			if (Object.values(parsed.Properties).some((value) => value !== null && typeof value !== 'string'))
				return sendJson(response, 500, { message: 'Routing properties must be strings or null' })
			for (const id of parsed.IDs) {
				const player = this.players.find((entry) => entry.id === id)
				if (!player) continue
				if ('DefaultChannelID' in parsed.Properties)
					player.DefaultChannelID = Number(parsed.Properties.DefaultChannelID)
				if ('ChannelScheduleID' in parsed.Properties)
					player.ChannelScheduleID =
						parsed.Properties.ChannelScheduleID === null ? null : Number(parsed.Properties.ChannelScheduleID)
			}
			if (this.dropAfterBulkUpdate) {
				response.destroy()
				return
			}
			return sendJson(response, 200, { ok: true })
		}

		sendJson(response, 404, { message: 'Unknown route' })
	}
}

async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	return Buffer.concat(chunks).toString('utf8')
}

function sendJson(response: import('node:http').ServerResponse, status: number, value: unknown): void {
	response.writeHead(status, { 'content-type': 'application/json' })
	response.end(JSON.stringify(value))
}
