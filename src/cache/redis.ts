import { Redis } from "ioredis";
import { env } from "../config/env.js";

// Standard TTL: 3600 seconds = 1 hour
const DEFAULT_TTL_SECONDS = 3600;

export const redis = new Redis(env.REDIS_URL, {
    // If Redis is unreachable, don't hang requests indefinitely
    maxRetriesPerRequest: 3,
});

// Log Redis connection events
redis.on("connect", () => {
    console.log(" Connected to Redis");
});

redis.on("error", (err) => {
    console.error("⚠️ Redis error (falling back to database):", err.message);
});

/**
 * Get cached destination URL by short code.
 * If Redis fails, silently return null so app falls back to PostgreSQL.
 */
export async function getCachedUrl(code: string): Promise<string | null> {
    try {
        return await redis.get(`link:${code}`);
    } catch (err) {
        console.warn(`Redis get failed for code "${code}", falling back to DB.`);
        return null;
    }
}

/**
 * Cache destination URL with an expiration (TTL).
 * If Redis fails, log warning without throwing.
 */
export async function setCachedUrl(
    code: string,
    destinationUrl: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
    try {
        // "EX" sets expiration in seconds so old links don't clog RAM forever
        await redis.set(`link:${code}`, destinationUrl, "EX", ttlSeconds);
    } catch (err) {
        console.warn(`Redis set failed for code "${code}".`);
    }
}