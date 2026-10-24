import { describe, expect, it } from "vitest";
import type { Col, DefaultTypeMap, Executor, Generated } from "../../src/index.js";
import { createTransactionalSql, runTransaction, type SqlDriver } from "../../src/adapter.js";

interface DB {
  users: { id: Generated<"int4">; email: Col<"text"> };
}

function recorder(failOn?: string) {
  const log: string[] = [];
  const run = async (statement: string) => {
    log.push(statement);
    if (statement === failOn) throw new Error(`${statement} failed`);
  };
  return { log, run };
}

describe("runTransaction", () => {
  it("BEGIN, fn, COMMIT, and resolves to fn's result", async () => {
    const r = recorder();
    expect(await runTransaction(r.run, async () => (r.log.push("fn"), 7))).toBe(7);
    expect(r.log).toEqual(["BEGIN", "fn", "COMMIT"]);
  });

  it("ROLLBACK and rethrow when fn or COMMIT throws", async () => {
    const r = recorder();
    const boom = new Error("boom");
    await expect(runTransaction(r.run, () => Promise.reject(boom))).rejects.toBe(boom);
    expect(r.log).toEqual(["BEGIN", "ROLLBACK"]);
    const c = recorder("COMMIT");
    await expect(runTransaction(c.run, async () => 1)).rejects.toThrow("COMMIT failed");
    expect(c.log).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
  });

  it("a failing ROLLBACK goes to onRollbackError and the original error is thrown", async () => {
    const r = recorder("ROLLBACK");
    const boom = new Error("boom");
    const rollbackErrors: unknown[] = [];
    await expect(runTransaction(r.run, () => Promise.reject(boom), { onRollbackError: (e) => rollbackErrors.push(e) })).rejects.toBe(boom);
    expect(rollbackErrors).toEqual([new Error("ROLLBACK failed")]);
    await expect(runTransaction(recorder("ROLLBACK").run, () => Promise.reject(boom))).rejects.toBe(boom);
  });

  it("a failing BEGIN is thrown without COMMIT or ROLLBACK, and fn does not run", async () => {
    const r = recorder("BEGIN");
    let ran = false;
    await expect(runTransaction(r.run, async () => (ran = true))).rejects.toThrow("BEGIN failed");
    expect(r.log).toEqual(["BEGIN"]);
    expect(ran).toBe(false);
  });

  it("with savepoint: SAVEPOINT, RELEASE SAVEPOINT, ROLLBACK TO SAVEPOINT", async () => {
    const r = recorder();
    await runTransaction(r.run, async () => {}, { savepoint: "sp_1" });
    await expect(runTransaction(r.run, () => Promise.reject(new Error("x")), { savepoint: "sp_1" })).rejects.toThrow("x");
    expect(r.log).toEqual(["SAVEPOINT sp_1", "RELEASE SAVEPOINT sp_1", "SAVEPOINT sp_1", "ROLLBACK TO SAVEPOINT sp_1"]);
  });
});

describe("createTransactionalSql", () => {
  /** A driver over named fake connections: `transaction` opens `<client>/tx<depth>`. */
  function fakeDriver() {
    const calls: { client: string; text: string }[] = [];
    const depths: number[] = [];
    const driver: SqlDriver<string> = {
      executor: (client): Executor => async (text) => (calls.push({ client, text }), { rows: [{ client }], rowCount: 1 }),
      transaction: async (client, depth, fn) => {
        depths.push(depth);
        return fn(`${client}/tx${depth}`);
      },
    };
    return { driver, calls, depths };
  }

  it("binds execute* to the client and transaction(fn) to a sql on the transaction's client, nesting with depth", async () => {
    const f = fakeDriver();
    const sql = createTransactionalSql<DB, DefaultTypeMap, string>("pool", f.driver);
    expect(await sql("SELECT id FROM users").execute()).toEqual([{ client: "pool" }]);
    const result = await sql.transaction(async (tx) => {
      await tx("SELECT id FROM users").execute();
      return tx.transaction((inner) => inner("SELECT email FROM users").executeTakeFirstOrThrow());
    });
    expect(result).toEqual({ client: "pool/tx0/tx1" });
    expect(f.calls.map((c) => c.client)).toEqual(["pool", "pool/tx0", "pool/tx0/tx1"]);
    expect(f.depths).toEqual([0, 1]);
  });

  it("keeps rowKeys in transactions", async () => {
    const driver: SqlDriver<string> = {
      executor: () => async () => [{ display_name: "a" }],
      transaction: async (client, _depth, fn) => fn(client),
    };
    const sql = createTransactionalSql<DB, DefaultTypeMap, string>("c", driver, { rowKeys: "camelCase" });
    expect(await sql.transaction((tx) => tx.as<{ displayName: string }>("SELECT 1").execute())).toEqual([{ displayName: "a" }]);
  });

  it("without a client, execute* and transaction reject", async () => {
    const f = fakeDriver();
    const sql = createTransactionalSql<DB, DefaultTypeMap, string>(undefined, f.driver);
    await expect(sql("SELECT id FROM users").execute()).rejects.toThrow(/no executor/);
    await expect(sql.transaction(async () => 1)).rejects.toThrow(/no client/);
    expect(f.depths).toEqual([]);
  });

  it("is still a plain sql: { text, values } queries and the helpers", () => {
    const sql = createTransactionalSql<DB, DefaultTypeMap, string>("c", fakeDriver().driver);
    expect(sql("SELECT id FROM users WHERE id = $1", 1)).toStrictEqual({ text: "SELECT id FROM users WHERE id = $1", values: [1] });
    expect(typeof sql.param).toBe("function");
  });
});
