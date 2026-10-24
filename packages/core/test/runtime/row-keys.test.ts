import { describe, expect, it } from "vitest";
import { createSql, type Col, type Executor, type Generated, type Nullable } from "../../src/index.js";
import { camelCase, mapRows } from "../../src/adapter.js";
import { camelCases } from "./camel-cases.js";

interface DB {
  users: { id: Generated<"int4">; display_name: Nullable<"text">; settings: Nullable<"jsonb">; user_id: Col<"int4"> };
}

const rowsExecutor = (rows: readonly unknown[]): Executor => async () => rows;

describe("camelCase", () => {
  it.each(camelCases)("%j → %j", (input, expected) => {
    expect(camelCase(input)).toBe(expected);
    expect(camelCase(input)).toBe(expected); // cached
  });
});

describe("rowKeys: camelCase", () => {
  const settings = { theme_name: "dark", nested_list: [{ inner_key: 1 }] };
  const raw = { id: 1, display_name: "Ada", settings };

  it("renames top-level keys in execute*, leaving values (JSON included) as they are", async () => {
    const sql = createSql<DB>(rowsExecutor([raw]), { rowKeys: "camelCase" });
    const q = sql("SELECT id, display_name, settings FROM users");
    const rows = await q.execute();
    expect(rows).toEqual([{ id: 1, displayName: "Ada", settings }]);
    expect(rows[0]!.settings).toBe(settings);
    expect(Object.keys(rows[0]!)).toEqual(["id", "displayName", "settings"]);
    expect(await q.executeTakeFirst()).toEqual({ id: 1, displayName: "Ada", settings });
    expect(await q.executeTakeFirstOrThrow()).toEqual({ id: 1, displayName: "Ada", settings });
    expect(raw).toEqual({ id: 1, display_name: "Ada", settings }); // the driver's row is not mutated
  });

  it("applies to { rows, rowCount } results, executors passed per call, and sql.as", async () => {
    const sql = createSql<DB>(undefined, { rowKeys: "camelCase" });
    const exec: Executor = async () => ({ rows: [{ display_name: "x" }], rowCount: 1 });
    expect(await sql("SELECT display_name FROM users").execute(exec)).toEqual([{ displayName: "x" }]);
    expect(await sql("SELECT display_name FROM users").executeCount(exec)).toBe(1);
    expect(await sql.as<{ displayName: string }>("SELECT display_name FROM users").execute(exec)).toEqual([{ displayName: "x" }]);
  });

  it("lets the later column win when two keys collide", async () => {
    const sql = createSql<DB>(rowsExecutor([{ user_id: 1, userId: "b" }]), { rowKeys: "camelCase" });
    expect(await sql.as<{ userId: number | string }>("SELECT 1").execute()).toEqual([{ userId: "b" }]);
  });

  it("leaves non-object rows alone", async () => {
    const sql = createSql<DB>(rowsExecutor([null, [1, 2], 3]), { rowKeys: "camelCase" });
    expect(await sql.as<unknown>("SELECT 1").execute()).toEqual([null, [1, 2], 3]);
  });

  it("queries still deep-equal { text, values }", () => {
    const sql = createSql<DB>(undefined, { rowKeys: "camelCase" });
    expect(sql("SELECT id FROM users WHERE id = $1", 7)).toStrictEqual({ text: "SELECT id FROM users WHERE id = $1", values: [7] });
  });

  it("mapRows applies a query's rowKeys to rows run elsewhere", () => {
    const camel = createSql<DB>(undefined, { rowKeys: "camelCase" });
    const plain = createSql<DB>();
    const rows = [{ display_name: "Ada" }];
    expect(mapRows(camel("SELECT display_name FROM users"), rows)).toEqual([{ displayName: "Ada" }]);
    const same = mapRows(plain("SELECT display_name FROM users"), rows);
    expect(same).toEqual(rows);
    expect(same).not.toBe(rows);
    expect(mapRows({ text: "SELECT 1", values: [] }, rows)).toEqual(rows);
  });
});

describe("rowKeys: preserve", () => {
  it("is the default", async () => {
    const raw = [{ display_name: "Ada" }];
    expect(await createSql<DB>(rowsExecutor(raw))("SELECT display_name FROM users").execute()).toEqual(raw);
    expect(await createSql<DB>(rowsExecutor(raw), { rowKeys: "preserve" })("SELECT display_name FROM users").execute()).toEqual(raw);
  });
});
