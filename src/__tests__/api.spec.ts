import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CarouselApiClient, normalizeApiBaseUrl } from '../api.js'
import { MockCarouselServer } from './helpers/mock-carousel-server.js'

describe('CarouselApiClient', () => {
	let server: MockCarouselServer

	beforeEach(async () => {
		server = new MockCarouselServer()
		await server.start()
	})

	afterEach(async () => {
		await server.stop()
	})

	it('normalizes server, CarouselAPI, and v1 URLs', () => {
		expect(normalizeApiBaseUrl(`${server.baseUrl}/`)).toBe(`${server.baseUrl}/CarouselAPI/v1`)
		expect(normalizeApiBaseUrl(`${server.baseUrl}/CarouselAPI`)).toBe(`${server.baseUrl}/CarouselAPI/v1`)
		expect(normalizeApiBaseUrl(`${server.baseUrl}/CarouselAPI/v1/`)).toBe(`${server.baseUrl}/CarouselAPI/v1`)
	})

	it('authenticates with a password grant and discovers players and channels', async () => {
		const client = passwordClient(server)
		const players = await client.getPlayers()
		const channels = await client.getChannels()

		expect(players).toHaveLength(1)
		expect(players[0]).toMatchObject({ id: 90, Name: 'Test Player', CurrentChannelID: 4 })
		expect(channels.map((channel) => channel.Name)).toEqual(['Full Screen Announcements', 'Emergency Channel'])
		const tokenRequest = server.requests[0]
		expect(tokenRequest.body).toContain('grant_type=password')
		expect(tokenRequest.body).toContain('username=operator%40example.com')
		expect(tokenRequest.body).toContain('password=correct-horse')
	})

	it('uses OAuth client credentials for an API key', async () => {
		const client = new CarouselApiClient({
			baseUrl: server.baseUrl,
			authMode: 'apiKey',
			secrets: { clientId: 'key-id', clientSecret: 'key-secret' },
			timeoutMs: 1000,
		})
		await client.getChannels()
		const tokenRequest = server.requests[0]
		expect(Object.fromEntries(new URLSearchParams(tokenRequest.body))).toEqual({
			grant_type: 'client_credentials',
			client_id: 'key-id',
			client_secret: 'key-secret',
		})
		expect(tokenRequest.headers.authorization).toBeUndefined()
	})

	it('sends the documented narrow bulk update payload', async () => {
		const client = passwordClient(server)
		await client.updatePlayerRouting(90, { defaultChannelId: 8, channelScheduleId: null })
		const updateRequest = server.requests.find((request) => request.path.endsWith('/Players/bulkupdate'))
		expect(JSON.parse(updateRequest!.body)).toEqual({
			IDs: [90],
			Properties: { DefaultChannelID: '8', ChannelScheduleID: null },
		})
		await client.updatePlayerRouting(90, { defaultChannelId: 4, channelScheduleId: 2 })
		expect(JSON.parse(server.requests.at(-1)!.body)).toEqual({
			IDs: [90],
			Properties: { DefaultChannelID: '4', ChannelScheduleID: '2' },
		})
	})

	it('rejects malformed discovery responses', async () => {
		server.malformedPlayers = true
		await expect(passwordClient(server).getPlayers()).rejects.toMatchObject({ kind: 'malformed' })
	})

	it('classifies authentication and rejected update errors', async () => {
		server.tokenStatus = 401
		await expect(passwordClient(server).getPlayers()).rejects.toMatchObject({
			kind: 'auth',
			status: 401,
		})

		server.tokenStatus = 200
		server.failBulkStatus = 409
		await expect(passwordClient(server).updatePlayerRouting(90, { defaultChannelId: 8 })).rejects.toMatchObject({
			kind: 'http',
			status: 409,
		})
	})
})

function passwordClient(server: MockCarouselServer): CarouselApiClient {
	return new CarouselApiClient({
		baseUrl: server.baseUrl,
		authMode: 'password',
		secrets: { username: 'operator@example.com', password: 'correct-horse' },
		timeoutMs: 1000,
	})
}
