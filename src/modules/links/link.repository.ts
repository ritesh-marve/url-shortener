import { db } from "../../db/index.js";
import { links } from "../../db/schema/links.js";
import { eq } from "drizzle-orm";

export type NewLink = {
    id: string;
    code: string;
    destinationUrl: string;
};

export async function insertLink(newLink: NewLink) {
    const [link] = await db.insert(links).values(newLink).returning();
    return link;
}

export async function findLinkByCode(code: string) {
    const [link] = await db
        .select()
        .from(links)
        .where(eq(links.code, code));
    return link ?? null;
}