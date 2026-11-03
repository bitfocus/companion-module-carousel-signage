import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { default: ModuleInstance } = await import(
	pathToFileURL(resolve(process.argv[2] ?? 'pkg/carousel-signage/main.js'))
)

// Every request is handled in memory; this test cannot contact a configured installation.
const originalFetch = globalThis.fetch
const bulletins = ['shelter', 'evacuate'].map((tag) => ({
	id: tag,
	PartialBulletin: false,
	Tags: [{ TagName: tag }],
	Status: 'Current_Null',
}))
const logs = []
const commands = []
const variables = {}
let denyDetails = false
let active
const json = (value) => new globalThis.Response(JSON.stringify(value))
globalThis.COMPANION_LOGGER = () => {}
globalThis.fetch = async (input, init) => {
	const url = new URL(input)
	assert.equal(url.origin, 'https://example.invalid')
	assert.equal(init.redirect, 'error')
	const path = url.pathname.replace('/CarouselAPI/v1', '')
	if (path === '/Auth/token') return json({ access_token: 'test-access', expires_in: 3600 })
	if (path === '/CAP') {
		assert.equal(init.method, 'POST')
		assert.equal(url.searchParams.get('token'), 'test-cap')
		const target = bulletins.find((bulletin) => bulletin.id === url.searchParams.get('tags'))
		assert.ok(target)
		const messageId = init.body.match(/<identifier>([^<]+)<\/identifier>/)?.[1]
		const event = init.body.match(/<event>([^<]+)<\/event>/)?.[1]
		assert.ok(messageId)
		assert.ok(['CLEAR', 'SHELTER IN PLACE', 'EVACUATION IN EFFECT'].includes(event))
		const status = event === 'CLEAR' ? 'Current_Null' : 'Current'
		const modified = target.Status !== status
		target.Status = status
		assert.ok(bulletins.filter((bulletin) => bulletin.Status === 'Current').length <= 1)
		commands.push({ tag: target.id, event })
		logs.push({ MessageID: messageId, Bulletins: [{ PageID: target.id, Error: false, Modified: modified }] })
		return new globalThis.Response('Accepted')
	}
	assert.equal(init.headers.authorization, 'Bearer test-access')
	if (path === '/Players' || path === '/Channels') return json([])
	if (path === '/CAPLog') return json(logs)
	if (path === '/Bulletins') {
		assert.equal(url.searchParams.get('zoneID'), '1')
		return json(bulletins.map(({ id, Status }) => ({ id, Status, PartialBulletin: true, Tags: [] })))
	}
	const bulletin = bulletins.find((item) => path === `/Bulletins/${item.id}`)
	if (bulletin) return denyDetails ? new globalThis.Response('', { status: 403 }) : json(bulletin)
	throw new Error('Unexpected mock endpoint')
}

const noop = () => {}
try {
	active = new ModuleInstance({
		id: 'emergency-package-test',
		label: 'emergency-package-test',
		_isInstanceContext: true,
		saveConfig: noop,
		setActionDefinitions: noop,
		setFeedbackDefinitions: noop,
		setPresetDefinitions: noop,
		setVariableDefinitions: noop,
		setVariableValues: (values) => Object.assign(variables, values),
		checkFeedbacks: noop,
		updateStatus: noop,
	})
	await active.init(
		{
			baseUrl: 'https://example.invalid',
			authMode: 'apiKey',
			emergencyEnabled: true,
			emergencyZoneId: 1,
			shelterTag: 'shelter',
			evacuateTag: 'evacuate',
		},
		false,
		{ clientId: 'test', clientSecret: 'test', capToken: 'test-cap' },
	)
	await active.executeRefresh()
	for (const selection of ['shelter', 'evacuate', 'clear']) {
		active.armEmergency()
		await active.selectEmergency(selection)
		assert.equal(variables.emergency_request_state, `${selection}-verified`)
		assert.ok(variables.emergency_verified_at)
	}
	assert.equal(commands.length, 6)
	assert.ok(bulletins.every((bulletin) => bulletin.Status === 'Current_Null'))
	denyDetails = true
	active.armEmergency()
	await assert.rejects(active.selectEmergency('shelter'), /403/)
	assert.equal(commands.length, 6)
	assert.equal(variables.emergency_request_state, 'error')
	assert.equal(variables.emergency_verified_at, '')
	console.log(
		'Packaged emergency smoke passed: separate alerts, correlated verification, clear, and denied-read interlock.',
	)
} finally {
	await active?.destroy()
	globalThis.fetch = originalFetch
}
