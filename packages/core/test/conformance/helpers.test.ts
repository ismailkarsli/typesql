import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Pool } from "pg";
import postgres from "postgres";
import { createSql, type Col, type Generated, type Json, type Nullable, type RowType } from "../../src/index.js";
import { acquireDatabase } from "./db.js";

/**
 * Fragment helpers whose runtime text differs from the representative text the types check
 * (`sql.join`, `sql.set`, `sql.values`, `sql.param(undefined)`): the SQL they generate must run
 * on a real Postgres through both drivers.
 */
interface DB {
  helper_items: {
    id: Generated<"int4">;
    name: Col<"text">;
    price: Col<"int4">;
    note: Nullable<"text">;
    qty: Generated<"int4">;
  };
  helper_docs: {
    id: Generated<"int4">;
    name: Col<"text">;
    items: Json<{ at: string; n: number }[]>;
    settings: Json<{ theme: string; tags: string[] }, { nullable: true }, "json">;
    data: Nullable<"jsonb">;
  };
}
const sql = createSql<DB>();

const db = await acquireDatabase();
type Run = (q: { text: string; values: readonly unknown[] }) => Promise<Record<string, unknown>[]>;
const pool = db ? new Pool({ connectionString: db.url }) : null;
const pgjs = db ? postgres(db.url, { onnotice: () => {} }) : null;
const drivers: { name: string; run: Run }[] = db
  ? [
      { name: "pg", run: async (q) => (await pool!.query(q.text, [...q.values])).rows },
      { name: "postgres.js", run: async (q) => [...(await pgjs!.unsafe(q.text, [...q.values] as never[]))] as Record<string, unknown>[] },
    ]
  : [];

describe.skipIf(!db)("fragment helpers against Postgres", () => {
  beforeAll(async () => {
    await pool!.query("DROP TABLE IF EXISTS helper_items");
    await pool!.query("CREATE TABLE helper_items (id serial PRIMARY KEY, name text NOT NULL UNIQUE, price int NOT NULL, note text, qty int NOT NULL DEFAULT 1)");
    await pool!.query("INSERT INTO helper_items (name, price, note) VALUES ('b', 20, NULL), ('a', 20, 'x'), ('c', 10, 'y')");
    await pool!.query("DROP TABLE IF EXISTS helper_docs");
    await pool!.query("CREATE TABLE helper_docs (id serial PRIMARY KEY, name text NOT NULL, items jsonb NOT NULL, settings json, data jsonb)");
  });
  afterAll(async () => {
    await pool?.query("DROP TABLE IF EXISTS helper_items");
    await pool?.query("DROP TABLE IF EXISTS helper_docs");
    await pool?.end();
    await pgjs?.end();
    await db?.close();
  });

  describe.each(drivers)("$name", ({ name, run }) => {
    test("sql.join: ORDER BY and WHERE from runtime arrays", async () => {
      const SORT = {
        name: { asc: sql.fragment("i.name"), desc: sql.fragment("i.name DESC") },
        price: { asc: sql.fragment("i.price"), desc: sql.fragment("i.price DESC") },
        near: { asc: sql.fragment(`abs(i.price - ${sql.param(12)})`), desc: sql.fragment(`abs(i.price - ${sql.param(12)}) DESC`) },
      } as const;
      const sort: { field: keyof typeof SORT; dir: "asc" | "desc" }[] = [{ field: "price", dir: "desc" }, { field: "name", dir: "asc" }];
      const order = sql.join([...sort.map(({ field, dir }) => SORT[field][dir]), sql.fragment("i.id")]);
      const q = sql("SELECT i.name FROM helper_items i ORDER BY {order}", { order });
      expect((await run(q)) as RowType<typeof q>[]).toEqual([{ name: "a" }, { name: "b" }, { name: "c" }]);

      const near = sql.join([SORT.near.asc, SORT.name.asc]);
      const q2 = sql("SELECT i.name FROM helper_items i WHERE i.price > $1 ORDER BY {near}", { near }, 0);
      expect(q2.values).toEqual([0, 12]);
      expect(await run(q2)).toEqual([{ name: "c" }, { name: "a" }, { name: "b" }]);

      const filters = [sql.fragment("i.price >= $1", 15), sql.fragment(`i.note IS NOT NULL`), sql.fragment("i.name <> $1", "zzz")];
      const where = sql.join(filters, " AND ");
      const q3 = sql("SELECT i.name FROM helper_items i WHERE {where}", { where });
      expect(await run(q3)).toEqual([{ name: "a" }]);
    });

    test("sql.values, sql.set and sql.param(undefined)", async () => {
      const rows: { name: string; price: number; note?: string | null | undefined; qty?: number | undefined }[] = [
        { name: `${name}-1`, price: 1 },
        { name: `${name}-2`, price: 2, qty: 5, note: undefined },
        { name: `${name}-3`, note: null, price: 3 },
      ];
      const values = sql.values("helper_items", rows);
      const ins = sql("INSERT INTO helper_items {values} RETURNING name, note, qty", { values });
      expect(ins.text).toBe('INSERT INTO helper_items ("name", "price", "qty", "note") VALUES ($1, $2, DEFAULT, DEFAULT), ($3, $4, $5, DEFAULT), ($6, $7, DEFAULT, $8) RETURNING name, note, qty');
      expect((await run(ins)) as RowType<typeof ins>[]).toEqual([
        { name: `${name}-1`, note: null, qty: 1 },
        { name: `${name}-2`, note: null, qty: 5 },
        { name: `${name}-3`, note: null, qty: 1 },
      ]);

      const patch: { note?: string | null | undefined; qty?: number | undefined; price?: number | undefined } = { note: "patched", qty: undefined };
      const set = sql.set("helper_items", patch);
      const upd = sql("UPDATE helper_items i SET {set}, price = i.price + $1 WHERE i.name = $2 RETURNING note, qty, price", { set }, 10, `${name}-2`);
      expect(await run(upd)).toEqual([{ note: "patched", qty: 5, price: 12 }]);

      const upsert = sql.values("helper_items", [{ name: `${name}-1`, price: 9 }]);
      const onConflict = sql.set("helper_items", { qty: 7 });
      const up = sql("INSERT INTO helper_items {upsert} ON CONFLICT (name) DO UPDATE SET {onConflict} RETURNING qty", { upsert, onConflict });
      expect(await run(up)).toEqual([{ qty: 7 }]);

      const qty: number | undefined = rows[0]!.qty;
      const note: string | null | undefined = rows[0]!.note;
      const one = sql(`INSERT INTO helper_items (name, price, qty, note) VALUES (${sql.param(`${name}-4`)}, 4, ${sql.param(qty)}, ${sql.param(note)}) RETURNING qty, note`);
      expect(one.text).toBe("INSERT INTO helper_items (name, price, qty, note) VALUES ($1, 4, DEFAULT, DEFAULT) RETURNING qty, note");
      expect(await run(one)).toEqual([{ qty: 1, note: null }]);
      const reset = sql(`UPDATE helper_items SET qty = ${sql.param(undefined as number | undefined)} WHERE name = ${sql.param(`${name}-2`)} RETURNING qty`);
      expect(await run(reset)).toEqual([{ qty: 1 }]);
      await run(sql("DELETE FROM helper_items WHERE name LIKE $1", `${name}-%`));
    });

    test("sql.values and sql.set with JSON columns: sql.json() values and plain objects", async () => {
      const a = [{ at: "2024-01-02", n: 1 }, { at: "2024-01-03", n: 2.5 }];
      const b = [{ at: "2024-02-01", n: 3 }];
      const settings = { theme: "dark", tags: ["x", "y"] };
      const rows = [
        { name: `${name}-a`, items: sql.json(a), settings, data: sql.json([1, "two", null]) },
        { name: `${name}-b`, items: sql.json(b), data: sql.json("it's") },
      ];
      const ins = sql("INSERT INTO helper_docs {rows} RETURNING name, items, settings, data", { rows: sql.values("helper_docs", rows) });
      expect((await run(ins)) as RowType<typeof ins>[]).toEqual([
        { name: `${name}-a`, items: a, settings, data: [1, "two", null] },
        { name: `${name}-b`, items: b, settings: null, data: "it's" },
      ]);

      // stored as JSON arrays and strings, not Postgres arrays or doubly encoded strings
      const kinds = sql("SELECT jsonb_typeof(items) AS items, jsonb_typeof(data) AS data FROM helper_docs WHERE name LIKE $1 ORDER BY name", `${name}-%`);
      expect(await run(kinds)).toEqual([{ items: "array", data: "array" }, { items: "array", data: "string" }]);

      const set = sql.set("helper_docs", { items: sql.json([...a, ...b]), settings: sql.json(null), data: { k: [1] } });
      const upd = sql("UPDATE helper_docs SET {set} WHERE name = $1 RETURNING items -> -1 -> 'n' AS last, settings, data", { set }, `${name}-a`);
      expect((await run(upd)) as RowType<typeof upd>[]).toEqual([{ last: 3, settings: null, data: { k: [1] } }]);
      await run(sql("DELETE FROM helper_docs WHERE name LIKE $1", `${name}-%`));
    });
  });
});
