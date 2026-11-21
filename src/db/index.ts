import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as linksSchema from "./schema/links.js";
import * as clicksSchema from "./schema/clicks.js";
import { env } from "../config/env.js";

// Connection pool configuration
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool, {
    schema: {
        ...linksSchema,
        ...clicksSchema,
    },
});

export type DB = typeof db;