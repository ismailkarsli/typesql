import { describe, expect, test } from "vitest";
import { NoResultError, type Col, type ExecutorResult, type Generated, type Nullable } from "@typesql/core";
import {
  createSql,
  executor,
  migrate,
  type PostgresJsQueryable,
  type PostgresJsRows,
  type PostgresJsTransactable,
} from "../src/index.js";

interface DB {
  users: {
    id: Generated<"int4">;
    email: Col<"text">;
    display_name: Nullable<"text">;
  };
}

const sql = createSql<DB>();
const q = sql("SELECT id, email, display_name FROM users WHERE id = $1", 7);

interface Call {
  text: string;
  params: unknown[] | undefined;
}

function rowList(rows: unknown[], count: number | null): PostgresJsRows {
  // postgres.js returns an Array with result metadata attached as properties.
  return Object.assign([...rows], { count, command: "SELECT" });
}

function fakeSql(rows: unknown[], count: number | null = rows.length) {
  const calls: Call[] = [];
  const log: string[] = [];
  const tx: PostgresJsQueryable & { savepoint(fn: (tx: PostgresJsQueryable) => Promise<unknown>): Promise<unknown> } = {
    async unsafe(text, params) {
      calls.push({ text, params });
      log.push(text);
      return rowList(rows, count);
    },
    async savepoint(fn) {
      log.push("SAVEPOINT");
      try {
        const result = await fn(tx);
        log.push("RELEASE SAVEPOINT");
        return result;
      } catch (err) {
        log.push("ROLLBACK TO SAVEPOINT");
        throw err;
      }
    },
  };
  const client: PostgresJsQueryable & PostgresJsTransactable = {
    unsafe: tx.unsafe,
    async begin(fn) {
      log.push("BEGIN");
      try {
        const result = await fn(tx);
        log.push("COMMIT");
        return result;
      } catch (err) {
        log.push("ROLLBACK");
        throw err;
      }
    },
  };
  return { client, tx, calls, log };
}

const rowA = { id: 7, email: "a@example.com", display_name: null };
const rowB = { id: 8, email: "b@example.com", display_name: "B" };

describe("createSql", () => {
  test("build { text, values }", () => {
    expect(q.text).toBe("SELECT id, email, display_name FROM users WHERE id = $1");
    expect(q.values).toEqual([7]);
    const big = createSql<DB>(undefined, { bigint: true });
    expect(big("SELECT count(*) FROM users")).toEqual({ text: "SELECT count(*) FROM users", values: [] });
    expect(sql.as<{ n: number }>("SELECT 1 AS n")).toEqual({ text: "SELECT 1 AS n", values: [] });
  });
});

describe("transaction", () => {
  test("runs the callback inside begin() with a sql bound to the transaction and returns its result", async () => {
    const f = fakeSql([rowA]);
    const result = await createSql<DB>(f.client).transaction((tx) => tx("SELECT id, email, display_name FROM users WHERE id = $1", 7).executeTakeFirstOrThrow());
    expect(result).toEqual(rowA);
    expect(f.log).toEqual(["BEGIN", q.text, "COMMIT"]);
  });

  test("propagates the callback's error after begin() rolls back", async () => {
    const f = fakeSql([]);
    const boom = new Error("boom");
    await expect(
      createSql<DB>(f.client).transaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(f.log).toEqual(["BEGIN", "ROLLBACK"]);
  });

  test("tx.transaction, and transaction on a TransactionSql, use savepoint()", async () => {
    const f = fakeSql([]);
    await createSql<DB>(f.client).transaction(async (tx) => {
      await tx.transaction(async (inner) => inner("SELECT id FROM users").execute());
    });
    expect(f.log).toEqual(["BEGIN", "SAVEPOINT", "SELECT id FROM users", "RELEASE SAVEPOINT", "COMMIT"]);
    const g = fakeSql([]);
    await createSql<DB>(g.tx, { bigint: true }).transaction(async () => {});
    expect(g.log).toEqual(["SAVEPOINT", "RELEASE SAVEPOINT"]);
  });

  test("rejects without begin or savepoint, and without a client", async () => {
    const f = fakeSql([]);
    await expect(createSql<DB>({ unsafe: f.client.unsafe }).transaction(async () => 1)).rejects.toThrow(/needs a postgres.js Sql/);
    await expect(sql.transaction(async () => 1)).rejects.toThrow(/no client/);
  });
});

describe("migrate", () => {
  const m = { statements: ["CREATE TABLE a (id int)", "CREATE TABLE b (id int)"] };

  test("runs every statement in order inside begin() without parameters", async () => {
    const f = fakeSql([]);
    await migrate(f.client, m);
    expect(f.log).toEqual(["BEGIN", "CREATE TABLE a (id int)", "CREATE TABLE b (id int)", "COMMIT"]);
    expect(f.calls.map((c) => c.params)).toEqual([undefined, undefined]);
  });

  test("rolls back and rethrows when a statement fails", async () => {
    const f = fakeSql([]);
    const failing = { ...f.client, unsafe: f.client.unsafe };
    f.tx.unsafe = async (text: string) => {
      f.log.push(text);
      if (text.includes(" b ")) throw new Error("boom");
      return [] as never;
    };
    await expect(migrate(failing, m)).rejects.toThrow("boom");
    expect(f.log).toEqual(["BEGIN", "CREATE TABLE a (id int)", "CREATE TABLE b (id int)", "ROLLBACK"]);
  });
});

describe("executor", () => {
  test("runs the queries' execute methods through unsafe with a mutable copy of the values, and strips result metadata", async () => {
    const { client, calls } = fakeSql([{ id: 7 }]);
    const bound = createSql<DB>(client);
    const bq = bound("SELECT id FROM users WHERE id = $1", 7);
    const rows = await bq.execute();
    expect(rows).toEqual([{ id: 7 }]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).not.toHaveProperty("count");
    expect(calls).toEqual([{ text: "SELECT id FROM users WHERE id = $1", params: [7] }]);
    expect(calls[0]?.params).not.toBe(bq.values);
    expect(await createSql<DB>(client, { bigint: true })("SELECT id FROM users").executeTakeFirstOrThrow()).toEqual({ id: 7 });
  });

  test("executor(sql) can be passed per call", async () => {
    const { client } = fakeSql([]);
    await expect(q.executeTakeFirstOrThrow(executor(client))).rejects.toBeInstanceOf(NoResultError);
  });

  test("resolves to { rows, rowCount }, so executeCount reports postgres.js' count", async () => {
    const result = (await executor(fakeSql([rowA], 1).client)("SELECT 1", [])) as ExecutorResult;
    expect(result).toEqual({ rows: [rowA], rowCount: 1 });
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows).not.toHaveProperty("count");
    await expect(sql("DELETE FROM users WHERE id = $1", 7).executeCount(executor(fakeSql([], 3).client))).resolves.toBe(3);
    await expect(sql.as<never>("CREATE TABLE t (x int)").executeCount(executor(fakeSql([], null).client))).resolves.toBe(0);
  });
});

describe("rowKeys: camelCase", () => {
  test("execute* and transactions return camelCase keys, without result metadata", async () => {
    const raw = { id: 7, display_name: "A", meta_data: { inner_key: 1 } };
    const { client } = fakeSql([raw]);
    const expected = { id: 7, displayName: "A", metaData: { inner_key: 1 } };
    const cq = createSql<DB>(client, { rowKeys: "camelCase" })("SELECT id, display_name FROM users WHERE id = $1", 7);
    const rows = await cq.execute();
    expect(rows).toEqual([expected]);
    expect(rows).not.toHaveProperty("count");
    expect(await createSql<DB>(client, { rowKeys: "camelCase" }).transaction((tx) => tx("SELECT display_name FROM users").execute())).toEqual([expected]);
    const big = createSql<DB>(client, { rowKeys: "camelCase", bigint: true });
    expect(await big("SELECT display_name FROM users").executeTakeFirst()).toEqual(expected);
  });
});
