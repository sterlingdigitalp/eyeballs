import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "apps/desktop",
  test: {
    include: ["../../packages/**/*.test.ts", "src/**/*.test.ts"],
    environment: "jsdom",
  },
});
