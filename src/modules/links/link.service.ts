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

export async function getLinkByCode(code: string) {
    return findLinkByCode(code);
}