import type { SomeCompanionConfigField } from '@companion-module/base'
import type { ModuleConfig, ModuleSecrets } from './types.js'
import { isValidRecord } from './override-manager.js'

export const DEFAULT_CONFIG: Omit<ModuleConfig, 'persistedOverrides'> = {
	baseUrl: '',
	authMode: 'apiKey',
	pollIntervalSeconds: 5,
	discoveryIntervalMinutes: 5,
	requestTimeoutSeconds: 10,
	offlineThresholdSeconds: 120,
	debug: false,
}

export function normalizeConfig(config: Partial<ModuleConfig>): ModuleConfig {
	return {
		...DEFAULT_CONFIG,
		emergencyEnabled: config.emergencyEnabled === true,
		emergencyZoneId: Number(config.emergencyZoneId) || 0,
		shelterTag: String(config.shelterTag ?? 'companion-emergency-shelter').trim(),
		evacuateTag: String(config.evacuateTag ?? 'companion-emergency-evacuate').trim(),
		authMode: config.authMode === 'capOnly' ? 'capOnly' : config.authMode === 'password' ? 'password' : 'apiKey',
		baseUrl: String(config.baseUrl ?? '').trim(),
		pollIntervalSeconds: clampNumber(config.pollIntervalSeconds, 1, 300, DEFAULT_CONFIG.pollIntervalSeconds),
		discoveryIntervalMinutes: clampNumber(
			config.discoveryIntervalMinutes,
			1,
			1440,
			DEFAULT_CONFIG.discoveryIntervalMinutes,
		),
		requestTimeoutSeconds: clampNumber(config.requestTimeoutSeconds, 1, 120, DEFAULT_CONFIG.requestTimeoutSeconds),
		offlineThresholdSeconds: clampNumber(
			config.offlineThresholdSeconds,
			10,
			86400,
			DEFAULT_CONFIG.offlineThresholdSeconds,
		),
		debug: config.debug === true,
		persistedOverrides: Array.isArray(config.persistedOverrides) ? config.persistedOverrides.filter(isValidRecord) : [],
		persistedOverridesBaseUrl: config.persistedOverridesBaseUrl,
	}
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) return fallback
	return Math.min(max, Math.max(min, parsed))
}

export function validateConnectionConfig(config: ModuleConfig, secrets: ModuleSecrets): string | undefined {
	if (!config.baseUrl) return 'Carousel server URL is required'

	try {
		const url = new URL(config.baseUrl)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Carousel server URL must use http or https'
		if (url.username || url.password) return 'Do not embed credentials in the Carousel server URL'
	} catch {
		return 'Carousel server URL is invalid'
	}

	if (config.authMode === 'capOnly' && (config.persistedOverrides?.length ?? 0) > 0)
		return 'Pending timed overrides require API authentication. Restore API mode to recover them before using CAP-only mode.'

	if (config.authMode === 'capOnly')
		return config.emergencyEnabled && secrets.capToken?.trim()
			? undefined
			: 'Enable CAP controls and enter the CAP token'
	if (config.authMode === 'apiKey') {
		if (!secrets.clientId?.trim() || !secrets.clientSecret) return 'Carousel API key and secret are required'
	} else if (!secrets.username?.trim() || !secrets.password) {
		return 'Carousel username and password are required'
	}

	return undefined
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'number',
			id: 'emergencyZoneId',
			label: 'Emergency bulletin zone ID (required for verification)',
			width: 12,
			min: 1,
			max: 2147483647,
			default: 0,
		},
		{ type: 'checkbox', id: 'emergencyEnabled', label: 'Enable emergency CAP controls', width: 12, default: false },
		{
			type: 'secret-text',
			id: 'capToken',
			label: 'Carousel CAP Token',
			width: 12,
			default: '',
			isVisibleExpression: '$(options:emergencyEnabled)',
		},
		{
			type: 'textinput',
			id: 'shelterTag',
			label: 'Shelter bulletin tag (unique)',
			width: 6,
			default: 'companion-emergency-shelter',
			isVisibleExpression: '$(options:emergencyEnabled)',
		},
		{
			type: 'textinput',
			id: 'evacuateTag',
			label: 'Evacuation bulletin tag (unique)',
			width: 6,
			default: 'companion-emergency-evacuate',
			isVisibleExpression: '$(options:emergencyEnabled)',
		},
		{
			type: 'textinput',
			id: 'baseUrl',
			label: 'Carousel Server URL',
			tooltip: 'For example https://example.carouselsignage.net (with or without /CarouselAPI/v1)',
			width: 12,
			default: '',
		},
		{
			type: 'dropdown',
			id: 'authMode',
			label: 'Authentication',
			width: 12,
			default: 'apiKey',
			choices: [
				{ id: 'capOnly', label: 'CAP clear only (unverified; no API authentication)' },
				{ id: 'apiKey', label: 'API key and secret (recommended)' },
				{ id: 'password', label: 'Username and password' },
			],
		},
		{
			type: 'secret-text',
			id: 'clientId',
			label: 'Carousel API Key',
			width: 6,
			default: '',
			isVisibleExpression: '$(options:authMode) == "apiKey"',
		},
		{
			type: 'secret-text',
			id: 'clientSecret',
			label: 'Carousel API Secret',
			width: 6,
			default: '',
			isVisibleExpression: '$(options:authMode) == "apiKey"',
		},
		{
			type: 'secret-text',
			id: 'username',
			label: 'Carousel Email Address',
			width: 6,
			default: '',
			isVisibleExpression: '$(options:authMode) == "password"',
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Carousel Password',
			width: 6,
			default: '',
			isVisibleExpression: '$(options:authMode) == "password"',
		},
		{
			type: 'number',
			id: 'pollIntervalSeconds',
			label: 'Player Poll Interval (seconds)',
			tooltip: 'How often to refresh player state for feedbacks and variables',
			width: 4,
			min: 1,
			max: 300,
			default: DEFAULT_CONFIG.pollIntervalSeconds,
		},
		{
			type: 'number',
			id: 'discoveryIntervalMinutes',
			label: 'Player/Channel Discovery (minutes)',
			tooltip: 'Static dropdown choices are refreshed separately from state polling',
			width: 4,
			min: 1,
			max: 1440,
			default: DEFAULT_CONFIG.discoveryIntervalMinutes,
		},
		{
			type: 'number',
			id: 'requestTimeoutSeconds',
			label: 'API Timeout (seconds)',
			width: 4,
			min: 1,
			max: 120,
			default: DEFAULT_CONFIG.requestTimeoutSeconds,
		},
		{
			type: 'number',
			id: 'offlineThresholdSeconds',
			label: 'Offline Threshold (seconds)',
			tooltip: 'Players with SecondsSinceLastCheckin at or above this value are considered offline',
			width: 8,
			min: 10,
			max: 86400,
			default: DEFAULT_CONFIG.offlineThresholdSeconds,
		},
		{
			type: 'checkbox',
			id: 'debug',
			label: 'Enable Debug Logging',
			width: 4,
			default: false,
		},
	]
}
