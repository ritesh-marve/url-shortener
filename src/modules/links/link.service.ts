import { getCachedUrl, setCachedUrl } from "../../cache/redis.js";
import { randomUUID } from "crypto";
import { generateCode } from "./codeGenerator.js";
import { insertLink, findLinkByCode } from "./link.repository.js";

const MAX_RETRIES = 5;

export async function createLink(destinationUrl: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const code = generateCode();
        try {
            const link = await insertLink({
                id: randomUUID(),
                code,
                destinationUrl,
            });
            return link;
        } catch (err: any) {
            // Postgres unique violation error code
            if (err.code === "23505") {
                continue; // code collision — try again with a new code
            }
            throw err; // different error — rethrow it
        }
    }
    throw new Error("Failed to generate a unique code after max retries");
}


/**
 * Cache-Aside Pattern:
 * 1. Check Redis in-memory cache first (sub-millisecond).
 * 2. If HIT: return cached URL immediately.
 * 3. If MISS: query PostgreSQL disk, populate Redis for future visitors, and return URL.
 */
export async function resolveDestination(code: string): Promise<string | null> {
    // 1. Try Redis cache
    const cachedUrl = await getCachedUrl(code);
    if (cachedUrl) {
        console.log(`⚡ [Cache HIT] Redis resolved code: ${code}`);
        return cachedUrl;
    }
    console.log(`🐢 [Cache MISS] Querying PostgreSQL for code: ${code}`);
    // 2. Cache miss: fallback to database
    const link = await findLinkByCode(code);
    if (!link) {
        return null;
    }
    // 3. Populate Redis so next visitor gets a cache hit
    await setCachedUrl(code, link.destinationUrl);
    return link.destinationUrl;
}

export async function getLinkByCode(code: string) {
    return findLinkByCode(code);
}