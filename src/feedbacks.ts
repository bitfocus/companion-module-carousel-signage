import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.js'

const COLOR_WHITE = combineRgb(255, 255, 255)
const COLOR_BLACK = combineRgb(0, 0, 0)
const COLOR_GREEN = combineRgb(0, 153, 0)
const COLOR_AMBER = combineRgb(204, 153, 0)
const COLOR_RED = combineRgb(180, 0, 0)

export function UpdateFeedbacks(self: ModuleInstance): void {
	const playerChoices = self.getPlayerChoices()
	const channelChoices = self.getChannelChoices()
	const defaultPlayer = playerChoices[0]?.id ?? ''
	const defaultChannel = channelChoices[0]?.id ?? ''

	const feedbacks: CompanionFeedbackDefinitions = {
		emergencyArmed: {
			type: 'boolean',
			name: 'Emergency controls armed',
			options: [],
			defaultStyle: { color: COLOR_BLACK, bgcolor: COLOR_AMBER },
			callback: () => self.emergency?.armed ?? false,
		},
		emergencyRequestState: {
			type: 'boolean',
			name: 'Emergency CAP command verification (not live screen state)',
			defaultStyle: { color: COLOR_WHITE, bgcolor: COLOR_AMBER },
			options: [
				{
					type: 'dropdown',
					id: 'state',
					label: 'Request status',
					default: 'error',
					choices: [
						'unknown',
						'sending',
						'verifying',
						'shelter-verified',
						'evacuate-verified',
						'clear-verified',
						'shelter-requested',
						'evacuate-requested',
						'clear-requested',
						'error',
					].map((id) => ({ id, label: id })),
				},
			],
			callback: (feedback) => self.emergency?.state === feedback.options.state,
		},
		playerOnChannel: {
			type: 'boolean',
			name: 'Player Is On Channel',
			description: 'True when the observed CurrentChannelID equals the selected channel',
			defaultStyle: { color: COLOR_WHITE, bgcolor: COLOR_GREEN },
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
			],
			callback: (feedback) => {
				const player = self.getPlayer(Number(feedback.options.playerId))
				return player !== undefined && player.CurrentChannelID === Number(feedback.options.channelId)
			},
		},
		playerTimedOverrideActive: {
			type: 'boolean',
			name: 'Player Has Active Timed Override',
			defaultStyle: { color: COLOR_BLACK, bgcolor: COLOR_AMBER },
			options: [
				{
					type: 'dropdown',
					id: 'playerId',
					label: 'Player',
					default: defaultPlayer,
					choices: playerChoices,
				},
			],
			callback: (feedback) => self.hasActiveOverride(Number(feedback.options.playerId)),
		},
		playerOffline: {
			type: 'boolean',
			name: 'Player Offline / Not Checking In',
			description: 'Uses SecondsSinceLastCheckin, with Status as a fallback if check-in seconds are unavailable',
			defaultStyle: { color: COLOR_WHITE, bgcolor: COLOR_RED },
			options: [
				{
					type: 'dropdown',
					id: 'playerId',
					label: 'Player',
					default: defaultPlayer,
					choices: playerChoices,
				},
				{
					type: 'number',
					id: 'thresholdSeconds',
					label: 'Offline After (seconds)',
					default: self.config.offlineThresholdSeconds,
					min: 10,
					max: 86400,
				},
			],
			callback: (feedback) => {
				const player = self.getPlayer(Number(feedback.options.playerId))
				return player ? self.isPlayerOffline(player, Number(feedback.options.thresholdSeconds)) : true
			},
		},
	}

	self.setFeedbackDefinitions(feedbacks)
}
