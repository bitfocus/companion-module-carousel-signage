import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleInstance } from '../main.js'
import { normalizeConfig } from '../config.js'
import type { ModuleConfig } from '../types.js'

const secrets = { clientId: 'test', clientSecret: 'test' }
const record = {
	playerId: 90,
	originalDefaultChannelId: 4,
	originalChannelScheduleId: 2,
	temporaryChannelId: 8,
	expiresAt: Date.now() + 600_000,
	scheduleMode: 'suspend',
	restorePolicy: 'always',
} as const

function context() {
	return {
		id: 'test',
		_isInstanceContext: true,
		label: 'test',
		saveConfig: vi.fn(),
		updateStatus: vi.fn(),
		setActionDefinitions: vi.fn(),
		setFeedbackDefinitions: vi.fn(),
		setPresetDefinitions: vi.fn(),
		setVariableDefinitions: vi.fn(),
		setVariableValues: vi.fn(),
		checkFeedbacks: vi.fn(),
	}
}

describe('connection lifecycle', () => {
	let instance: ModuleInstance | undefined
	afterEach(async () => {
		await instance?.destroy()
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it('does not reconnect or schedule work after shutdown during authentication', async () => {
		let finish!: (response: Response) => void
		const fetchImpl = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve
				}),
		)
		vi.stubGlobal('fetch', fetchImpl)
		instance = new ModuleInstance(context())
		await instance.init(normalizeConfig({ baseUrl: 'https://example.invalid' }), false, secrets)
		await instance.destroy()
		finish(new Response(JSON.stringify({ access_token: 'test' })))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})

	it('preserves snapshots when stale configuration is saved and prevents cross-server recovery', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('offline')
		})
		vi.stubGlobal('fetch', fetchImpl)
		const ctx = context()
		instance = new ModuleInstance(ctx)
		const config = normalizeConfig({ baseUrl: 'https://example.invalid', persistedOverrides: [record] })
		await instance.init(config, false, secrets)
		await instance.configUpdated({ ...config, baseUrl: 'https://other.invalid', persistedOverrides: [] }, secrets)
		expect(instance.config.persistedOverrides).toEqual([record])
		expect(instance.hasActiveOverride(90)).toBe(true)
		expect(ctx.updateStatus.mock.calls.at(-1)?.[1]).toContain('another Carousel server')
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})

	it('retries initial HTTP service failures without requiring a configuration save', async () => {
		vi.useFakeTimers()
		const fetchImpl = vi.fn(async (url: string) => {
			if (fetchImpl.mock.calls.length === 1) return new Response('', { status: 503 })
			return new Response(JSON.stringify(url.endsWith('/Auth/token') ? { access_token: 'test', expires_in: 3600 } : []))
		})
		vi.stubGlobal('fetch', fetchImpl)
		const ctx = context()
		instance = new ModuleInstance(ctx)
		await instance.init(normalizeConfig({ baseUrl: 'https://example.invalid' }), false, secrets)
		await vi.advanceTimersByTimeAsync(5100)
		expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(4)
		expect(ctx.updateStatus.mock.calls.at(-1)?.[1]).toBe('0 players, 0 channels')
	})

	it('retains pending overrides and reports the need for API recovery in CAP-only mode', async () => {
		const fetchImpl = vi.fn<typeof fetch>()
		vi.stubGlobal('fetch', fetchImpl)
		const ctx = context()
		instance = new ModuleInstance(ctx)
		await instance.init(
			normalizeConfig({
				baseUrl: 'https://example.invalid',
				authMode: 'capOnly',
				emergencyEnabled: true,
				persistedOverrides: [record],
			}),
			false,
			{ capToken: 'test-token' },
		)
		expect(instance.getOverrideRecords()).toEqual([record])
		expect(ctx.updateStatus.mock.calls.at(-1)?.[1]).toContain('Restore API mode')
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it('does not hide invalid CAP configuration after successful API polling', async () => {
		vi.useFakeTimers()
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async (url: string) =>
					new Response(JSON.stringify(url.endsWith('/Auth/token') ? { access_token: 'test', expires_in: 3600 } : [])),
			),
		)
		const ctx = context()
		instance = new ModuleInstance(ctx)
		await instance.init(
			normalizeConfig({ baseUrl: 'https://example.invalid', emergencyEnabled: true, emergencyZoneId: 1 }),
			false,
			secrets,
		)
		await vi.advanceTimersByTimeAsync(5100)
		expect(ctx.updateStatus.mock.calls.at(-1)?.[1]).toBe('Enter the Carousel CAP token')
		expect(instance.lastError).toBe('Enter the Carousel CAP token')
	})

	it('does not copy legacy credential fields into ordinary saved configuration', () => {
		const config = normalizeConfig({
			baseUrl: 'https://example.invalid',
			password: 'test-marker',
		} as Partial<ModuleConfig>)
		expect(config).not.toHaveProperty('password')
	})
})
