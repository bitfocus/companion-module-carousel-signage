export interface BulletinVerificationApi {
	getBulletins(zoneId: number): Promise<unknown>
	getBulletin(bulletinId: string): Promise<unknown>
	getCapLog(): Promise<unknown>
}

type JsonObject = Record<string, unknown>
function object(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Unknown states must never be interpreted as inactive.
// Carousel groups Current_Null with upcoming bulletins, including alerts with all weekdays off.
const INACTIVE = new Set(['Queued', 'Current_Null', 'Hold', 'Saved', 'Old', 'Disabled'])

export class BulletinVerifier {
	constructor(
		private readonly api: BulletinVerificationApi,
		private readonly zoneId: number,
		private readonly tags: readonly string[],
	) {
		if (!Number.isSafeInteger(zoneId) || zoneId < 1) throw new Error('Enter the emergency bulletin zone ID')
	}

	async preflight(): Promise<void> {
		const targets = await this.readTargets()
		if (new Set(targets.map((target) => target.id)).size !== this.tags.length)
			throw new Error('Emergency tags must target different bulletins')
		await this.readCapLog()
	}

	private async readCapLog(): Promise<JsonObject[]> {
		const logs = await this.api.getCapLog()
		if (!Array.isArray(logs) || !logs.every(object)) throw new Error('Invalid CAP log response')
		return logs
	}

	private async readTargets(): Promise<JsonObject[]> {
		const response = await this.api.getBulletins(this.zoneId)
		if (!Array.isArray(response) || !response.every(object)) throw new Error('Invalid bulletin response')
		const ids = response.map((bulletin) => bulletin.id)
		if (!ids.every((id): id is string => typeof id === 'string' && id.length > 0) || new Set(ids).size !== ids.length)
			throw new Error('Invalid bulletin identifiers in zone response')
		// The list endpoint returns partial records with empty Tags, even for tagged bulletins.
		// Read each complete record with bounded concurrency so duplicates cannot be overlooked.
		const bulletins: JsonObject[] = []
		for (let offset = 0; offset < ids.length; offset += 4) {
			const batch = await Promise.all(
				ids.slice(offset, offset + 4).map(async (id) => {
					const bulletin = await this.api.getBulletin(id)
					if (
						!object(bulletin) ||
						bulletin.id !== id ||
						bulletin.PartialBulletin !== false ||
						!Array.isArray(bulletin.Tags)
					)
						throw new Error('Invalid or incomplete bulletin detail response')
					return bulletin
				}),
			)
			bulletins.push(...batch)
		}
		return this.tags.map((tag) => {
			const matches = bulletins.filter(
				(bulletin) =>
					Array.isArray(bulletin.Tags) &&
					bulletin.Tags.some(
						(value: unknown) =>
							object(value) && typeof value.TagName === 'string' && value.TagName.toLowerCase() === tag.toLowerCase(),
					),
			)
			if (matches.length !== 1)
				throw new Error('Each emergency tag must match exactly one bulletin in the configured zone')
			const bulletin = matches[0]
			if (
				typeof bulletin.id !== 'string' ||
				!bulletin.id ||
				bulletin.IsDeleted === true ||
				bulletin.IsCorrupt === true ||
				bulletin.HasErrors === true
			)
				throw new Error('Emergency bulletin is missing or reports an error')
			if (bulletin.Status !== 'Current' && !INACTIVE.has(String(bulletin.Status)))
				throw new Error('Emergency bulletin status is unknown or not ready')
			return bulletin
		})
	}

	async verify(messageId: string, tag: string, active: boolean): Promise<boolean> {
		const logs = await this.readCapLog()
		const matches = logs.filter((log) => log.MessageID === messageId)
		if (matches.length === 0) return false
		if (matches.length !== 1) throw new Error('Ambiguous CAP log result')
		const targets = await this.readTargets()
		const target = targets[this.tags.indexOf(tag)]
		if (!target) throw new Error('Unknown emergency tag')
		const results = matches[0].Bulletins
		if (!Array.isArray(results) || results.length !== 1 || !object(results[0]) || results[0].PageID !== target.id)
			throw new Error('CAP did not target exactly the expected bulletin; check tag uniqueness across all zones')
		if (results[0].Error !== false || typeof results[0].Modified !== 'boolean')
			throw new Error('Carousel reported a CAP processing error')
		// An idempotent clear may legitimately leave Modified false.
		return active
			? target.Status === 'Current' &&
					targets.filter((other) => other.id !== target.id).every((other) => INACTIVE.has(String(other.Status)))
			: INACTIVE.has(String(target.Status))
	}
}
