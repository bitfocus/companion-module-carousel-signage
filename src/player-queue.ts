export class PlayerOperationQueue {
	private readonly tails = new Map<number, Promise<void>>()

	async idle(): Promise<void> {
		await Promise.all(this.tails.values())
	}

	async run<T>(playerId: number, operation: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(playerId) ?? Promise.resolve()
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const tail = previous.catch(() => undefined).then(() => gate)
		this.tails.set(playerId, tail)

		await previous.catch(() => undefined)
		try {
			return await operation()
		} finally {
			release()
			if (this.tails.get(playerId) === tail) this.tails.delete(playerId)
		}
	}
}
