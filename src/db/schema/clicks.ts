import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { links } from "./links.js";

export const clickEvents = pgTable(
    "click_events",
    {
        eventId: uuid("event_id").primaryKey(),
        linkId: uuid("link_id")
            .references(() => links.id, { onDelete: "cascade" })
            .notNull(),
        clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull(),
    },
    (table) => [
        // Composite index for fast analytics queries (filter by link + date range)
        index("click_events_link_clicked_idx").on(table.linkId, table.clickedAt),
    ]
);