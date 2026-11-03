import { afterEach, describe, expect, it } from 'vitest'
import { CarouselApiClient } from '../api.js'
import { TimedOverrideManager } from '../override-manager.js'
import type { TimedOverrideRecord } from '../types.js'
import { MockCarouselServer } from './helpers/mock-carousel-server.js'

describe('HTTP failure recovery with persisted overrides', () => {
	const server = new MockCarouselServer()
	let manager: TimedOverrideManager | undefined
	afterEach(async () => {
		manager?.destroy()
		await server.stop()
	})

	it('recovers an override applied by the server before its response connection dropped', async () => {
		await server.start()
		let persisted: TimedOverrideRecord[] = []
		const client = new CarouselApiClient({
			baseUrl: server.baseUrl,
			authMode: 'apiKey',
			secrets: { clientId: 'test', clientSecret: 'test' },
			timeoutMs: 1000,
		})
		const hooks = {
			persist: (records: TimedOverrideRecord[]) => {
				persisted = structuredClone(records)
			},
		}
		manager = new TimedOverrideManager(client, hooks)
		server.dropAfterBulkUpdate = true
		await expect(
			manager.setTimedOverride({
				playerId: 90,
				channelId: 8,
				durationMs: 60_000,
				scheduleMode: 'suspend',
				restorePolicy: 'ifUnchanged',
			}),
		).rejects.toMatchObject({ kind: 'network' })
		expect(server.players[0]).toMatchObject({ DefaultChannelID: 8, ChannelScheduleID: null })
		await manager.destroy()
		server.dropAfterBulkUpdate = false
		manager = new TimedOverrideManager(client, hooks)
		await manager.recover(persisted)
		await manager.restoreNow(90)
		expect(server.players[0]).toMatchObject({ DefaultChannelID: 4, ChannelScheduleID: 2 })
		expect(persisted).toEqual([])
	})

	it('retains the baseline through a dropped restore connection and restores it after restart', async () => {
		await server.start()
		let persisted: TimedOverrideRecord[] = []
		const client = new CarouselApiClient({
			baseUrl: server.baseUrl,
			authMode: 'apiKey',
			secrets: { clientId: 'test', clientSecret: 'test' },
			timeoutMs: 1000,
		})
		const hooks = {
			persist: (records: TimedOverrideRecord[]) => {
				persisted = structuredClone(records)
			},
		}
		manager = new TimedOverrideManager(client, hooks)
		await manager.setTimedOverride({
			playerId: 90,
			channelId: 8,
			durationMs: 60_000,
			scheduleMode: 'suspend',
			restorePolicy: 'always',
		})
		expect(server.players[0]).toMatchObject({ DefaultChannelID: 8, ChannelScheduleID: null })
		server.dropBulkConnection = true
		await expect(manager.restoreNow(90)).rejects.toMatchObject({ kind: 'network' })
		expect(persisted[0]).toMatchObject({ originalDefaultChannelId: 4, originalChannelScheduleId: 2 })
		expect(manager.hasActiveOverride(90)).toBe(true)
		manager.destroy()
		server.dropBulkConnection = false
		manager = new TimedOverrideManager(client, hooks)
		await manager.recover(structuredClone(persisted))
		await manager.restoreNow(90)
		expect(server.players[0]).toMatchObject({ DefaultChannelID: 4, ChannelScheduleID: 2 })
		expect(persisted).toEqual([])
	})
})
