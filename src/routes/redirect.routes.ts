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
            .add("click", {
                eventId: randomUUID(),
                linkId: link.id,
                clickedAt: new Date().toISOString(),
            })
            .catch((err) => {
                // If queue fails, log error but DO NOT block the redirect!
                console.error("⚠️ Failed to enqueue click event:", err.message);
            });

        // 302 Found: Temporary redirect
        res.redirect(302, link.destinationUrl);
    } catch (err) {
        next(err);
    }
});

export default router;