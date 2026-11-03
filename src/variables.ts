import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import type { ModuleInstance } from './main.js'

const MAX_DETAILED_PLAYERS = 20

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions = {
		emergency_verified_at: { name: 'Last successful command verification time (UTC; not continuous monitoring)' },
		emergency_armed: { name: 'Emergency controls armed' },
		emergency_request_state: { name: 'Last CAP command verification (not live screen state)' },
		emergency_error: { name: 'Emergency CAP error (retained until next command)' },
		players_count: { name: 'Number of Carousel players' },
		channels_count: { name: 'Number of Carousel channels' },
		active_overrides_count: { name: 'Number of active timed overrides' },
		players_json: { name: 'All player state as compact JSON' },
		last_action: { name: 'Last successful module action' },
		last_error: { name: 'Last module error' },
	}

	for (const player of self.getPlayers().slice(0, MAX_DETAILED_PLAYERS)) {
		const prefix = `player_${player.id}`
		definitions[`${prefix}_current_channel`] = { name: `${player.Name}: current channel name` }
		definitions[`${prefix}_online`] = { name: `${player.Name}: online` }
		definitions[`${prefix}_override_active`] = { name: `${player.Name}: timed override active` }
		definitions[`${prefix}_override_remaining_seconds`] = {
			name: `${player.Name}: timed override seconds remaining`,
		}
	}

	self.setVariableDefinitions(definitions)
}

export function BuildVariableValues(self: ModuleInstance): CompanionVariableValues {
	const players = self.getPlayers()
	const overrides = self.getOverrideRecords()
	const overrideMap = new Map(overrides.map((record) => [record.playerId, record]))
	const channelNames = new Map(self.getChannels().map((channel) => [channel.id, channel.Name]))
	const values: CompanionVariableValues = {
		emergency_verified_at: self.emergency?.verifiedAt ?? '',
		emergency_armed: self.emergency?.armed ?? false,
		emergency_request_state: self.emergency?.state ?? 'unconfigured',
		emergency_error: self.emergency?.error || self.emergencyConfigError || '',
		players_count: players.length,
		channels_count: self.getChannels().length,
		active_overrides_count: overrides.length,
		last_action: self.lastAction,
		last_error: self.lastError,
		players_json: JSON.stringify(
			players.map((player) => ({
				id: player.id,
				name: player.Name,
				currentChannelId: player.CurrentChannelID,
				currentChannelName:
					player.CurrentChannelID === null ? null : (channelNames.get(player.CurrentChannelID) ?? null),
				defaultChannelId: player.DefaultChannelID,
				channelScheduleId: player.ChannelScheduleID,
				online: !self.isPlayerOffline(player),
				timedOverrideActive: overrideMap.has(player.id),
			})),
		),
	}

	for (const player of players.slice(0, MAX_DETAILED_PLAYERS)) {
		const prefix = `player_${player.id}`
		const record = overrideMap.get(player.id)
		values[`${prefix}_current_channel`] =
			player.CurrentChannelID === null
				? ''
				: (channelNames.get(player.CurrentChannelID) ?? String(player.CurrentChannelID))
		values[`${prefix}_online`] = !self.isPlayerOffline(player)
		values[`${prefix}_override_active`] = record !== undefined
		values[`${prefix}_override_remaining_seconds`] = record
			? Math.max(0, Math.ceil((record.expiresAt - Date.now()) / 1000))
			: 0
	}

	return values
}
