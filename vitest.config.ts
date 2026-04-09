import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // tests/** is the E2E framework — runs via pnpm e2e:run + vitest.e2e.config.ts
    exclude: ["node_modules", "packages/**", "apps/**", ".next/**", "tests/**"],
  },
});
