import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve the workspace dependency to core's sources so tests do not need a build step.
    alias: {
      "@typesql/core/adapter": fileURLToPath(new URL("../core/src/adapter.ts", import.meta.url)),
      "@typesql/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    name: "drizzle",
    include: ["test/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
