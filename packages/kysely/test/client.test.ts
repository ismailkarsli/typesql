import { describe, expect, test } from "vitest";
import {
  CamelCasePlugin,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from "kysely";
import { camelCase } from "@typesql/core/adapter";
import { createSql, executor } from "../src/index.js";
import type { DB } from "./fixtures/kysely-codegen.js";
import { camelCases } from "../../core/test/runtime/camel-cases.js";

/** `CamelCasePlugin`'s own mapping (its `camelCase` and `mapRow` are protected). */
const plugin = new CamelCasePlugin() as unknown as { camelCase(s: string): string; mapRow(row: Record<string, unknown>): Record<string, unknown> };

/** A Kysely instance whose driver records each query and answers with `result`. */
function fakeKysely(result: QueryResult<unknown>) {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const log: string[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(cq: CompiledQuery): Promise<QueryResult<R>> {
      calls.push({ sql: cq.sql, parameters: cq.parameters });
      log.push(cq.sql);
      return result as QueryResult<R>;
    },
    async *streamQuery() {},
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() { return connection; },
    async beginTransaction() { log.push("BEGIN"); },
    async commitTransaction() { log.push("COMMIT"); },
    async rollbackTransaction() { log.push("ROLLBACK"); },
    async releaseConnection() {},
    async destroy() {},
  };
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new CamelCasePlugin()],
  });
  return { db, calls, log };
}

const sql = createSql<DB>();

describe("createSql", () => {
  test("is core's createSql at runtime", () => {
    const q = sql("SELECT id, email FROM users WHERE id = :id AND mood = :mood", { id: 7, mood: "happy" });
    expect(q.text).toBe("SELECT id, email FROM users WHERE id = $1 AND mood = $2");
    expect(q.values).toEqual([7, "happy"]);
  });
});

describe("transaction", () => {
  test("runs the callback inside db.transaction() with a sql bound to the transaction", async () => {
    const { db, log } = fakeKysely({ rows: [{ id: 2 }] });
    const rows = await createSql<DB>(db).transaction((tx) => tx("SELECT id FROM users").execute());
    expect(rows).toEqual([{ id: 2 }]);
    expect(log).toEqual(["BEGIN", "SELECT id FROM users", "COMMIT"]);
  });

  test("rolls back and rethrows when the callback throws", async () => {
    const { db, log } = fakeKysely({ rows: [] });
    const boom = new Error("boom");
    await expect(
      createSql<DB>(db).transaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(log).toEqual(["BEGIN", "ROLLBACK"]);
  });

  test("tx.transaction, and transaction on a Kysely Transaction, use savepoints", async () => {
    const { db, log } = fakeKysely({ rows: [] });
    const boom = new Error("boom");
    await createSql<DB>(db).transaction(async (tx) => {
      await tx.transaction((inner) => inner("SELECT id FROM users").execute());
      await expect(
        tx.transaction(async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
    });
    expect(log).toEqual([
      "BEGIN",
      "SAVEPOINT typesql_2",
      "SELECT id FROM users",
      "RELEASE SAVEPOINT typesql_2",
      "SAVEPOINT typesql_2",
      "ROLLBACK TO SAVEPOINT typesql_2",
      "COMMIT",
    ]);
    log.length = 0;
    await db.transaction().execute((trx) => createSql<DB>(trx).transaction(async () => {}));
    expect(log).toEqual(["BEGIN", "SAVEPOINT typesql_1", "RELEASE SAVEPOINT typesql_1", "COMMIT"]);
  });

  test("rejects without a db", async () => {
    await expect(sql.transaction(async () => 1)).rejects.toThrow(/no client/);
  });
});

describe("executor", () => {
  test("runs the queries' execute methods on the bound instance, bypassing plugins", async () => {
    const { db, calls } = fakeKysely({ rows: [{ id: 1, display_name: "Ada" }] });
    const bound = createSql<DB>(db);
    // CamelCasePlugin is installed but bypassed: keys stay as Postgres returns them
    expect(await bound("SELECT id, display_name FROM users WHERE id = $1", 1).executeTakeFirstOrThrow()).toEqual({ id: 1, display_name: "Ada" });
    expect(calls).toEqual([{ sql: "SELECT id, display_name FROM users WHERE id = $1", parameters: [1] }]);
  });

  test("createSql(trx), or executor(trx) per call, inside a Kysely transaction", async () => {
    const { db, calls } = fakeKysely({ rows: [{ id: 2 }] });
    expect(await db.transaction().execute((trx) => createSql<DB>(trx)("SELECT id FROM users").execute())).toEqual([{ id: 2 }]);
    expect(await db.transaction().execute((trx) => sql("SELECT id FROM users").execute(executor(trx)))).toEqual([{ id: 2 }]);
    expect(calls.map((c) => c.sql)).toEqual(["SELECT id FROM users", "SELECT id FROM users"]);
  });

  test("executeCount: numAffectedRows as a number, else the number of rows", async () => {
    const { db } = fakeKysely({ rows: [], numAffectedRows: 3n });
    await expect(createSql<DB>(db)("DELETE FROM posts WHERE author_id = $1", 1).executeCount()).resolves.toBe(3);
    const sel = fakeKysely({ rows: [{ id: 1 }, { id: 2 }] });
    await expect(createSql<DB>(sel.db)("SELECT id FROM users").executeCount()).resolves.toBe(2);
  });

  test("resolves to { rows, rowCount }: numAffectedRows, else the number of rows", async () => {
    const del = fakeKysely({ rows: [{ id: 1 }], numAffectedRows: 3n });
    await expect(executor(del.db)("DELETE FROM posts RETURNING id", [])).resolves.toEqual({ rows: [{ id: 1 }], rowCount: 3 });
    await expect(sql("DELETE FROM posts").executeCount(executor(del.db))).resolves.toBe(3);
    const sel = fakeKysely({ rows: [{ id: 1 }, { id: 2 }] });
    await expect(createSql<DB>(sel.db)("SELECT id FROM users").executeCount()).resolves.toBe(2);
  });
});

describe("rowKeys: camelCase", () => {
  test.each(camelCases)("%j maps as CamelCasePlugin maps it", (input, expected) => {
    expect(plugin.camelCase(input)).toBe(expected);
    expect(camelCase(input)).toBe(plugin.camelCase(input));
  });

  test("top-level keys are renamed once, as CamelCasePlugin would; JSON values are not", async () => {
    const settings = { theme_name: "dark", recent_items: [{ item_id: 1 }] };
    const raw = { id: 1, display_name: "Ada", address_line_1: "x", settings };
    const { db } = fakeKysely({ rows: [raw] });
    const camel = createSql<DB>(db, { rowKeys: "camelCase" });
    const q = camel("SELECT id, display_name FROM users WHERE id = $1", 1);
    const expected = { id: 1, displayName: "Ada", addressLine1: "x", settings };
    expect(await q.executeTakeFirstOrThrow()).toEqual(expected);
    expect(await camel.transaction((tx) => tx("SELECT id, display_name FROM users WHERE id = $1", 1).execute())).toEqual([expected]);
    expect(await db.transaction().execute((trx) => q.execute(executor(trx)))).toEqual([expected]);
    // the plugin agrees on the keys, but would also rename inside the JSON value
    const viaPlugin = plugin.mapRow(raw);
    expect(Object.keys(viaPlugin)).toEqual(Object.keys(expected));
    expect(viaPlugin["settings"]).toEqual({ themeName: "dark", recentItems: [{ itemId: 1 }] });
  });
});
