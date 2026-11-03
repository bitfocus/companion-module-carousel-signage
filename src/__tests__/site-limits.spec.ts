import { describe, expect, it, vi } from 'vitest'
import type { ModuleInstance } from '../main.js'
import { UpdatePresets } from '../presets.js'
import { BuildVariableValues, UpdateVariableDefinitions } from '../variables.js'

describe('large sites', () => {
	it('caps routing presets and detailed variables without omitting players from JSON', () => {
		const players = Array.from({ length: 21 }, (_, id) => ({ id, Name: `Player ${id}`, CurrentChannelID: 1 }))
		const setPresetDefinitions = vi.fn()
		const setVariableDefinitions = vi.fn()
		const self = {
			getPlayers: () => players,
			getChannels: () => Array.from({ length: 5 }, (_, id) => ({ id, Name: `Channel ${id}` })),
			getOverrideRecords: () => [],
			isPlayerOffline: () => false,
			setPresetDefinitions,
			setVariableDefinitions,
			lastAction: '',
			lastError: '',
		} as unknown as ModuleInstance
		UpdatePresets(self)
		expect(Object.keys(setPresetDefinitions.mock.calls[0][1])).toHaveLength(21)
		UpdateVariableDefinitions(self)
		expect(
			Object.keys(setVariableDefinitions.mock.calls[0][0]).filter((key) => key.startsWith('player_')),
		).toHaveLength(80)
		const values = BuildVariableValues(self)
		expect(JSON.parse(String(values.players_json))).toHaveLength(21)
		expect(Object.keys(values).filter((key) => key.startsWith('player_'))).toHaveLength(80)
	})
})
