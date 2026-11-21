import { Worker } from "bullmq";
import {
    CLICK_QUEUE_NAME,
    queueRedisConnection,
    ClickEventJob,
} from "../queue/clickQueue.js";
import { db } from "../db/index.js";
import { clickEvents } from "../db/schema/clicks.js";

console.log("👷 Starting Analytics Worker...");

export const analyticsWorker = new Worker<ClickEventJob>(
    CLICK_QUEUE_NAME,
    async (job) => {
        const { eventId, linkId, clickedAt } = job.data;

        console.log(`📥 [Job ${job.id}] Processing click for link: ${linkId}`);

        // Insert into PostgreSQL idempotently (ignore duplicates on retry)
        await db
            .insert(clickEvents)
            .values({
                eventId,
                linkId,
                clickedAt: new Date(clickedAt),
            })
            .onConflictDoNothing({ target: clickEvents.eventId });

        console.log(`✅ [Job ${job.id}] Click event persisted to database: ${eventId}`);
    },
    {
        connection: queueRedisConnection,
        // Process up to 5 click jobs in parallel
        concurrency: 5,
    }
);

analyticsWorker.on("ready", () => {
    console.log("🚀 Analytics Worker is ready and listening for click jobs!");
});

analyticsWorker.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
});