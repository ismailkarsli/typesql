import { describe, expect, test } from "vitest";
import { emptyCache, parseCache, render, stringifyCache, type CacheFile } from "../../src/cache/format.js";
import { scanNames, touchesAllTables } from "../../src/cache/scan.js";

const HEAD = 'import type * as __T from "@typesql/core/engine";\nexport {};\n';
const sample: CacheFile = {
  ...emptyCache("v1"),
  groups: {
    g1: {
      t: "{}",
      h: '"users" | "users.id"',
      w: { select: ["__T.Missing", "__T.Missing", "__T.Missing", "__T.Missing"], users: ['{ id: __T.Col<"int4"> }', "__T.Missing", "__T.Missing", "__T.Missing"] },
      q: {},
      entries: { "SELECT id FROM users": { r: ["select", "id", "from", "users", "*"], a: '{ readonly kind: "select" }' } },
    },
  },
};

describe("cache file", () => {
  test("anything but a complete cache file of this engine renders no entries", () => {
    for (const text of ["{}", "", "{\"typesqlcache\":1,", "null", "[]", JSON.stringify({ ...sample, typesqlcache: 2 })]) {
      expect(render(parseCache(text), "id", "v1")).toContain(HEAD);
      expect(render(parseCache(text), "id", "v1")).not.toContain("declare module");
    }
    expect(render(sample, "id", "v2")).not.toContain("declare module");
  });

  test("entries render into the augmentation, grouped by file id and snapshot", () => {
    const text = render(sample, "f00d", "v1");
    expect(text).toContain('declare module "@typesql/core/engine"');
    expect(text).toContain('"SELECT id FROM users": true;');
    expect(text).toContain('"f00d#g1": D_g1;');
    expect(text).toContain('type D_g1 = { v: "v1"; t: {}; w: { "select": readonly [__T.Missing, __T.Missing, __T.Missing, __T.Missing]');
    expect(text).toContain('"SELECT id FROM users": { r: "select" | "id" | "from" | "users" | "*"; a: { readonly kind: "select" } };');
  });

  test("written JSON is stable", () => {
    const shuffled: CacheFile = { ...sample, owners: { b: ["x"], a: ["y"] } };
    expect(stringifyCache(shuffled)).toBe(stringifyCache({ ...shuffled, owners: { a: ["y"], b: ["x"] } }));
    expect(parseCache(stringifyCache(sample))).toEqual(sample);
  });
});

describe("statement names", () => {
  const names = (sql: string) => {
    const n = scanNames(sql);
    return { words: [...n.words].sort(), pairs: [...n.pairs].sort() };
  };

  test("words are folded like the lexer folds them; quoted identifiers are kept", () => {
    expect(names('SELECT U.Id, "Mixed""Case" FROM Users U')).toEqual({ words: ["Mixed\"Case", "from", "id", "select", "u", "users"], pairs: ["u.id"] });
    expect(names("SELECT ÄbC FROM t").words).toContain("Äbc");
  });

  test("strings, comments and dollar-quoted bodies have no names", () => {
    expect(names("SELECT 'users' -- posts\n, E'it\\'s tags', $$comments$$, $f$ x $f$ /* a /* nested */ b */ FROM t").words).toEqual(["from", "select", "t"]);
    expect(names("SELECT x FROM a.b.c").pairs).toEqual(["a.b", "b.c"]);
    expect(names("SELECT $1, $2 FROM t").words).toEqual(["from", "select", "t"]);
  });

  test("type statements depend on every table", () => {
    expect(touchesAllTables("DROP TYPE mood CASCADE")).toBe(true);
    expect(touchesAllTables("ALTER TYPE mood RENAME TO feeling")).toBe(true);
    expect(touchesAllTables("ALTER TABLE t ALTER COLUMN c TYPE int8")).toBe(false);
  });
});
