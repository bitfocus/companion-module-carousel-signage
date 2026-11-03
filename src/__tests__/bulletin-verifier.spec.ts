import { describe, expect, it, vi } from 'vitest'
import { BulletinVerifier } from '../bulletin-verifier.js'

function setup() {
	const bulletins = [
		{ id: 'a', PartialBulletin: false, Tags: [{ TagName: 'shelter' }], Status: 'Current' },
		{ id: 'b', PartialBulletin: false, Tags: [{ TagName: 'evacuate' }], Status: 'Queued' },
	]
	const logs = [{ MessageID: 'command', Bulletins: [{ PageID: 'a', Error: false, Modified: true }] }]
	const api = {
		getBulletins: vi.fn(async () =>
			bulletins.map(({ id, Status }) => ({ id, Status, PartialBulletin: true, Tags: [] })),
		),
		getBulletin: vi.fn(async (id: string) => bulletins.find((bulletin) => bulletin.id === id)),
		getCapLog: vi.fn(async () => logs),
	}
	return { bulletins, logs, api, verifier: new BulletinVerifier(api, 1, ['shelter', 'evacuate']) }
}
describe('server bulletin verification', () => {
	it('rejects malformed CAP-log responses during preflight', async () => {
		const { api } = setup()
		const verifier = new BulletinVerifier({ ...api, getCapLog: async () => ({ error: 'unexpected response' }) }, 1, [
			'shelter',
			'evacuate',
		])
		await expect(verifier.preflight()).rejects.toThrow('Invalid CAP log response')
	})
	it('requires the exact CAP message and both selected-active/opposite-inactive state', async () => {
		const { verifier, bulletins } = setup()
		await verifier.preflight()
		expect(await verifier.verify('old-command', 'shelter', true)).toBe(false)
		expect(await verifier.verify('command', 'shelter', true)).toBe(true)
		bulletins[1].Status = 'Current'
		expect(await verifier.verify('command', 'shelter', true)).toBe(false)
	})
	it('allows an already-inactive clear with Modified false', async () => {
		const { verifier, bulletins, logs } = setup()
		bulletins[0].Status = 'Queued'
		logs[0].Bulletins[0].Modified = false
		expect(await verifier.verify('command', 'shelter', false)).toBe(true)
	})
	it('reads complete records when the list omits tags and accepts Carousel upcoming status', async () => {
		const { verifier, bulletins, api, logs } = setup()
		bulletins[0].Status = 'Current_Null'
		bulletins[1].Status = 'Current_Null'
		logs[0].Bulletins[0].Modified = false
		await verifier.preflight()
		expect(api.getBulletin).toHaveBeenCalledWith('a')
		expect(api.getBulletin).toHaveBeenCalledWith('b')
		expect(await verifier.verify('command', 'shelter', false)).toBe(true)
		expect(await verifier.verify('command', 'shelter', true)).toBe(false)
	})
	it('rejects incomplete details and mismatched identities', async () => {
		const { verifier, bulletins, api } = setup()
		bulletins[0].PartialBulletin = true
		await expect(verifier.preflight()).rejects.toThrow('incomplete bulletin detail')
		bulletins[0].PartialBulletin = false
		api.getBulletin.mockImplementation(async () => bulletins[1])
		await expect(verifier.preflight()).rejects.toThrow('incomplete bulletin detail')
	})
	it('bounds concurrent detail requests while checking every bulletin for duplicate tags', async () => {
		const { verifier, bulletins, api } = setup()
		for (let i = 0; i < 10; i++) bulletins.push({ ...bulletins[1], id: `other-${i}`, Tags: [] })
		let active = 0
		let maximum = 0
		api.getBulletin.mockImplementation(async (id) => {
			maximum = Math.max(maximum, ++active)
			await Promise.resolve()
			active--
			return bulletins.find((bulletin) => bulletin.id === id)
		})
		await verifier.preflight()
		expect(api.getBulletin).toHaveBeenCalledTimes(bulletins.length)
		expect(maximum).toBe(4)
	})
	it('rejects duplicate zone identifiers and propagates denied detail reads', async () => {
		const { verifier, bulletins, api } = setup()
		bulletins.push({ ...bulletins[0] })
		await expect(verifier.preflight()).rejects.toThrow('Invalid bulletin identifiers')
		bulletins.pop()
		api.getBulletin.mockRejectedValue(new Error('Bulletin read denied'))
		await expect(verifier.preflight()).rejects.toThrow('Bulletin read denied')
	})
	it('rejects zero matches, extra targets, wrong target and processing errors', async () => {
		const { verifier, logs } = setup()
		logs[0].Bulletins = []
		await expect(verifier.verify('command', 'shelter', true)).rejects.toThrow('expected bulletin')
		logs[0].Bulletins = [{ PageID: 'wrong', Error: false, Modified: true }]
		await expect(verifier.verify('command', 'shelter', true)).rejects.toThrow('expected bulletin')
		logs[0].Bulletins = [{ PageID: 'a', Error: true, Modified: true }]
		await expect(verifier.verify('command', 'shelter', true)).rejects.toThrow('processing error')
		logs[0].Bulletins.push({ PageID: 'other-zone', Error: false, Modified: true })
		await expect(verifier.verify('command', 'shelter', true)).rejects.toThrow('expected bulletin')
	})
	it('rejects missing/duplicate tags and unknown states instead of treating them as inactive', async () => {
		const { verifier, bulletins } = setup()
		bulletins[0].Status = 'Current_Error'
		await expect(verifier.preflight()).rejects.toThrow('not ready')
		bulletins[0].Status = 'Queued'
		bulletins.push({ ...bulletins[0], id: 'duplicate-tag' })
		await expect(verifier.preflight()).rejects.toThrow('exactly one')
		bulletins.splice(0, bulletins.length)
		await expect(verifier.preflight()).rejects.toThrow('exactly one')
	})
})
