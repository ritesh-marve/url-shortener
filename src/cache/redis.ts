import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";

// Standard TTL: 3600 seconds = 1 hour
const DEFAULT_TTL_SECONDS = 3600;
export interface CachedLink {
    id: string;
    destinationUrl: string;
}

export const redis = new Redis(env.REDIS_URL, {
    // If Redis is unreachable, don't hang requests indefinitely
    maxRetriesPerRequest: 3,

    // Control how ioredis reconnects when Redis is down
    retryStrategy(times) {
        if (times > 5) {
            logger.warn(
                { attempts: times },
                `Redis unreachable after ${times} attempts; stopping reconnect`
            );
            return null; // Returning null tells ioredis to STOP reconnecting
        }
        // Wait progressively longer: 500ms, 1000ms, 1500ms... up to 2s max
        const delay = Math.min(times * 500, 2000);
        return delay;
    },
});

// Log Redis connection events
redis.on("connect", () => {
    logger.info("Connected to Redis");
});

redis.on("error", (err) => {
    logger.warn(
        { err },
        "Redis error; cache fallback to PostgreSQL remains available"
    );
});

/**
 * Get cached destination URL by short code.
 * If Redis fails, silently return null so app falls back to PostgreSQL.
 */
export async function getCachedlink(code: string): Promise<CachedLink | null> {
    try {
        const data = await redis.get(`link:${code}`);
        if (!data) return null;
        return JSON.parse(data) as CachedLink;
    } catch (err) {
        logger.warn({ err, code }, "Redis cache lookup failed; falling back to PostgreSQL");
        return null;
    }
}

/**
 * Cache destination URL with an expiration (TTL).
 * If Redis fails, log warning without throwing.
 */
export async function setCachedlink(
    code: string,
    link: CachedLink,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
    try {
        // "EX" sets expiration in seconds so old links don't clog RAM forever
        await redis.set(`link:${code}`, JSON.stringify(link), "EX", ttlSeconds);
    } catch (err) {
        logger.warn({ err, code }, "Redis cache write failed");
    }
}