import { describe, it, expect } from "vitest";
import { generateCode } from "../../src/modules/links/codeGenerator.js";

describe("codeGenerator", () => {
    it("should generate a code of exactly length 7", () => {
        const code = generateCode();
        expect(code).toHaveLength(7);
    });

    it("should only contain valid URL-safe base62 characters (A-Z, a-z, 0-9)", () => {
        const base62Regex = /^[A-Za-z0-9]{7}$/;
        for (let i = 0; i < 50; i++) {
            const code = generateCode();
            expect(code).toMatch(base62Regex);
        }
    });

    it("should generate unique codes across multiple iterations", () => {
        const generated = new Set<string>();
        const iterations = 1000;

        for (let i = 0; i < iterations; i++) {
            generated.add(generateCode());
        }

        // All 1,000 generated codes should be unique
        expect(generated.size).toBe(iterations);
    });
});
