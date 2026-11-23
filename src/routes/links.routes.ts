import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createLink, getAnalytics } from "../modules/links/link.service.js";
import { env } from "../config/env.js";
import { rateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

const createLinkSchema = z.object({
    url: z.string().url("A valid HTTP or HTTPS URL is required"),
});

const analyticsQuerySchema = z.object({
    from: z.string().datetime({ message: "Invalid 'from' ISO timestamp" }).optional(),
    to: z.string().datetime({ message: "Invalid 'to' ISO timestamp" }).optional(),
});

// Strict: 10 link creations per minute
const createLinkLimiter = rateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    keyPrefix: "create",
});
// Moderate: 30 analytics queries per minute
const analyticsLimiter = rateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyPrefix: "analytics",
});


router.post("/api/v1/links", createLinkLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const result = createLinkSchema.safeParse(req.body);

    if (!result.success) {
        res.status(400).json({
            error: {
                code: "VALIDATION_ERROR",
                message: result.error.issues[0].message,
            },
        });
        return;
    }

    try {
        const link = await createLink(result.data.url);
        res.status(201).json({
            code: link.code,
            shortUrl: `http://localhost:${env.PORT}/${link.code}`,
            destinationUrl: link.destinationUrl,
            createdAt: link.createdAt,
        });
    } catch (err) {
        next(err); // passes to errorHandler
    }
});


router.get("/api/v1/links/:code/analytics", analyticsLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { code } = req.params;

    if (typeof code !== "string") {
        return res.status(400).json({
            error: {
                code: "BAD_REQUEST",
                message: "Invalid short code format",
            },
        });
    }

    const queryResult = analyticsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
        res.status(400).json({
            error: {
                code: "VALIDATION_ERROR",
                message: queryResult.error.issues[0].message,
            },
        });
        return;
    }

    const from = queryResult.data.from ? new Date(queryResult.data.from) : undefined;
    const to = queryResult.data.to ? new Date(queryResult.data.to) : undefined;

    if (from && to && from > to) {
        res.status(400).json({
            error: {
                code: "INVALID_RANGE",
                message: "'from' date cannot be after 'to' date",
            },
        });
        return;
    }

    try {
        const analytics = await getAnalytics(code, from, to);
        if (!analytics) {
            res.status(404).json({
                error: {
                    code: "NOT_FOUND",
                    message: "Short link not found",
                },
            });
            return;
        }

        res.status(200).json(analytics);
    } catch (err) {
        next(err);
    }
});

export default router;