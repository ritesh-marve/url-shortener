import { db } from "../../db/index.js";
import { links } from "../../db/schema/links.js";
import { clickEvents } from "../../db/schema/clicks.js";
import { eq, count, and, gte, lte } from "drizzle-orm";

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

export async function getLinkAnalytics(
    linkId: string,
    from?: Date,
    to?: Date
): Promise<number> {
    const conditions = [eq(clickEvents.linkId, linkId)];
    if (from) conditions.push(gte(clickEvents.clickedAt, from));
    if (to) conditions.push(lte(clickEvents.clickedAt, to));
    const [result] = await db
        .select({ totalClicks: count() })
        .from(clickEvents)
        .where(and(...conditions));
    return result?.totalClicks ?? 0;
}
