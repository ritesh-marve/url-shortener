import { Queue } from "bullmq";
import { env } from "../config/env.js";

// Job payload type definition
export interface ClickEventJob {
    eventId: string;
    linkId: string;
    clickedAt: string; // ISO string
}

export const CLICK_QUEUE_NAME = "click-events";

// Reusable Redis connection config for BullMQ
// Note: BullMQ requires maxRetriesPerRequest to be null
export const queueRedisConnection = {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null,
};

// Queue instance to push jobs into
export const clickQueue = new Queue<ClickEventJob>(CLICK_QUEUE_NAME, {
    connection: queueRedisConnection,
});