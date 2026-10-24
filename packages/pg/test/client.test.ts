import { describe, expect, test } from "vitest";
import { NoResultError, type Col, type Generated, type Nullable } from "@typesql/core";
import {
  createSql,
  executor,
  migrate,
  type PgPoolLike,
  type PgQueryable,
  type PgTransactionClient,
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
  values: unknown[] | undefined;
}

function fakeClient(rows: unknown[], rowCount: number | null = rows.length) {
  const calls: Call[] = [];
  const client: PgQueryable = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows, rowCount };
    },
  };
  return { client, calls };
}

const rowA = { id: 7, email: "a@example.com", display_name: null };
const rowB = { id: 8, email: "b@example.com", display_name: "B" };

describe("createSql", () => {
  test("builds { text, values }", () => {
    expect(q.text).toBe("SELECT id, email, display_name FROM users WHERE id = $1");
    expect(q.values).toEqual([7]);
    const raw = sql.as<{ n: number }>("SELECT 1 AS n");
    expect(raw).toEqual({ text: "SELECT 1 AS n", values: [] });
  });
});

describe("executor", () => {
  test("runs the queries' execute methods on the bound client", async () => {
    const { client, calls } = fakeClient([rowA, rowB]);
    const bound = createSql<DB>(client);
    const q2 = bound("SELECT id, email, display_name FROM users WHERE id = $1", 7);
    expect(await q2.execute()).toEqual([rowA, rowB]);
    expect(await q2.executeTakeFirst()).toEqual(rowA);
    expect(calls[0]).toEqual({ text: q2.text, values: [7] });
    expect(Array.isArray(calls[0]!.values)).toBe(true);
  });

  test("executor(client) can be passed per call", async () => {
    const { client } = fakeClient([]);
    expect(await q.executeTakeFirst(executor(client))).toBeUndefined();
    await expect(q.executeTakeFirstOrThrow(executor(client))).rejects.toBeInstanceOf(NoResultError);
  });

  test("resolves to { rows, rowCount }, so executeCount reports pg's rowCount", async () => {
    const { client } = fakeClient([rowA], 1);
    await expect(executor(client)("SELECT 1", [])).resolves.toEqual({ rows: [rowA], rowCount: 1 });
    const del = sql("DELETE FROM users WHERE id = $1", 7);
    await expect(del.executeCount(executor(fakeClient([], 4).client))).resolves.toBe(4);
    await expect(sql.as<never>("CREATE TABLE t (x int)").executeCount(executor(fakeClient([], null).client))).resolves.toBe(0);
  });
});

describe("transaction", () => {
  function fakePool(opts: { failOn?: string; rows?: unknown[] } = {}) {
    const log: string[] = [];
    const releases: (Error | boolean | undefined)[] = [];
    let connects = 0;
    const client: PgTransactionClient = {
      async query(text) {
        log.push(text);
        if (text === opts.failOn) throw new Error(`${text} failed`);
        return { rows: opts.rows ?? [], rowCount: 0 };
      },
      release(err) {
        releases.push(err);
      },
    };
    const pool: PgPoolLike & PgQueryable = {
      async connect() {
        connects++;
        return client;
      },
      async query(text) {
        log.push(`pool: ${text}`);
        return { rows: [], rowCount: 0 };
      },
    };
    return { pool, client, log, releases, connects: () => connects };
  }

  test("on a pool: checks out a client, BEGIN, callback on it, COMMIT, release()", async () => {
    const p = fakePool({ rows: [rowA] });
    const result = await createSql<DB>(p.pool).transaction((tx) => tx("SELECT id, email, display_name FROM users WHERE id = $1", 7).executeTakeFirstOrThrow());
    expect(result).toEqual(rowA);
    expect(p.log).toEqual(["BEGIN", q.text, "COMMIT"]);
    expect(p.releases).toEqual([undefined]);
    expect(p.connects()).toBe(1);
  });

  test("ROLLBACK and rethrow when the callback throws", async () => {
    const p = fakePool();
    const boom = new Error("boom");
    await expect(
      createSql<DB>(p.pool).transaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(p.log).toEqual(["BEGIN", "ROLLBACK"]);
    expect(p.releases).toEqual([undefined]);
  });

  test("ROLLBACK and rethrow when COMMIT fails", async () => {
    const p = fakePool({ failOn: "COMMIT" });
    await expect(createSql<DB>(p.pool).transaction(async () => 1)).rejects.toThrow("COMMIT failed");
    expect(p.log).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(p.releases).toEqual([undefined]);
  });

  test("releases the client with the error when ROLLBACK fails, still rethrows the original", async () => {
    const p = fakePool({ failOn: "ROLLBACK" });
    const boom = new Error("boom");
    await expect(
      createSql<DB>(p.pool).transaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(p.log).toEqual(["BEGIN", "ROLLBACK"]);
    expect(p.releases).toHaveLength(1);
    expect(p.releases[0]).toBeInstanceOf(Error);
    expect((p.releases[0] as Error).message).toBe("ROLLBACK failed");
  });

  test("releases the client when BEGIN fails and does not COMMIT or ROLLBACK", async () => {
    const p = fakePool({ failOn: "BEGIN" });
    await expect(createSql<DB>(p.pool).transaction(async () => 1)).rejects.toThrow("BEGIN failed");
    expect(p.log).toEqual(["BEGIN"]);
    expect(p.releases).toEqual([undefined]);
  });

  test("tx.transaction nests with savepoints; an inner rollback leaves the outer transaction going", async () => {
    const p = fakePool();
    const boom = new Error("boom");
    await createSql<DB>(p.pool).transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.transaction(async () => {});
      });
      await expect(
        tx.transaction(async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
    });
    expect(p.log).toEqual([
      "BEGIN",
      "SAVEPOINT typesql_1",
      "SAVEPOINT typesql_2",
      "RELEASE SAVEPOINT typesql_2",
      "RELEASE SAVEPOINT typesql_1",
      "SAVEPOINT typesql_1",
      "ROLLBACK TO SAVEPOINT typesql_1",
      "COMMIT",
    ]);
    expect(p.connects()).toBe(1);
  });

  test("on a Client or PoolClient: BEGIN and COMMIT on it, without releasing it", async () => {
    const p = fakePool();
    await createSql<DB>(p.client).transaction(async (tx) => tx("SELECT id FROM users").execute());
    expect(p.log).toEqual(["BEGIN", "SELECT id FROM users", "COMMIT"]);
    expect(p.releases).toEqual([]);
    expect(p.connects()).toBe(0);

    const log: string[] = [];
    const client = { processID: 1, connect: async () => {}, query: async (text: string) => (log.push(text), { rows: [], rowCount: 0 }) };
    await createSql<DB>(client).transaction(async () => {});
    expect(log).toEqual(["BEGIN", "COMMIT"]);
  });

  test("rejects on a queryable that is not a pool or a connection, and without a client", async () => {
    const { client, calls } = fakeClient([]);
    await expect(createSql<DB>(client).transaction(async () => 1)).rejects.toThrow(/needs a pg Pool, Client or PoolClient/);
    expect(calls).toEqual([]);
    await expect(sql.transaction(async () => 1)).rejects.toThrow(/no client/);
  });
});

describe("migrate", () => {
  function fakePool(failOn?: string) {
    const log: string[] = [];
    const releases: unknown[] = [];
    const client: PgTransactionClient = {
      async query(text) {
        log.push(text);
        if (text === failOn) throw new Error(`${text} failed`);
        return { rows: [], rowCount: 0 };
      },
      release(err) {
        releases.push(err);
      },
    };
    const pool: PgPoolLike = { connect: async () => client };
    return { pool, log, releases };
  }
  const m = { statements: ["CREATE TABLE a (id int)", "CREATE TABLE b (id int)"] };

  test("runs every statement in order inside one transaction", async () => {
    const f = fakePool();
    await migrate(f.pool, m);
    expect(f.log).toEqual(["BEGIN", "CREATE TABLE a (id int)", "CREATE TABLE b (id int)", "COMMIT"]);
    expect(f.releases).toEqual([undefined]);
  });

  test("rolls back and rethrows when a statement fails", async () => {
    const f = fakePool("CREATE TABLE b (id int)");
    await expect(migrate(f.pool, m)).rejects.toThrow("CREATE TABLE b (id int) failed");
    expect(f.log).toEqual(["BEGIN", "CREATE TABLE a (id int)", "CREATE TABLE b (id int)", "ROLLBACK"]);
  });
});

describe("rowKeys: camelCase", () => {
  test("execute* and transactions return camelCase keys", async () => {
    const raw = { id: 7, display_name: "A", meta_data: { inner_key: 1 } };
    const { client } = fakeClient([raw]);
    const camel = createSql<DB>(Object.assign(client, { release() {} }), { rowKeys: "camelCase" });
    const cq = camel("SELECT id, display_name FROM users WHERE id = $1", 7);
    const expected = { id: 7, displayName: "A", metaData: { inner_key: 1 } };
    expect(await cq.execute()).toEqual([expected]);
    expect(await cq.executeTakeFirstOrThrow()).toEqual(expected);
    expect(await camel.transaction((tx) => tx("SELECT id, display_name FROM users WHERE id = $1", 7).execute())).toEqual([expected]);
    expect(await q.execute(executor(client))).toEqual([raw]);
  });
});
