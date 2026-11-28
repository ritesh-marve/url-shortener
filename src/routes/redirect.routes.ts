import { Router, Request, Response, NextFunction } from "express";
import { resolvelink } from "../modules/links/link.service.js";
import { randomUUID } from "crypto";
import { clickQueue } from "../queue/clickQueue.js";
const router = Router();

router.get("/:code", async (req: Request, res: Response, next: NextFunction) => {
    const { code } = req.params;
    // TypeScript guard: ensure code is a single string
    if (typeof code !== "string") {
        res.status(400).json({
            error: {
                code: "BAD_REQUEST",
                message: "Invalid short code format",
            },
        });
        return;
    }

    try {

        const link = await resolvelink(code);

        if (!link) {
            res.status(404).json({
                error: {
                    code: "NOT_FOUND",
                    message: "Short link not found",
                },
            });
            return;
        }

        // 🚀 Non-blocking asynchronous click event push to BullMQ
        clickQueue
            .add(
                "click",
                {
                    eventId: randomUUID(),
                    linkId: link.id,
                    clickedAt: new Date().toISOString(),
                },
                {
                    attempts: 3,           // retry up to 3 times on failure
                    backoff: {
                        type: "exponential",
                        delay: 1000,       // 1s → 2s → 4s
                    },
                    removeOnComplete: { count: 100 },  // keep last 100 for debugging
                    removeOnFail: { count: 50 },  // keep last 50 for inspection
                }
            )
            .catch((err) => {
                req.log.warn(
                    { err, code },
                    "Failed to enqueue click event; redirect will continue"
                );
            });

        // 302 Found: Temporary redirect
        res.redirect(302, link.destinationUrl);
    } catch (err) {
        next(err);
    }
});

export default router;