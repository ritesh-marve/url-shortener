import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const links = pgTable("links", {
    id: uuid("id").primaryKey(),
    code: varchar("code", { length: 255 }).notNull().unique(),
    destinationUrl: text("destination_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});