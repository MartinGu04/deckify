import { silentLogger, type Logger } from "./logger";

/**
 * A tiny observable value: holds an immutable snapshot and synchronously notifies subscribers when it changes. Listener failures are
 * isolated and logged.
 */
export class Observable<T extends object> {
	#value: Readonly<T>;
	readonly #listeners = new Set<(value: Readonly<T>) => void>();

	/**
	 * Initializes a new instance of the {@link Observable} class.
	 * @param initial Initial value.
	 * @param logger Logger for listener failures.
	 */
	constructor(
		initial: T,
		private readonly logger: Logger = silentLogger,
	) {
		this.#value = Object.freeze({ ...initial });
	}

	/**
	 * Gets the current value.
	 * @returns The value.
	 */
	get value(): Readonly<T> {
		return this.#value;
	}

	/**
	 * Replaces the value and notifies subscribers.
	 * @param next New value.
	 */
	set(next: T): void {
		this.#value = Object.freeze({ ...next });
		for (const listener of [...this.#listeners]) {
			try {
				listener(this.#value);
			} catch (err) {
				this.logger.error("State listener failed.", err);
			}
		}
	}

	/**
	 * Merges a partial update into the value and notifies subscribers.
	 * @param patch Fields to change.
	 */
	update(patch: Partial<T>): void {
		this.set({ ...this.#value, ...patch });
	}

	/**
	 * Subscribes to changes.
	 * @param listener Listener.
	 * @returns Function that unsubscribes the listener.
	 */
	subscribe(listener: (value: Readonly<T>) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
}
