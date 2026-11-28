import { Request, Response, NextFunction } from "express";

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    req.log.error({ err }, "Unhandled request error")

    res.status(500).json({
        error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong",
        },
    });
}