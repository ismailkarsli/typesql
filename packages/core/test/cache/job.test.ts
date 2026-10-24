import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parseCache } from "../../src/cache/format.js";
import { generate, Session } from "../../src/cache/job.js";
import { engineVersion } from "../../src/cache/mapper.js";
import { SCHEMA, tempProject, tsconfig, type TempProject } from "./project.js";

let p: TempProject;
const STATEMENTS = `import { migrations, type RowOf, type DefaultTypeMap } from "@typesql/core";
import { sql, type DB } from "./db.js";
export const a = sql("SELECT id, email FROM users WHERE id = $1", 1);
export const b = sql("SELECT title FROM posts WHERE author_id = :author", { author: 1 });
export const c = sql(\`SELECT u.name FROM users u WHERE u.id = \${sql.param(2)}\`);
export type R = RowOf<DB, DefaultTypeMap, "SELECT count(*) AS n FROM posts">;
export const m = migrations<DB>().add("CREATE TABLE tags (id int4 PRIMARY KEY)").add("ALTER TABLE tags ADD COLUMN label text");
`;
beforeAll(() => {
  p = tempProject({ "tsconfig.json": tsconfig(), "src/db.ts": SCHEMA, "src/statements.ts": STATEMENTS, "src/generated/queries.typesqlcache": "{}\n" });
});
afterAll(() => p.remove());

const pass = () =>
  generate({ configFile: join(p.dir, "tsconfig.json"), cacheFile: join(p.dir, "src/generated/queries.typesqlcache"), engine: engineVersion(), isCorePath: (f) => f.startsWith(join(p.corePackage, "dist")) });

test("a pass computes what changed and keeps the rest", async () => {
  const first = await pass();
  expect(first.statements).toBe(6);
  expect(first.computed).toBeGreaterThanOrEqual(9);
  expect(first.reused).toBe(0);
  expect(first.written).toBe(true);
  const file = parseCache(readFileSync(join(p.dir, "src/generated/queries.typesqlcache"), "utf8"))!;
  expect(Object.keys(file.ddl).sort()).toEqual(["ALTER TABLE tags ADD COLUMN label text", "CREATE TABLE tags (id int4 PRIMARY KEY)"]);

  // nothing changed: nothing computed, the file is not rewritten
  const second = await pass();
  expect(second.computed).toBe(0);
  expect(second.reused).toBe(first.computed);
  expect(second.written).toBe(false);

  // users changes: the statements over users are computed again, the others kept
  p.write("src/db.ts", SCHEMA.replace('email: Col<"text">', 'email: Nullable<"text">'));
  const third = await pass();
  expect(third.computed).toBeGreaterThan(0);
  expect(third.computed).toBeLessThan(first.computed);
  const after = parseCache(readFileSync(join(p.dir, "src/generated/queries.typesqlcache"), "utf8"))!;
  const entries = Object.values(after.groups).flatMap((g) => Object.entries(g.entries));
  const a = entries.find(([k]) => k === "SELECT id, email FROM users WHERE id = $1")![1];
  expect(a.c![0]!.q).toContain("email: string | null");
}, 120_000);

test("an enum change in $types computes the entries that read it again", async () => {
  const schema = `import { createSql, type Col, type Enum } from "@typesql/core";
export interface DB {
  $types: { mood: "happy" | "sad" };
  people: { id: Col<"int4">; mood: Enum<"mood"> };
}
export const sql = createSql<DB>();
`;
  const q = "SELECT mood FROM people WHERE id = $1";
  const e = tempProject({ "tsconfig.json": tsconfig(), "src/db.ts": schema, "src/q.ts": `import { sql } from "./db.js";\nexport const q = sql("${q}", 1);\n`, "src/generated/queries.typesqlcache": "{}\n" });
  try {
    const run = () => generate({ configFile: join(e.dir, "tsconfig.json"), cacheFile: join(e.dir, "src/generated/queries.typesqlcache"), engine: engineVersion(), isCorePath: (f) => f.startsWith(join(e.corePackage, "dist")) });
    const rowOf = () => {
      const file = parseCache(readFileSync(join(e.dir, "src/generated/queries.typesqlcache"), "utf8"))!;
      return Object.values(file.groups).flatMap((g) => Object.entries(g.entries)).find(([k]) => k === q)![1].c![0]!.q;
    };
    expect((await run()).computed).toBeGreaterThan(0);
    expect(rowOf()).toContain('mood: "happy" | "sad";');
    expect((await run()).computed).toBe(0);
    e.write("src/db.ts", schema.replace('"happy" | "sad"', '"happy" | "sad" | "meh"'));
    expect((await run()).computed).toBeGreaterThan(0);
    expect(rowOf()).toContain('mood: "happy" | "meh" | "sad";');
  } finally {
    e.remove();
  }
}, 120_000);

test("calls through a TransactionalSql (an adapter's client and its tx) get entries", async () => {
  const db = `import type { Col, DefaultTypeMap } from "@typesql/core";
import { createTransactionalSql, type SqlDriver } from "@typesql/core/adapter";
export interface DB { users: { id: Col<"int4">; email: Col<"text"> } }
declare const driver: SqlDriver<object>;
export const sql = createTransactionalSql<DB, DefaultTypeMap, object>({}, driver);
`;
  const calls = `import { sql } from "./db.js";
export const a = sql("SELECT email FROM users WHERE id = $1", 1);
export const b = sql.transaction(async (tx) => tx("SELECT id FROM users WHERE email = $1", "x"));
`;
  const e = tempProject({ "tsconfig.json": tsconfig(), "src/db.ts": db, "src/calls.ts": calls, "src/generated/queries.typesqlcache": "{}\n" });
  try {
    const r = await generate({ configFile: join(e.dir, "tsconfig.json"), cacheFile: join(e.dir, "src/generated/queries.typesqlcache"), engine: engineVersion(), isCorePath: (f) => f.startsWith(join(e.corePackage, "dist")) });
    expect(r.statements).toBe(2);
    const file = parseCache(readFileSync(join(e.dir, "src/generated/queries.typesqlcache"), "utf8"))!;
    const keys = Object.values(file.groups).flatMap((g) => Object.keys(g.entries)).sort();
    expect(keys).toEqual(["SELECT email FROM users WHERE id = $1", "SELECT id FROM users WHERE email = $1"]);
  } finally {
    e.remove();
  }
}, 120_000);

test("a project's own alias of a core type and SQL-looking type arguments get entries; an unknown function's analysis does not", async () => {
  const db = `${SCHEMA}import type { DefaultTypeMap, RowOf } from "@typesql/core";
export type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
`;
  const statements = `import { sql, type Row } from "./db.js";
export type A = Row<"SELECT name FROM users">;
export type B = Row<string>;
export type L = Promise<"SELECT title FROM posts">;
export const c = sql("SELECT id FROM users");
export const d = sql("SELECT nofunc(id) FROM users");
export const e = sql('SELECT 1 AS "function f does not exist"');
export type D = Row<"SELECT ${"(".repeat(100)}1${")".repeat(100)}">;
`;
  const e = tempProject({ "tsconfig.json": tsconfig(), "src/db.ts": db, "src/statements.ts": statements, "src/generated/queries.typesqlcache": "{}\n" });
  try {
    const r = await generate({ configFile: join(e.dir, "tsconfig.json"), cacheFile: join(e.dir, "src/generated/queries.typesqlcache"), engine: engineVersion(), isCorePath: (f) => f.startsWith(join(e.corePackage, "dist")) });
    expect(r.statements).toBe(6);
    expect(r.computed).toBe(7);
    const file = parseCache(readFileSync(join(e.dir, "src/generated/queries.typesqlcache"), "utf8"))!;
    const entries = Object.fromEntries(Object.values(file.groups).flatMap((g) => Object.entries(g.entries)));
    // the statement nested too deep to evaluate (TS5115) gets no entry
    expect(Object.keys(entries).sort()).toEqual(['SELECT 1 AS "function f does not exist"', "SELECT id FROM users", "SELECT name FROM users", "SELECT nofunc(id) FROM users", "SELECT title FROM posts"]);
    expect(entries['SELECT 1 AS "function f does not exist"']!.a).toContain("function f does not exist");
    expect(entries["SELECT name FROM users"]!.a).toContain("name");
    expect(entries["SELECT title FROM posts"]!.a).toContain("title");
    expect(entries["SELECT nofunc(id) FROM users"]!.a).toBeUndefined();
    expect(entries["SELECT id FROM users"]!.a).toBeDefined();
  } finally {
    e.remove();
  }
}, 120_000);

test("a dependency that cannot be written out is left out, not a failed pass", async () => {
  // a catalog function whose type is a function over a project type: no snapshot can be written
  const db = `${SCHEMA}import type { Sig } from "@typesql/core";
export interface Raw { s: string }
declare module "@typesql/core" {
  interface FunctionCatalog { my_len: Sig<["text"], "int4"> & ((raw: Raw) => void) }
}
`;
  const e = tempProject({ "tsconfig.json": tsconfig(), "src/db.ts": db, "src/q.ts": `import { sql } from "./db.js";\nexport const q = sql("SELECT my_len(email) AS n FROM users");\n`, "src/generated/queries.typesqlcache": "{}\n" });
  try {
    const r = await generate({ configFile: join(e.dir, "tsconfig.json"), cacheFile: join(e.dir, "src/generated/queries.typesqlcache"), engine: engineVersion(), isCorePath: (f) => f.startsWith(join(e.corePackage, "dist")) });
    expect(r.statements).toBe(1);
    expect(r.written).toBe(true);
    // the entry would depend on my_len, which no snapshot can describe: it gets none
    const file = parseCache(readFileSync(join(e.dir, "src/generated/queries.typesqlcache"), "utf8"))!;
    expect(Object.values(file.groups).flatMap((g) => Object.keys(g.entries))).toEqual([]);
  } finally {
    e.remove();
  }
}, 120_000);

test("one session: a file marked changed is read again", async () => {
  const e = tempProject({ "tsconfig.json": tsconfig(), "src/db.ts": SCHEMA, "src/q.ts": `import { sql } from "./db.js";\nexport const q = sql("SELECT email FROM users");\n`, "src/generated/queries.typesqlcache": "{}\n" });
  const session = new Session({ configFile: join(e.dir, "tsconfig.json"), cacheFile: join(e.dir, "src/generated/queries.typesqlcache"), engine: engineVersion(), isCorePath: (f) => f.startsWith(join(e.corePackage, "dist")) });
  try {
    expect((await session.pass()).computed).toBeGreaterThan(0);
    e.write("src/db.ts", SCHEMA.replace('email: Col<"text">', 'email: Nullable<"text">'));
    session.markChanged([join(e.dir, "src/db.ts")]);
    expect((await session.pass()).computed).toBeGreaterThan(0);
    expect((await session.pass()).computed).toBe(0);
  } finally {
    await session.dispose();
    e.remove();
  }
}, 120_000);

test("a project that does not load", async () => {
  const e = tempProject({ "src/generated/queries.typesqlcache": "{}\n" });
  try {
    await expect(generate({ configFile: join(e.dir, "tsconfig.json"), cacheFile: join(e.dir, "src/generated/queries.typesqlcache"), engine: engineVersion(), isCorePath: () => false }))
      .rejects.toThrow(new Error(`typesql: project ${join(e.dir, "tsconfig.json")} did not load`));
  } finally {
    e.remove();
  }
}, 120_000);

test("a cache file outside the project's directories", async () => {
  const e = tempProject({ "tsconfig.json": tsconfig(), "src/db.ts": SCHEMA, "other/queries.typesqlcache": "{}\n" });
  try {
    await expect(generate({ configFile: join(e.dir, "tsconfig.json"), cacheFile: join(e.dir, "other/queries.typesqlcache"), engine: engineVersion(), isCorePath: (f) => f.startsWith(join(e.corePackage, "dist")) }))
      .rejects.toThrow(new Error("typesql: other/queries.typesqlcache is not in a directory the project includes .ts files from"));
  } finally {
    e.remove();
  }
}, 120_000);
