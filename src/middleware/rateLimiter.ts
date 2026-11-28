import { Request, Response, NextFunction } from "express";
import { redis } from "../cache/redis.js";
import { randomUUID } from "crypto";

interface RateLimiterOptions {
    windowMs: number; // e.g. 60000 = 60 seconds
    max: number;      // e.g. 10 requests per window
    keyPrefix?: string;
}

export function rateLimiter(options: RateLimiterOptions) {
    const { windowMs, max, keyPrefix = "rl" } = options;
    const windowSeconds = Math.ceil(windowMs / 1000);

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Identify client by IP address
        const ip = req.ip || req.socket.remoteAddress || "anonymous";
        const key = `ratelimit:${keyPrefix}:${ip}`;
        const now = Date.now();
        const clearBefore = now - windowMs;

        try {
            // MULTI/EXEC transaction — all 4 commands execute atomically, no client can interleave
            const pipeline = redis.multi();
            // 1. Remove entries older than the current sliding window
            pipeline.zremrangebyscore(key, 0, clearBefore);
            // 2. Add current request timestamp as score & member
            // Fixed (Score stays 'now', but member is guaranteed unique):
            pipeline.zadd(key, now, `${now}:${randomUUID()}`);
            // 3. Count total requests in this sliding window
            pipeline.zcard(key);
            // 4. Set TTL so inactive keys self-delete from Redis memory
            pipeline.expire(key, windowSeconds);

            const results = await pipeline.exec();
            // results[2] is the output of zcard: [err, count]
            const count = (results?.[2]?.[1] as number) || 1;

            // Set standard rate limit headers
            res.setHeader("X-RateLimit-Limit", max);
            res.setHeader("X-RateLimit-Remaining", Math.max(0, max - count));

            if (count > max) {
                req.log.warn(
                    { limiter: keyPrefix, max, windowSeconds },
                    "Rate limit exceeded"
                );
                res.setHeader("Retry-After", windowSeconds);
                res.status(429).json({
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: `Too many requests. Limit is ${max} requests per ${windowSeconds}s.`,
                    },
                });
                return;
            }

            next();
        } catch (err) {
            // 🛡️ Resilient fallback: If Redis fails, log warning and let request proceed
            req.log.warn(
                { err, limiter: keyPrefix },
                "Rate limiter unavailable; allowing request"
            );
            next();
        }
    };
}