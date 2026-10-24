import { expect, test } from "vitest";
import { coreNames } from "../../src/cache/print.js";

test("core types spelled through the engine entry or the root become __T names", () => {
  const text = `import("@typesql/core/engine").Missing | import("@typesql/core").Generated<"int4"> | import("./db").DB`;
  expect(coreNames(text)).toBe(`__T.Missing | __T.Generated<"int4"> | import("./db").DB`);
  expect(coreNames(`import("@typesql/core").Col<"text">`, ["@typesql/core/engine"])).toBe(`import("@typesql/core").Col<"text">`);
});
