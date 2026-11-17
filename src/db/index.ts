import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as linksSchema from "./schema/links.js";

// Connection pool configuration
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, {
    schema: {
        ...linksSchema,
    },
});

export type DB = typeof db;