import { describe, expect, it, vi } from 'vitest'
import type { ModuleInstance } from '../main.js'
import { UpdatePresets } from '../presets.js'

describe('presets', () => {
	it('uses distinct idle and active restore colors and targets the correct player', () => {
		const setPresetDefinitions = vi.fn()
		UpdatePresets({
			getPlayers: () => [{ id: 20, Name: 'Test Player' }],
			getChannels: () => [],
			setPresetDefinitions,
		} as unknown as ModuleInstance)
		const preset = setPresetDefinitions.mock.calls[0][1].restore_20
		expect(preset.style.bgcolor).not.toBe(preset.feedbacks[0].style.bgcolor)
		expect(preset.steps[0].down[0]).toEqual({
			actionId: 'restoreTimedOverride',
			options: { playerId: '20' },
		})
		expect(preset.feedbacks[0].options).toEqual({ playerId: '20' })
	})
})
