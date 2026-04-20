import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        environment: "node",
        reporters: process.env.CI ? ["default", "junit"] : ["default"],
        outputFile: {
            junit: "test-results/unit-junit.xml",
        },
    },
});
