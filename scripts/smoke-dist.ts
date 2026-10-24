// Imports the *built* packages (dist/) with plain Node and exercises the runtime API.
// Tests run against TypeScript sources, which hides problems that only exist in emitted
// JavaScript (e.g. a value re-export of a `declare const`). Run after `pnpm build`.
import assert from "node:assert/strict";
import type { Col, Json } from "../packages/core/src/index.ts";

// dist/ only exists after a build and typechecking runs before one, so the imports are typed
// from the sources: core's exactly, the adapters loosely (their sources import `@typesql/core`,
// which resolves to core's dist/).
type Core = typeof import("../packages/core/src/index.ts");
type CoreAdapter = typeof import("../packages/core/src/adapter.ts");
interface AdapterSql {
  (text: string): unknown;
  param(value: unknown): string;
  transaction<T>(fn: (tx: (text: string) => { execute(): Promise<T> }) => Promise<T>): Promise<T>;
}
interface Adapter {
  readonly [name: string]: unknown;
  createSql(client?: unknown): AdapterSql;
}
interface Introspect {
  readonly [name: string]: unknown;
  generateSource(db: unknown): string;
}
const dist = (path: string): Promise<unknown> => import(new URL(`../packages/${path}`, import.meta.url).href);

const core = (await dist("core/dist/index.js")) as Core;
const coreAdapter = (await dist("core/dist/adapter.js")) as CoreAdapter;
const pg = (await dist("pg/dist/index.js")) as Adapter;
const pgjs = (await dist("postgres/dist/index.js")) as Adapter;

interface DB {
  users: { id: Col<"int4">; email: Col<"text">; age: Col<"int4">; display_name: Col<"text"> };
  docs: { items: Json<number[]> };
}
const sql = core.createSql<DB>();
assert.deepEqual(sql("SELECT id FROM users WHERE id = $1", 7), { text: "SELECT id FROM users WHERE id = $1", values: [7] });

const where = sql.fragment("AND age > :min", { min: 18 });
assert.deepEqual(sql("SELECT id FROM users WHERE email = :email {where}", { where }, { email: "a@b.c" }), {
  text: "SELECT id FROM users WHERE email = $1 AND age > $2",
  values: ["a@b.c", 18],
});
assert.deepEqual(sql("SELECT {col} FROM users", { col: sql.id("display_name") }), { text: 'SELECT "display_name" FROM users', values: [] });

const evil = "x'; DROP TABLE users; --";
assert.deepEqual(sql(`SELECT id FROM users WHERE email = ${sql.param(evil)} AND id > ${sql.param(3)}`), {
  text: "SELECT id FROM users WHERE email = $1 AND id > $2",
  values: [evil, 3],
});

const doc = sql(`UPDATE docs SET items = ${sql.json([1, 2])}`);
assert.equal(doc.text, "UPDATE docs SET items = $1");
assert.ok(doc.values[0] instanceof coreAdapter.JsonParam);
assert.equal(doc.values[0].toPostgres(), "[1,2]");
assert.equal(JSON.stringify(doc.values[0]), "[1,2]");

const m = core.migrations().add("CREATE TABLE t (id int)").add("ALTER TABLE t ADD COLUMN x text");
assert.deepEqual([...m.statements], ["CREATE TABLE t (id int)", "ALTER TABLE t ADD COLUMN x text"]);

for (const name of ["createTransactionalSql", "runTransaction", "mapRows", "rowKeysOf", "camelCase"] as const) {
  assert.equal(typeof coreAdapter[name], "function", `@typesql/core/adapter export ${name}`);
}

for (const adapter of [pg, pgjs]) {
  assert.deepEqual(adapter.createSql()(`SELECT ${adapter.createSql().param(1)}`), { text: "SELECT $1", values: [1] });
  for (const name of ["createSql", "executor", "migrate"]) {
    assert.equal(typeof adapter[name], "function", `adapter export ${name}`);
  }
  assert.deepEqual(adapter.createSql()("SELECT 1"), { text: "SELECT 1", values: [] });
  assert.equal(typeof adapter.createSql().transaction, "function");
}

// a pg PoolClient-like fake: BEGIN, the query, COMMIT on it
const log: string[] = [];
const client = { query: async (text: string) => (log.push(text), { rows: [{ n: 1 }], rowCount: 1 }), release() {} };
assert.deepEqual(await pg.createSql(client).transaction((tx) => tx("SELECT 1 AS n").execute()), [{ n: 1 }]);
assert.deepEqual(log, ["BEGIN", "SELECT 1 AS n", "COMMIT"]);

const introspect = (await dist("pg/dist/introspect/index.js")) as Introspect;
for (const name of ["introspect", "generateSource"]) {
  assert.equal(typeof introspect[name], "function", `@typesql/pg/introspect export ${name}`);
}
const generated = introspect.generateSource({
  version: "17.0",
  schemas: ["public"],
  relations: [{ schema: "public", name: "t", kind: "table", comment: null, columns: [{ name: "id", type: "int4", declaredType: "integer", domain: null, nullable: false, hasDefault: true, identity: null, generated: null, default: null, comment: null }] }],
  enums: [],
});
assert.match(generated, /id: Generated<"int4">;/);

const prismaGenerator = (await dist("prisma/dist/generator/api.js")) as { readonly [name: string]: unknown };
assert.deepEqual(Object.keys(prismaGenerator), ["generateSource"], "@typesql/prisma/generator exports");

const { execFileSync } = await import("node:child_process");
const help = execFileSync(process.execPath, [new URL("../packages/pg/dist/bin.js", import.meta.url).pathname, "--help"], { encoding: "utf8" });
assert.match(help, /^Usage: typesql introspect/);

console.log("dist smoke test: ok");
