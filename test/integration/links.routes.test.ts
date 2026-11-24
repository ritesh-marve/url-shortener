import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as linkService from "../../src/modules/links/link.service.js";
import { clickQueue } from "../../src/queue/clickQueue.js";

// Mock service layer, queue, and rate limiter so tests run fast without needing live DB/Redis
vi.mock("../../src/modules/links/link.service.js");

vi.mock("../../src/queue/clickQueue.js", () => ({
    clickQueue: {
        add: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock("../../src/middleware/rateLimiter.js", () => ({
    rateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

describe("HTTP API Integration Tests", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET /health", () => {
        it("should return 200 OK", async () => {
            const res = await request(app).get("/health");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ok" });
        });
    });

    describe("POST /api/v1/links", () => {
        it("should return 201 Created for a valid URL", async () => {
            const mockLink = {
                id: "uuid-123",
                code: "abc1234",
                destinationUrl: "https://example.com",
                createdAt: new Date("2026-11-25T00:00:00Z"),
            };

            vi.mocked(linkService.createLink).mockResolvedValueOnce(mockLink);

            const res = await request(app)
                .post("/api/v1/links")
                .send({ url: "https://example.com" });

            expect(res.status).toBe(201);
            expect(res.body.code).toBe("abc1234");
            expect(res.body.destinationUrl).toBe("https://example.com");
            expect(res.body.shortUrl).toContain("/abc1234");
        });

        it("should return 400 VALIDATION_ERROR for an invalid URL", async () => {
            const res = await request(app)
                .post("/api/v1/links")
                .send({ url: "not-a-valid-url" });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("VALIDATION_ERROR");
            expect(linkService.createLink).not.toHaveBeenCalled();
        });

        it("should return 400 VALIDATION_ERROR when url field is missing", async () => {
            const res = await request(app).post("/api/v1/links").send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("GET /:code", () => {
        it("should return 302 redirect and enqueue click event for known code", async () => {
            vi.mocked(linkService.resolvelink).mockResolvedValueOnce({
                id: "uuid-123",
                destinationUrl: "https://github.com",
            });

            const res = await request(app).get("/abc1234");

            expect(res.status).toBe(302);
            expect(res.headers.location).toBe("https://github.com");
            expect(clickQueue.add).toHaveBeenCalledTimes(1);
        });

        it("should return 404 NOT_FOUND for unknown code without enqueuing click", async () => {
            vi.mocked(linkService.resolvelink).mockResolvedValueOnce(null);

            const res = await request(app).get("/unknown99");

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("NOT_FOUND");
            expect(clickQueue.add).not.toHaveBeenCalled();
        });
    });

    describe("GET /api/v1/links/:code/analytics", () => {
        it("should return 200 with analytics summary", async () => {
            vi.mocked(linkService.getAnalytics).mockResolvedValueOnce({
                code: "abc1234",
                destinationUrl: "https://github.com",
                totalClicks: 42,
                createdAt: new Date("2026-11-25T00:00:00Z"),
                from: null,
                to: null,
            });

            const res = await request(app).get("/api/v1/links/abc1234/analytics");

            expect(res.status).toBe(200);
            expect(res.body.totalClicks).toBe(42);
            expect(res.body.code).toBe("abc1234");
        });

        it("should return 400 INVALID_RANGE when from date is after to date", async () => {
            const res = await request(app).get(
                "/api/v1/links/abc1234/analytics?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z"
            );

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("INVALID_RANGE");
        });

        it("should return 404 NOT_FOUND when link does not exist", async () => {
            vi.mocked(linkService.getAnalytics).mockResolvedValueOnce(null);

            const res = await request(app).get("/api/v1/links/missing/analytics");

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("NOT_FOUND");
        });
    });
});