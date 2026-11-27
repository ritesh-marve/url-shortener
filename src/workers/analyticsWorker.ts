import { Worker } from "bullmq";
import {
    CLICK_QUEUE_NAME,
    queueRedisConnection,
    ClickEventJob,
} from "../queue/clickQueue.js";
import { db } from "../db/index.js";
import { clickEvents } from "../db/schema/clicks.js";
import { logger } from "../observability/logger.js";


logger.info("Starting analytics worker");

export const analyticsWorker = new Worker<ClickEventJob>(
    CLICK_QUEUE_NAME,
    async (job) => {
        const { eventId, linkId, clickedAt } = job.data;

        logger.debug(
            { jobId: job.id, linkId },
            "Processing click event"
        );

        // Insert into PostgreSQL idempotently (ignore duplicates on retry)
        await db
            .insert(clickEvents)
            .values({
                eventId,
                linkId,
                clickedAt: new Date(clickedAt),
            })
            .onConflictDoNothing({ target: clickEvents.eventId });

        logger.debug(
            { jobId: job.id, eventId },
            "Click event persisted"
        );
    },
    {
        connection: queueRedisConnection,
        // Process up to 5 click jobs in parallel
        concurrency: 5,
    }
);

analyticsWorker.on("ready", () => {
    logger.info("Analytics worker is ready and listening for click jobs");
});

analyticsWorker.on("failed", (job, err) => {
    logger.error(
        {
            err,
            jobId: job?.id,
            linkId: job?.data.linkId,
        },
        "Analytics job failed"
    );
});

analyticsWorker.on("error", (err) => {
    logger.error(
        { err },
        "Analytics worker infrastructure error"
    );
});