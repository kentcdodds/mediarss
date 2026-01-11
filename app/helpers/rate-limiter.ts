/**
 * In-memory rate limiter using sliding window algorithm.
 * Tracks requests by IP address and enforces configurable limits.
 *
 * Supports failure penalties: failed requests (4xx/5xx) can be recorded
 * with a penalty multiplier, effectively reducing the rate limit for
 * devices that generate failed requests. This helps prevent brute force attacks.
 */

interface RateLimiterOptions {
	/** Name of this rate limiter (used for logging and key namespacing) */
	name: string
	/** Maximum number of requests allowed within the time window */
	maxRequests: number
	/** Time window in milliseconds (default: 60000 = 1 minute) */
	windowMs?: number
}

/** Default penalty multiplier for failed requests (10x = 1/10th rate limit) */
const DEFAULT_FAILURE_PENALTY = 9

/**
 * Rate limiter class that tracks request timestamps per key (typically IP).
 * Uses a sliding window algorithm to count requests within the time window.
 */
export class RateLimiter {
	#requests = new Map<string, number[]>()
	readonly #name: string
	readonly #maxRequests: number
	readonly #windowMs: number
	#cleanupInterval: ReturnType<typeof setInterval> | null = null

	constructor({ name, maxRequests, windowMs = 60_000 }: RateLimiterOptions) {
		this.#name = name
		this.#maxRequests = maxRequests
		this.#windowMs = windowMs
		// Run cleanup every minute to prevent memory leaks
		this.#cleanupInterval = setInterval(() => this.#cleanup(), 60_000)
	}

	/**
	 * Check if a request from the given key (IP) is allowed.
	 * Returns info about whether the request is allowed and remaining quota.
	 */
	check(key: string): { allowed: boolean; remaining: number; resetMs: number } {
		const now = Date.now()
		const windowStart = now - this.#windowMs

		// Get existing timestamps and filter to current window
		const timestamps = this.#requests.get(key) ?? []
		const recentTimestamps = timestamps.filter((t) => t > windowStart)

		const remaining = Math.max(0, this.#maxRequests - recentTimestamps.length)
		const oldestTimestamp = recentTimestamps[0]
		const resetMs =
			oldestTimestamp !== undefined
				? Math.max(0, oldestTimestamp + this.#windowMs - now)
				: 0

		if (recentTimestamps.length >= this.#maxRequests) {
			// Update stored timestamps (cleanup old ones)
			this.#requests.set(key, recentTimestamps)
			return { allowed: false, remaining: 0, resetMs }
		}

		// Add new timestamp and store
		recentTimestamps.push(now)
		this.#requests.set(key, recentTimestamps)

		return { allowed: true, remaining: remaining - 1, resetMs }
	}

	/**
	 * Simple check that returns boolean only.
	 */
	isAllowed(key: string): boolean {
		return this.check(key).allowed
	}

	/**
	 * Record a failed request, applying a penalty to the rate limit.
	 * This adds additional timestamps to effectively reduce the rate limit
	 * for clients that generate failed requests (e.g., brute force attempts).
	 *
	 * By default, a failed request consumes 10x the normal rate limit
	 * (the initial request + 9 penalty slots), giving the client 1/10th
	 * the effective rate limit for failed requests.
	 *
	 * @param key - The rate limit key (typically IP + limiter name)
	 * @param penalty - Additional slots to consume (default: 9, for 10x total)
	 * @returns The penalty that was applied (0 if penalty was non-positive)
	 */
	recordFailure(
		key: string,
		penalty: number = DEFAULT_FAILURE_PENALTY,
	): number {
		if (penalty <= 0) return 0

		const now = Date.now()
		const windowStart = now - this.#windowMs

		// Get existing timestamps and filter to current window
		const timestamps = this.#requests.get(key) ?? []
		const recentTimestamps = timestamps.filter((t) => t > windowStart)

		// Add penalty timestamps (all at current time)
		for (let i = 0; i < penalty; i++) {
			recentTimestamps.push(now)
		}

		this.#requests.set(key, recentTimestamps)
		return penalty
	}

	/**
	 * Remove stale entries to prevent memory leaks.
	 */
	#cleanup(): void {
		const now = Date.now()
		const windowStart = now - this.#windowMs

		for (const [key, timestamps] of this.#requests) {
			const recent = timestamps.filter((t) => t > windowStart)
			if (recent.length === 0) {
				this.#requests.delete(key)
			} else {
				this.#requests.set(key, recent)
			}
		}
	}

	/**
	 * Stop the cleanup interval (for testing/cleanup).
	 */
	destroy(): void {
		if (this.#cleanupInterval) {
			clearInterval(this.#cleanupInterval)
			this.#cleanupInterval = null
		}
	}

	/**
	 * Get the name of this rate limiter.
	 */
	getName(): string {
		return this.#name
	}

	/**
	 * Get the configured max requests for this rate limiter.
	 */
	getMaxRequests(): number {
		return this.#maxRequests
	}
}

// Pre-configured rate limiters for different route categories
// Limits are per minute per IP, configurable via environment variables
// Uses lazy initialization to allow env to be configured before first use

import { getRateLimitConfig } from '#app/config/env.ts'

let _adminWriteLimiter: RateLimiter | null = null
let _adminReadLimiter: RateLimiter | null = null
let _mediaLimiter: RateLimiter | null = null
let _defaultLimiter: RateLimiter | null = null

/** Admin write operations (POST/PUT/DELETE/PATCH) */
export function getAdminWriteLimiter(): RateLimiter {
	if (!_adminWriteLimiter) {
		_adminWriteLimiter = new RateLimiter({
			name: 'admin-write',
			maxRequests: getRateLimitConfig().adminWrite,
		})
	}
	return _adminWriteLimiter
}

/** Admin read operations (GET/HEAD/OPTIONS) */
export function getAdminReadLimiter(): RateLimiter {
	if (!_adminReadLimiter) {
		_adminReadLimiter = new RateLimiter({
			name: 'admin-read',
			maxRequests: getRateLimitConfig().adminRead,
		})
	}
	return _adminReadLimiter
}

/** Media enclosures (/media/*) */
export function getMediaLimiter(): RateLimiter {
	if (!_mediaLimiter) {
		_mediaLimiter = new RateLimiter({
			name: 'media',
			maxRequests: getRateLimitConfig().media,
		})
	}
	return _mediaLimiter
}

/** Default/soft limit for everything else */
export function getDefaultLimiter(): RateLimiter {
	if (!_defaultLimiter) {
		_defaultLimiter = new RateLimiter({
			name: 'default',
			maxRequests: getRateLimitConfig().default,
		})
	}
	return _defaultLimiter
}

/**
 * Reset all rate limiter singletons.
 * This is primarily useful for testing to ensure fresh instances
 * are created with the current environment configuration.
 */
export function resetRateLimiters(): void {
	if (_adminWriteLimiter) {
		_adminWriteLimiter.destroy()
		_adminWriteLimiter = null
	}
	if (_adminReadLimiter) {
		_adminReadLimiter.destroy()
		_adminReadLimiter = null
	}
	if (_mediaLimiter) {
		_mediaLimiter.destroy()
		_mediaLimiter = null
	}
	if (_defaultLimiter) {
		_defaultLimiter.destroy()
		_defaultLimiter = null
	}
}
