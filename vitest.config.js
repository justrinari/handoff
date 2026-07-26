import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",          // node by default; the DOM-map files ask for jsdom themselves
    include: ["src/**/*.test.js"],
  },
});
