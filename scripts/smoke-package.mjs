import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Exercise the built entry point against loopback only, never a configured site.
const { default: ModuleInstance } = await import(
	pathToFileURL(resolve(process.argv[2] ?? 'pkg/carousel-signage/main.js'))
)
const player = { id: 90, Name: 'Test Player', DefaultChannelID: 4, CurrentChannelID: 4, ChannelScheduleID: 2 }
const channels = [
	{ id: 4, Name: 'Original' },
	{ id: 8, Name: 'Temporary' },
]
let writes = 0
let saved
let active
globalThis.COMPANION_LOGGER = () => {}
const server = createServer(async (request, response) => {
	const chunks = []
	for await (const chunk of request) chunks.push(chunk)
	const body = Buffer.concat(chunks).toString()
	const path = new URL(request.url, 'http://localhost').pathname
	let value
	if (path.endsWith('/Auth/token')) {
		const form = new URLSearchParams(body)
		assert.equal(form.get('client_id'), 'test')
		assert.equal(form.get('client_secret'), 'test')
		value = { access_token: 'test-token', expires_in: 3600 }
	} else {
		assert.equal(request.headers.authorization, 'Bearer test-token')
		if (path.endsWith('/Players/bulkupdate')) {
			const update = JSON.parse(body)
			assert.deepEqual(update.IDs, [90])
			assert.equal(typeof update.Properties.DefaultChannelID, 'string')
			player.DefaultChannelID = Number(update.Properties.DefaultChannelID)
			if ('ChannelScheduleID' in update.Properties) {
				assert.ok(
					update.Properties.ChannelScheduleID === null || typeof update.Properties.ChannelScheduleID === 'string',
				)
				player.ChannelScheduleID =
					update.Properties.ChannelScheduleID === null ? null : Number(update.Properties.ChannelScheduleID)
			}
			writes++
			value = {}
		} else if (path.endsWith('/Players/90')) value = player
		else if (path.endsWith('/Players')) value = [player]
		else if (path.endsWith('/Channels')) value = channels
		else throw new Error('Unexpected mock endpoint')
	}
	response.writeHead(200, { 'content-type': 'application/json' })
	response.end(JSON.stringify(value))
})

function context() {
	const noop = () => {}
	return {
		id: 'package-test',
		label: 'package-test',
		_isInstanceContext: true,
		saveConfig(config, secrets) {
			assert.equal(secrets, undefined)
			saved = structuredClone(config)
		},
		setActionDefinitions: noop,
		setFeedbackDefinitions: noop,
		setPresetDefinitions: noop,
		setVariableDefinitions: noop,
		setVariableValues: noop,
		checkFeedbacks: noop,
		updateStatus: noop,
	}
}

async function until(predicate) {
	const deadline = Date.now() + 5000
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('Packaged module did not reach expected state')
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

try {
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	active = new ModuleInstance(context())
	await active.init({ baseUrl: `http://127.0.0.1:${server.address().port}`, authMode: 'apiKey' }, false, {
		clientId: 'test',
		clientSecret: 'test',
	})
	await until(() => active.getChannels().length === 2)
	await active.executeTimedOverride(90, 8, 60_000, 'suspend', 'always')
	assert.equal(player.DefaultChannelID, 8)
	assert.equal(player.ChannelScheduleID, null)
	assert.equal(saved.persistedOverrides[0].originalChannelScheduleId, 2)
	await active.destroy()
	saved.persistedOverrides[0].expiresAt = Date.now() - 1
	active = new ModuleInstance(context())
	await active.init(saved, false, { clientId: 'test', clientSecret: 'test' })
	await until(() => writes === 2 && saved.persistedOverrides.length === 0)
	assert.equal(player.DefaultChannelID, 4)
	assert.equal(player.ChannelScheduleID, 2)
	console.log(
		'Packaged module smoke passed: authentication, discovery, timed routing, persisted restart, expired schedule restoration.',
	)
} finally {
	await active?.destroy()
	server.closeAllConnections()
	await new Promise((resolve) => server.close(resolve))
}
