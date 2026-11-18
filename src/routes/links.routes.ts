import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createLink } from "../modules/links/link.service.js";
import { env } from "../config/env.js";

const router = Router();

const createLinkSchema = z.object({
    url: z.string().url("A valid HTTP or HTTPS URL is required"),
});

router.post("/api/v1/links", async (req: Request, res: Response, next: NextFunction) => {
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

export default router;