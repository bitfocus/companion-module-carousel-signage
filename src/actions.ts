import type { CompanionActionDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import type { OverrideScheduleMode, RestorePolicy, ScheduleBehavior } from './types.js'

const MAX_OVERRIDE_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export function UpdateActions(self: ModuleInstance): void {
	const playerChoices = self.getPlayerChoices()
	const channelChoices = self.getChannelChoices()
	const defaultPlayer = playerChoices[0]?.id ?? ''
	const defaultChannel = channelChoices[0]?.id ?? ''

	const actions: CompanionActionDefinitions = {
		emergencyArm: {
			name: 'Emergency: Arm for 10 seconds',
			options: [],
			callback: async () => safeAction(self, 'Arm emergency controls', async () => self.armEmergency()),
		},
		emergencySelect: {
			name: 'Emergency: Select or Clear Alert',
			description:
				'Clears the opposite bulletin before requesting the selected alert. Requires unique CAP tags and channel subscriptions. Request receipt is not proof of screen output.',
			options: [
				{
					type: 'dropdown',
					id: 'selection',
					label: 'Command',
					default: 'clear',
					choices: [
						{ id: 'shelter', label: 'Shelter in Place' },
						{ id: 'evacuate', label: 'Evacuate' },
						{ id: 'clear', label: 'Clear both alerts' },
					],
				},
				{
					type: 'checkbox',
					id: 'requireArm',
					label: 'Require ARM first (disable only in a protected hold group)',
					default: true,
				},
			],
			callback: async (action) =>
				safeAction(self, 'Emergency command', async () => {
					const choice = action.options.selection
					if (choice !== 'shelter' && choice !== 'evacuate' && choice !== 'clear')
						throw new Error('Select an emergency command')
					await self.selectEmergency(choice, action.options.requireArm !== false)
				}),
		},
		setPlayerChannelPermanent: {
			name: 'Set Player Channel – Permanent',
			description: 'Set the player default channel, optionally removing its channel schedule association',
			options: [
				{
					type: 'dropdown',
					id: 'playerId',
					label: 'Player',
					default: defaultPlayer,
					choices: playerChoices,
				},
				{
					type: 'dropdown',
					id: 'channelId',
					label: 'Channel',
					default: defaultChannel,
					choices: channelChoices,
				},
				{
					type: 'dropdown',
					id: 'scheduleBehavior',
					label: 'Schedule Behavior',
					default: 'preserve',
					choices: [
						{ id: 'preserve', label: 'Preserve schedule association' },
						{ id: 'remove', label: 'Override / remove schedule association' },
					],
				},
			],
			callback: async (action) => {
				await safeAction(self, 'Set player channel permanently', async () => {
					const playerId = requiredId(action.options.playerId, 'player')
					const channelId = requiredId(action.options.channelId, 'channel')
					const scheduleBehavior = action.options.scheduleBehavior === 'remove' ? 'remove' : 'preserve'
					await self.executePermanent(playerId, channelId, scheduleBehavior as ScheduleBehavior)
				})
			},
		},
		setPlayerChannelTimed: {
			name: 'Set Player Channel – Timed Override',
			description: 'Temporarily route a player, then restore the first pre-override channel and schedule snapshot',
			options: [
				{
					type: 'dropdown',
					id: 'playerId',
					label: 'Player',
					default: defaultPlayer,
					choices: playerChoices,
				},
				{
					type: 'dropdown',
					id: 'channelId',
					label: 'Temporary Channel',
					default: defaultChannel,
					choices: channelChoices,
				},
				{
					type: 'number',
					id: 'duration',
					label: 'Duration',
					default: 10,
					min: 1,
					max: 86400,
				},
				{
					type: 'dropdown',
					id: 'durationUnit',
					label: 'Duration Unit',
					default: 'minutes',
					choices: [
						{ id: 'seconds', label: 'Seconds' },
						{ id: 'minutes', label: 'Minutes' },
						{ id: 'hours', label: 'Hours' },
					],
				},
				{
					type: 'dropdown',
					id: 'scheduleMode',
					label: 'Schedule During Override',
					default: 'suspend',
					choices: [
						{ id: 'suspend', label: 'Suspend schedule (temporary channel takes precedence)' },
						{ id: 'preserve', label: 'Preserve schedule (schedule may determine current channel)' },
					],
				},
				{
					type: 'dropdown',
					id: 'restorePolicy',
					label: 'Restore Behavior',
					default: 'always',
					choices: [
						{ id: 'always', label: 'Always restore the saved state' },
						{ id: 'ifUnchanged', label: 'Restore only if the override target is still the default' },
					],
				},
			],
			callback: async (action) => {
				await safeAction(self, 'Set timed player channel override', async () => {
					const playerId = requiredId(action.options.playerId, 'player')
					const channelId = requiredId(action.options.channelId, 'channel')
					const durationMs = durationToMilliseconds(action.options.duration, action.options.durationUnit)
					const scheduleMode: OverrideScheduleMode = action.options.scheduleMode === 'preserve' ? 'preserve' : 'suspend'
					const restorePolicy: RestorePolicy = action.options.restorePolicy === 'ifUnchanged' ? 'ifUnchanged' : 'always'
					await self.executeTimedOverride(playerId, channelId, durationMs, scheduleMode, restorePolicy)
				})
			},
		},
		restoreTimedOverride: {
			name: 'Restore Timed Override Now',
			description: 'Cancel the timer and restore the original channel and channel schedule snapshot immediately',
			options: [
				{
					type: 'dropdown',
					id: 'playerId',
					label: 'Player',
					default: defaultPlayer,
					choices: playerChoices,
				},
			],
			callback: async (action) => {
				await safeAction(self, 'Restore timed player override', () =>
					self.executeRestore(requiredId(action.options.playerId, 'player')),
				)
			},
		},
		refreshResources: {
			name: 'Refresh Players and Channels',
			description: 'Immediately reload player and channel dropdown choices from Carousel',
			options: [],
			callback: async () => self.executeRefresh(),
		},
	}

	self.setActionDefinitions(actions)
}

function requiredId(value: unknown, label: string): number {
	if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
		throw new Error(`Select a valid ${label}`)
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Select a valid ${label}`)
	return parsed
}

function durationToMilliseconds(durationValue: unknown, unitValue: unknown): number {
	const duration = Number(durationValue)
	if (!Number.isFinite(duration) || duration <= 0) throw new Error('Duration must be a positive number')
	const multiplier = unitValue === 'seconds' ? 1000 : unitValue === 'hours' ? 3_600_000 : 60_000
	const result = duration * multiplier
	if (result > MAX_OVERRIDE_DURATION_MS) throw new Error('Timed overrides cannot exceed 30 days')
	return result
}

async function safeAction(self: ModuleInstance, description: string, operation: () => Promise<void>): Promise<void> {
	try {
		await operation()
	} catch (error) {
		self.reportActionError(description, error)
	}
}
