import { describe, expect, it, vi } from 'vitest'
import { CarouselApiClient } from '../api.js'

function client(fetchImpl: typeof fetch) {
	return new CarouselApiClient({
		baseUrl: 'https://example.invalid',
		authMode: 'apiKey',
		secrets: { clientId: 'test-id', clientSecret: 'test-secret' },
		timeoutMs: 1000,
		fetchImpl,
	})
}

describe('API safety', () => {
	it('encodes individual bulletin IDs as one path segment', async () => {
		const fetchImpl = vi.fn(
			async (url: string | URL | Request) =>
				new Response(JSON.stringify(String(url).endsWith('/Auth/token') ? { access_token: 'test-token' } : {})),
		)
		await client(fetchImpl).getBulletin('id/with?reserved#characters')
		expect(String(fetchImpl.mock.calls[1][0])).toBe(
			'https://example.invalid/CarouselAPI/v1/Bulletins/id%2Fwith%3Freserved%23characters',
		)
	})
	it('never includes untrusted authentication response details in errors', async () => {
		const api = client(
			vi.fn(
				async () => new Response(JSON.stringify({ error_description: 'sensitive-response-marker' }), { status: 401 }),
			),
		)
		await expect(api.authenticate()).rejects.toThrow('Carousel authentication failed with HTTP 401')
		await expect(api.authenticate()).rejects.not.toThrow('sensitive-response-marker')
	})

	it('rejects redirects on both token and resource requests and shares concurrent authentication', async () => {
		const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			expect(init?.redirect).toBe('error')
			return new Response(
				JSON.stringify(String(_url).endsWith('/Auth/token') ? { access_token: 'test-token', expires_in: 3600 } : []),
			)
		})
		const api = client(fetchImpl)
		await Promise.all([api.getPlayers(), api.getChannels()])
		expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/Auth/token'))).toHaveLength(1)
	})

	it('normalizes response-body timeout and arbitrary network errors without exposing their messages', async () => {
		const api = client(
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.error(new DOMException('sensitive-response-marker', 'TimeoutError'))
							},
						}),
					),
			),
		)
		await expect(api.authenticate()).rejects.toMatchObject({ kind: 'timeout', message: 'POST /Auth/token timed out' })
		const failed = client(
			vi.fn(async () => {
				throw new Error('sensitive-response-marker')
			}),
		)
		await expect(failed.authenticate()).rejects.toMatchObject({
			kind: 'network',
			message: 'POST /Auth/token failed: network request failed',
		})
	})

	it('does not expose response stream errors while discarding an HTTP failure body', async () => {
		const api = client(
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							cancel() {
								throw new Error('sensitive-response-marker')
							},
						}),
						{ status: 403 },
					),
			),
		)
		await expect(api.authenticate()).rejects.toMatchObject({ kind: 'auth', status: 403 })
	})

	it('refreshes a rejected token once, then surfaces persistent authentication failure', async () => {
		const fetchImpl = vi.fn(
			async (url: string | URL | Request) =>
				new Response(
					JSON.stringify(String(url).endsWith('/Auth/token') ? { access_token: 'test-token', expires_in: 3600 } : {}),
					{ status: String(url).endsWith('/Auth/token') ? 200 : 401 },
				),
		)
		await expect(client(fetchImpl).getPlayers()).rejects.toMatchObject({ kind: 'auth', status: 401 })
		expect(fetchImpl).toHaveBeenCalledTimes(4)
	})
})
