import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLink, resolvelink } from "../../src/modules/links/link.service.js";
import * as linkRepo from "../../src/modules/links/link.repository.js";
import * as redisCache from "../../src/cache/redis.js";

// Replace real DB and Redis modules with Vitest mocks
vi.mock("../../src/modules/links/link.repository.js");
vi.mock("../../src/cache/redis.js");

describe("link.service", () => {
    beforeEach(() => {
        // Reset mock call counts before every test
        vi.clearAllMocks();
    });

    describe("createLink", () => {
        it("should create a link on the first attempt", async () => {
            const mockLink = {
                id: "uuid-1",
                code: "abc1234",
                destinationUrl: "https://google.com",
                createdAt: new Date(),
            };

            vi.mocked(linkRepo.insertLink).mockResolvedValueOnce(mockLink);

            const result = await createLink("https://google.com");

            expect(result).toEqual(mockLink);
            expect(linkRepo.insertLink).toHaveBeenCalledTimes(1);
        });

        it("should retry when PostgreSQL throws unique violation (23505)", async () => {
            const mockLink = {
                id: "uuid-2",
                code: "xyz9876",
                destinationUrl: "https://github.com",
                createdAt: new Date(),
            };

            // Simulate collision on 1st call, success on 2nd call
            vi.mocked(linkRepo.insertLink)
                .mockRejectedValueOnce({ code: "23505" })
                .mockResolvedValueOnce(mockLink);

            const result = await createLink("https://github.com");

            expect(result).toEqual(mockLink);
            expect(linkRepo.insertLink).toHaveBeenCalledTimes(2);
        });

        it("should throw an error if all 5 retry attempts fail with 23505", async () => {
            vi.mocked(linkRepo.insertLink).mockRejectedValue({ code: "23505" });

            await expect(createLink("https://example.com")).rejects.toThrow(
                "Failed to generate a unique code after max retries"
            );

            expect(linkRepo.insertLink).toHaveBeenCalledTimes(5);
        });

        it("should immediately rethrow non-collision database errors without retrying", async () => {
            vi.mocked(linkRepo.insertLink).mockRejectedValueOnce(
                new Error("ECONNREFUSED")
            );

            await expect(createLink("https://example.com")).rejects.toThrow(
                "ECONNREFUSED"
            );

            // Should NOT retry for connection failures
            expect(linkRepo.insertLink).toHaveBeenCalledTimes(1);
        });
    });

    describe("resolvelink (Cache-Aside)", () => {
        it("should return cached link on Cache HIT without querying Postgres", async () => {
            const cached = { id: "uuid-1", destinationUrl: "https://google.com" };
            vi.mocked(redisCache.getCachedlink).mockResolvedValueOnce(cached);

            const result = await resolvelink("abc1234");

            expect(result).toEqual(cached);
            expect(linkRepo.findLinkByCode).not.toHaveBeenCalled();
        });

        it("should query Postgres and warm Redis on Cache MISS", async () => {
            const dbLink = {
                id: "uuid-1",
                code: "abc1234",
                destinationUrl: "https://google.com",
                createdAt: new Date(),
            };

            vi.mocked(redisCache.getCachedlink).mockResolvedValueOnce(null);
            vi.mocked(linkRepo.findLinkByCode).mockResolvedValueOnce(dbLink);

            const result = await resolvelink("abc1234");

            expect(result).toEqual({
                id: "uuid-1",
                destinationUrl: "https://google.com",
            });
            expect(linkRepo.findLinkByCode).toHaveBeenCalledWith("abc1234");
            expect(redisCache.setCachedlink).toHaveBeenCalledWith("abc1234", {
                id: "uuid-1",
                destinationUrl: "https://google.com",
            });
        });
    });
});