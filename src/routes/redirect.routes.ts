import { Router, Request, Response, NextFunction } from "express";
import { getLinkByCode } from "../modules/links/link.service.js";

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
        const link = await getLinkByCode(code);

        if (!link) {
            res.status(404).json({
                error: {
                    code: "NOT_FOUND",
                    message: "Short link not found",
                },
            });
            return;
        }

        // 302 Found: Temporary redirect
        res.redirect(302, link.destinationUrl);
    } catch (err) {
        next(err);
    }
});

export default router;