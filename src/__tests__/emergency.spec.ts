import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmergencyController, type EmergencyOptions } from '../emergency.js'

const controllers: EmergencyController[] = []
function setup(
	fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
	verifier: EmergencyOptions['verifier'] = { preflight: async () => {}, verify: async () => true },
) {
	const controller = new EmergencyController({
		baseUrl: 'https://example.invalid',
		token: 'SECRET',
		shelterTag: 'shelter',
		evacuateTag: 'evacuate',
		timeoutMs: 1000,
		fetchImpl,
		verifier,
	})
	controllers.push(controller)
	return { controller, fetchImpl }
}
afterEach(async () => {
	for (const controller of controllers.splice(0)) await controller.destroy()
	vi.useRealTimers()
})
describe('exclusive emergency selection', () => {
	it('requires arming, consumes arming, clears opposite before activating only selected tag', async () => {
		const { controller, fetchImpl } = setup()
		await expect(controller.select('shelter')).rejects.toThrow('ARM')
		expect(fetchImpl).not.toHaveBeenCalled()
		controller.arm()
		await controller.select('shelter')
		expect(controller.armed).toBe(false)
		expect(controller.state).toBe('shelter-verified')
		expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('tags'))).toEqual([
			'evacuate',
			'shelter',
		])
		expect(fetchImpl.mock.calls[0][1]?.body).toContain('<event>CLEAR</event>')
		expect(fetchImpl.mock.calls[1][1]?.body).toContain('<event>SHELTER IN PLACE</event>')
		expect(fetchImpl.mock.calls[1][1]?.redirect).toBe('error')
	})
	it('never activates after failed clear, hides secrets and retains failure', async () => {
		const { controller, fetchImpl } = setup(vi.fn<typeof fetch>().mockRejectedValue(new Error('SECRET URL')))
		await expect(controller.select('evacuate', false)).rejects.toThrow('outcome unknown')
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(controller.error).not.toContain('SECRET')
		expect(controller.state).toBe('error')
	})
	it('clear attempts both tags even on failure', async () => {
		const { controller, fetchImpl } = setup(
			vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(new Response(null, { status: 500 }))
				.mockResolvedValueOnce(new Response(null, { status: 204 })),
		)
		await expect(controller.select('clear', false)).rejects.toThrow('both clear')
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})
	it('expires arming and never sends a request merely by arming', async () => {
		vi.useFakeTimers()
		const { controller, fetchImpl } = setup()
		controller.arm()
		await vi.advanceTimersByTimeAsync(10_001)
		await expect(controller.select('shelter')).rejects.toThrow('ARM')
		expect(fetchImpl).not.toHaveBeenCalled()
	})
	it('rejects overlapping commands and stops activation when destroyed during clear', async () => {
		let resolve!: (response: Response) => void
		const { controller, fetchImpl } = setup(
			vi.fn<typeof fetch>().mockImplementation(
				() =>
					new Promise((r) => {
						resolve = r
					}),
			),
		)
		const first = controller.select('shelter', false)
		const firstResult = expect(first).rejects.toThrow('cancelled')
		await expect(controller.select('evacuate', false)).rejects.toThrow('busy')
		await Promise.resolve()
		const stop = controller.destroy()
		resolve(new Response(null, { status: 204 }))
		await firstResult
		await stop
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})
	it('waits for correlated clear verification before activating and exposes verifying state', async () => {
		vi.useFakeTimers()
		const verify = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
		const { controller, fetchImpl } = setup(undefined, { preflight: async () => {}, verify })
		const command = controller.select('shelter', false)
		await vi.advanceTimersByTimeAsync(0)
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(controller.state).toBe('verifying')
		await vi.advanceTimersByTimeAsync(500)
		await command
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		const xml = String(fetchImpl.mock.calls[0][1]?.body)
		expect(verify.mock.calls[0]).toEqual([xml.match(/<identifier>(.*?)<\/identifier>/)?.[1], 'evacuate', false])
		expect(controller.state).toBe('shelter-verified')
	})
	it('never activates after a verification timeout and does not retry CAP writes', async () => {
		vi.useFakeTimers()
		const { controller, fetchImpl } = setup(undefined, { preflight: async () => {}, verify: async () => false })
		const result = expect(controller.select('shelter', false)).rejects.toThrow('outcome unknown')
		await vi.advanceTimersByTimeAsync(2500)
		await result
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(controller.state).toBe('error')
	})
	it('does not send CAP when API access preflight fails', async () => {
		const { controller, fetchImpl } = setup(undefined, {
			preflight: async () => {
				throw new Error('Access denied')
			},
			verify: async () => true,
		})
		await expect(controller.select('shelter', false)).rejects.toThrow('Access denied')
		expect(fetchImpl).not.toHaveBeenCalled()
	})
	it('CAP-only allows unverified clear but blocks activation', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
		const controller = new EmergencyController({
			baseUrl: 'https://example.invalid',
			token: 'test',
			shelterTag: 'shelter',
			evacuateTag: 'evacuate',
			timeoutMs: 1000,
			fetchImpl,
		})
		controllers.push(controller)
		await expect(controller.select('shelter', false)).rejects.toThrow('verification is required')
		expect(fetchImpl).not.toHaveBeenCalled()
		await controller.select('clear', false)
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		expect(controller.state).toBe('clear-requested')
	})
	it('validates unique tags and HTTPS before sending credentials', () => {
		for (const overrides of [
			{ baseUrl: 'http://example.invalid' },
			{ shelterTag: 'evacuate' },
			{ shelterTag: 'one,two' },
		]) {
			expect(
				() =>
					new EmergencyController({
						baseUrl: 'https://example.invalid',
						token: 'SECRET',
						shelterTag: 'shelter',
						evacuateTag: 'evacuate',
						timeoutMs: 1000,
						...overrides,
					}),
			).toThrow()
		}
	})
})
