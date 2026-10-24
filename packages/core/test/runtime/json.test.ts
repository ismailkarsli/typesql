import { describe, expect, it } from "vitest";
import { createSql, type Generated, type Json } from "../../src/index.js";
import { JsonParam } from "../../src/adapter.js";
import { json } from "../../src/runtime/json.js";
import { pendingParams } from "../../src/runtime/inline.js";

interface DB {
  docs: {
    id: Generated<"int4">;
    items: Json<{ n: number }[]>;
    meta: Json<{ tags: string[] }, { nullable: true }>;
  };
}
const sql = createSql<DB>();

describe("JsonParam", () => {
  it("serializes to the same JSON text for every driver hook", () => {
    const p = new JsonParam([{ n: 1 }, "x"]);
    // node-postgres calls toPostgres()
    expect(p.toPostgres()).toBe('[{"n":1},"x"]');
    // postgres.js's json serializer is JSON.stringify, which calls toJSON()
    expect(JSON.stringify(p)).toBe('[{"n":1},"x"]');
    // postgres.js's text serializer is '' + x
    expect(`${p}`).toBe('[{"n":1},"x"]');
    expect("" + new JsonParam("it's")).toBe('"it\'s"');
  });
});

describe("sql.json()", () => {
  it("binds a JsonParam as an inline parameter", () => {
    const items = [{ n: 1 }, { n: 2 }];
    const q = sql(`UPDATE docs SET items = ${sql.json(items)} WHERE id = ${sql.param(3)}`);
    expect(q.text).toBe("UPDATE docs SET items = $1 WHERE id = $2");
    expect(q.values[0]).toBeInstanceOf(JsonParam);
    expect((q.values[0] as JsonParam).value).toBe(items);
    expect(q.values[1]).toBe(3);
  });

  it("sends null and undefined as SQL NULL", () => {
    const q = sql(`UPDATE docs SET meta = ${sql.json(null)}`);
    expect(q.values).toEqual([null]);
    expect(sql(`UPDATE docs SET meta = ${json(undefined)}`).values).toEqual([null]);
  });

  it("works in fragments and leaves nothing pending", () => {
    const before = pendingParams();
    const set = sql.fragment(`SET meta = ${sql.json({ tags: ["a"] })}`);
    const q = sql("UPDATE docs {set} WHERE id = $1", { set }, 1);
    expect(q.text).toBe("UPDATE docs SET meta = $2 WHERE id = $1");
    expect(JSON.stringify(q.values[1])).toBe('{"tags":["a"]}');
    expect(pendingParams()).toBe(before);
  });
});

describe("sql.json() in sql.set and sql.values", () => {
  it("sends the value as a JsonParam and leaves nothing pending", () => {
    const before = pendingParams();
    const items = [{ n: 1 }];
    const set = sql.set("docs", { items: sql.json(items), meta: { tags: ["a"] } });
    expect(set.text).toBe('"items" = $1, "meta" = $2');
    expect(set.values[0]).toBeInstanceOf(JsonParam);
    expect((set.values[0] as JsonParam).toPostgres()).toBe('[{"n":1}]');
    expect(set.values[1]).toEqual({ tags: ["a"] });
    // sql.json(null) is SQL NULL, sql.json(undefined) too (not skipped: it is a value)
    expect(sql.set("docs", { meta: sql.json(null) }).values).toEqual([null]);

    const v = sql.values("docs", [{ items: sql.json(items) }, { items: sql.json([{ n: 2 }]), meta: sql.json(null) }]);
    expect(v.text).toBe('("items", "meta") VALUES ($1, DEFAULT), ($2, $3)');
    expect(v.values.map((x) => JSON.stringify(x))).toEqual(['[{"n":1}]', '[{"n":2}]', "null"]);
    expect(pendingParams()).toBe(before);
  });

  it("unwraps sql.param() values too, undefined included", () => {
    const set = sql.set("docs", { id: sql.param(1) as unknown as number, meta: sql.param(undefined) as unknown as null });
    expect(set).toEqual({ text: '"id" = $1', values: [1] });
    const v = sql.values("docs", [{ items: sql.json([]), id: sql.param(undefined) as unknown as number }]);
    expect(v.text).toBe('("items") VALUES ($1)');
  });

  it("refuses a sql.json() value used twice", () => {
    const j = sql.json([{ n: 1 }]);
    sql.set("docs", { items: j });
    expect(() => sql.set("docs", { items: j })).toThrow(/already used by another statement/);
  });
});

describe("sql.json() as a positional or named argument", () => {
  it("is sent as a JsonParam", () => {
    const before = pendingParams();
    const q = sql("UPDATE docs SET items = $1 WHERE id = $2", sql.json([{ n: 1 }]), 3);
    expect(q.text).toBe("UPDATE docs SET items = $1 WHERE id = $2");
    expect(q.values[0]).toBeInstanceOf(JsonParam);
    expect(q.values[1]).toBe(3);
    const n = sql("UPDATE docs SET items = :items, meta = :meta WHERE id = :id", { items: sql.json([{ n: 2 }]), meta: { tags: [] }, id: 1 });
    expect(n.values.map((v) => JSON.stringify(v))).toEqual(['[{"n":2}]', '{"tags":[]}', "1"]);
    const f = sql.fragment("items = $1", sql.json([]));
    expect(f.values[0]).toBeInstanceOf(JsonParam);
    expect(pendingParams()).toBe(before);
  });
});
