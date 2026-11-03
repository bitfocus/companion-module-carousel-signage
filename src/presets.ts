import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type { ModuleInstance, ModuleSchema } from './main.js'

const MAX_ROUTING_PRESETS = 100
const COLOR_WHITE = combineRgb(255, 255, 255)
const COLOR_BLACK = combineRgb(0, 0, 0)
const COLOR_GREEN = combineRgb(0, 130, 0)
const COLOR_AMBER = combineRgb(204, 153, 0)

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const sections: CompanionPresetSection<ModuleSchema>[] = []
	const players = self.getPlayers()
	const channels = self.getChannels()

	if (players.length * channels.length <= MAX_ROUTING_PRESETS) {
		for (const player of players) {
			const playerPresetIds: string[] = []
			for (const channel of channels) {
				const presetId = `route_${player.id}_${channel.id}`
				playerPresetIds.push(presetId)
				presets[presetId] = {
					type: 'simple',
					name: `${player.Name} → ${channel.Name}`,
					style: {
						text: `${shortLabel(player.Name)}\n→\n${shortLabel(channel.Name)}`,
						size: 'auto',
						color: COLOR_WHITE,
						bgcolor: COLOR_BLACK,
					},
					steps: [
						{
							down: [
								{
									actionId: 'setPlayerChannelPermanent',
									options: { playerId: String(player.id), channelId: String(channel.id), scheduleBehavior: 'preserve' },
								},
							],
							up: [],
						},
					],
					feedbacks: [
						{
							feedbackId: 'playerOnChannel',
							options: { playerId: String(player.id), channelId: String(channel.id) },
							style: { color: COLOR_WHITE, bgcolor: COLOR_GREEN },
						},
					],
				}
			}
			sections.push({
				id: `channel_routing_${player.id}`,
				name: `Channel Routing: ${player.Name}`,
				definitions: playerPresetIds,
			})
		}
	} else {
		sections.push({
			id: 'channel_routing_notice',
			name: 'Channel Routing',
			description: `${players.length} players × ${channels.length} channels exceeds the ${MAX_ROUTING_PRESETS}-preset safety limit. Configure routing actions manually.`,
			definitions: [],
		})
	}

	const restorePresetIds: string[] = []
	for (const player of players) {
		const presetId = `restore_${player.id}`
		restorePresetIds.push(presetId)
		presets[presetId] = {
			type: 'simple',
			name: `Restore ${player.Name} timed override`,
			style: {
				text: `RESTORE\n${shortLabel(player.Name)}`,
				size: 'auto',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
			},
			steps: [
				{
					down: [{ actionId: 'restoreTimedOverride', options: { playerId: String(player.id) } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'playerTimedOverrideActive',
					options: { playerId: String(player.id) },
					style: { color: COLOR_BLACK, bgcolor: COLOR_AMBER },
				},
			],
		}
	}
	if (restorePresetIds.length > 0) {
		sections.push({ id: 'timed_overrides', name: 'Timed Overrides', definitions: restorePresetIds })
	}

	self.setPresetDefinitions(sections, presets)
}

function shortLabel(value: string): string {
	const trimmed = value.trim()
	return trimmed.length > 18 ? `${trimmed.slice(0, 17)}…` : trimmed
}
