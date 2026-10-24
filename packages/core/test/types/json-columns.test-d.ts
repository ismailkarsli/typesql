import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type DefaultTypeMap, type Fragment, type Generated, type Json, type ParamsOf, type ParamsType, type RowOf, type RowType, type SqlError } from "../../src/index.js";
import type { ArgsOf, JsonValue, NonArrayOrSqlJson, ParamsArgs, SetRep } from "../../src/engine/index.js";

type HistoryItem = { at: string; state: { value: number; label?: string } };
type Settings = { theme: "dark" | "light"; tags: string[]; limits: Record<string, number> };
type Event = { kind: "a"; x: number } | { kind: "b"; y: string };

interface DB {
  portfolio: {
    id: Generated<"int4">;
    name: Col<"text">;
    history: Json<HistoryItem[], { hasDefault: true }>;
    settings: Json<Settings, { nullable: true }>;
    pair: Json<[number, string], {}, "json">;
    event: Json<Event>;
  };
}
type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
type Params<Q extends string> = ParamsOf<DB, DefaultTypeMap, Q>;
const sql = createSql<DB>();

declare const items: HistoryItem[];
declare const settings: Settings | null;

test("a Json<T> column reads as T", () => {
  expectTypeOf<Row<"SELECT history, settings, pair, event FROM portfolio">>()
    .toEqualTypeOf<{ history: HistoryItem[]; settings: Settings | null; pair: [number, string]; event: Event }>();
  expectTypeOf<Row<"SELECT * FROM portfolio">>()
    .toEqualTypeOf<{ id: number; name: string; history: HistoryItem[]; settings: Settings | null; pair: [number, string]; event: Event }>();
  // a type map that reads jsonb as text keeps the text
  interface TextJsonb extends Omit<DefaultTypeMap, "jsonb"> { jsonb: string }
  expectTypeOf<RowOf<DB, TextJsonb, "SELECT history, pair FROM portfolio">>().toEqualTypeOf<{ history: string; pair: [number, string] }>();
});

test("->, ->>, #> and subscripts index into T", () => {
  expectTypeOf<Row<"SELECT history -> -1 -> 'state' AS last, history -> 0 -> 'state' ->> 'value' AS v, history #> '{0,state,label}' AS label, history[0]['at'] AS at FROM portfolio">>()
    .toEqualTypeOf<{ last: { value: number; label?: string } | null; v: string | null; label: string | null; at: string | null }>();
  expectTypeOf<Row<"SELECT settings -> 'theme' AS theme, settings -> 'tags' -> 0 AS tag, settings -> 'limits' -> 'daily' AS daily, settings -> 'nope' AS nope FROM portfolio">>()
    .toEqualTypeOf<{ theme: "dark" | "light" | null; tag: string | null; daily: number | null; nope: null }>();
  // tuples by position, unions member by member
  expectTypeOf<Row<"SELECT pair -> 0 AS a, pair -> 1 AS b, event -> 'kind' AS kind, event -> 'x' AS x FROM portfolio">>()
    .toEqualTypeOf<{ a: number | null; b: string | null; kind: "a" | "b" | null; x: number | null }>();
  // an array has no keys, an object no indexes
  expectTypeOf<Row<"SELECT history -> 'at' AS a, settings -> 0 AS b FROM portfolio">>().toEqualTypeOf<{ a: null; b: null }>();
});

test("Json<T> columns stay jsonb for operators and functions", () => {
  expectTypeOf<Row<"SELECT jsonb_array_length(history) AS n, history @> '[]' AS c, settings ? 'theme' AS has, jsonb_typeof(event) AS k FROM portfolio">>()
    .toEqualTypeOf<{ n: number; c: boolean; has: boolean | null; k: string }>();
  // functions and operators that rewrite JSON give plain jsonb
  expectTypeOf<Row<"SELECT history || '[]' AS a, jsonb_set(history, '{0}', '{}') AS b FROM portfolio">>().toEqualTypeOf<{ a: unknown; b: unknown }>();
  expectTypeOf<Row<"SELECT coalesce(settings -> 'tags', '[]') AS tags, jsonb_agg(history -> 0) AS firsts FROM portfolio">>()
    .toEqualTypeOf<{ tags: string[]; firsts: (HistoryItem | null)[] | null }>();
  expectTypeOf<Row<"SELECT to_json(p) -> 'history' AS h, value AS item FROM portfolio p, jsonb_array_elements(p.history)">>()
    .toEqualTypeOf<{ h: HistoryItem[] | null; item: HistoryItem }>();
});

test("parameters written to a Json<T> column take T", () => {
  expectTypeOf<Params<"INSERT INTO portfolio (name, history, settings, pair, event) VALUES ($1, $2, $3, $4, $5)">>()
    .toEqualTypeOf<[string, HistoryItem[], Settings | null, [number, string], Event]>();
  expectTypeOf<Params<"UPDATE portfolio SET settings = $1 WHERE history = $2">>().toEqualTypeOf<[Settings | null, HistoryItem[] | null]>();
});

test("sql.json() checks the value against T and needs a json / jsonb context", () => {
  const q = sql(`UPDATE portfolio SET history = ${sql.json(items)}, settings = ${sql.json(settings)} WHERE id = ${sql.param(1)} RETURNING history`);
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ history: HistoryItem[] }>();
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[HistoryItem[], Settings | null, number | null]>();
  sql(`SELECT ${sql.json({ a: 1 })}::jsonb AS j`);
  sql(`SELECT ${sql.json({ a: 1 })} AS j`);
  sql(`UPDATE portfolio SET event = ${sql.json({ kind: "b", y: "x" })}`);

  // @ts-expect-error a string is not a HistoryItem[]
  sql(`UPDATE portfolio SET history = ${sql.json("x")}`);
  // @ts-expect-error null for a NOT NULL column
  sql(`UPDATE portfolio SET history = ${sql.json(null)}`);
  // @ts-expect-error sql.json() for a text column
  sql(`UPDATE portfolio SET name = ${sql.json({ a: 1 })}`);
  // @ts-expect-error a raw array for a jsonb parameter (node-postgres would send a Postgres array)
  sql(`UPDATE portfolio SET history = ${sql.param(items)}`);

  type Msg<Q> = Q extends SqlError<infer M, unknown> ? M : never;
  type CallErr<Q extends string> = Msg<Parameters<typeof sql<Q>>[0]>;
  expectTypeOf<CallErr<`UPDATE portfolio SET name = \u0000PJo\u0000`>>()
    .toEqualTypeOf<"parameter $1: a sql.json() value cannot be used as text NOT NULL">();
  expectTypeOf<CallErr<`UPDATE portfolio SET history = \u0000PJs\u0000`>>()
    .toEqualTypeOf<"parameter $1: a sql.json() string value cannot be used as jsonb NOT NULL">();
  expectTypeOf<CallErr<`UPDATE portfolio SET history = \u0000P[o]\u0000`>>()
    .toEqualTypeOf<"parameter $1: an array for jsonb NOT NULL must be passed as sql.json(value) (node-postgres sends a JS array as a Postgres array)">();
});

interface WriteDB extends DB {
  docs: { id: Generated<"int4">; data: Col<"jsonb", { nullable: true }>; tags: Col<"text[]", { hasDefault: true }>; label: Col<"text", { hasDefault: true }> };
}
const wsql = createSql<WriteDB>();

test("sql.set and sql.values take sql.json() values for JSON columns; raw arrays are an error", () => {
  const set = wsql.set("portfolio", { history: wsql.json(items), settings: wsql.json(settings), event: { kind: "a", x: 1 } });
  const upd = wsql("UPDATE portfolio SET {set} WHERE id = $1 RETURNING history", { set }, 1);
  expectTypeOf<RowType<typeof upd>>().toEqualTypeOf<{ history: HistoryItem[] }>();
  wsql("UPDATE docs SET {set}", { set: wsql.set("docs", { data: wsql.json([1, 2]), tags: ["a"] }) });
  wsql("UPDATE docs SET {set}", { set: wsql.set("docs", { data: { a: 1 } }) });
  // one row with a sql.json() value, another with null
  const rows = [
    { name: "a", history: wsql.json(items), event: wsql.json({ kind: "a", x: 1 }), pair: wsql.json([1, "a"]) },
    { name: "b", event: { kind: "b", y: "x" }, settings: null, pair: wsql.json([2, "b"]) },
  ] as const;
  wsql("INSERT INTO portfolio {rows}", { rows: wsql.values("portfolio", rows) });
  const mapped = items.map((h) => ({ name: h.at, history: wsql.json([h]), event: wsql.json({ kind: "a", x: 1 }), pair: wsql.json([1, h.at]) }));
  wsql("INSERT INTO portfolio {rows} RETURNING id", { rows: wsql.values("portfolio", mapped) });

  // @ts-expect-error parameter $1: an array for jsonb NOT NULL must be passed as sql.json(value)
  wsql("UPDATE portfolio SET {set}", { set: wsql.set("portfolio", { history: items }) });
  // @ts-expect-error the same for a plain jsonb column
  wsql("UPDATE docs SET {set}", { set: wsql.set("docs", { data: [1, 2] }) });
  // @ts-expect-error and in sql.values rows
  wsql("INSERT INTO portfolio {rows}", { rows: wsql.values("portfolio", [{ name: "a", history: items, event: { kind: "a", x: 1 }, pair: wsql.json([1, "a"]) }]) });
  // @ts-expect-error a sql.json() string value cannot be used as jsonb NOT NULL (T is HistoryItem[])
  wsql("UPDATE portfolio SET {set}", { set: wsql.set("portfolio", { history: wsql.json("x") }) });
  // @ts-expect-error parameter $4: a sql.json() null | (string | number)[] value cannot be used as json NOT NULL
  wsql("INSERT INTO portfolio {rows}", { rows: wsql.values("portfolio", [rows[0], { ...rows[1], pair: wsql.json(null as [number, string] | null) }]) });
  // @ts-expect-error a sql.json() value cannot be used as text NOT NULL
  wsql("UPDATE docs SET {set}", { set: wsql.set("docs", { label: wsql.json({ a: 1 }) }) });
  // @ts-expect-error sql.json() is not an int4[]
  wsql.set("docs", { tags: wsql.json(["a"]), id: wsql.json(1) });

  type Msg<Q> = Q extends SqlError<infer M, unknown> ? M : never;
  type SetErr<P extends object> = Msg<Parameters<typeof wsql<"UPDATE portfolio SET {set}", { set: Fragment<SetRep<P>["text"], readonly unknown[], SetRep<P>["carried"]> }>>[0]>;
  expectTypeOf<SetErr<{ history: HistoryItem[] }>>()
    .toEqualTypeOf<"parameter $1: an array for jsonb NOT NULL must be passed as sql.json(value) (node-postgres sends a JS array as a Postgres array)">();
  expectTypeOf<SetErr<{ name: "\u0000PJo\u0000" }>>().toEqualTypeOf<"parameter $1: a sql.json() value cannot be used as text NOT NULL">();
  expectTypeOf<SetErr<{ history: "\u0000PJo\u0000" | "\u0000PJs\u0000" }>>().toEqualTypeOf<"parameter $1: a sql.json() string value cannot be used as jsonb NOT NULL">();
});

test("positional and named json / jsonb arguments take no raw arrays, but sql.json() values", () => {
  type Args<Q extends string> = ArgsOf<WriteDB, DefaultTypeMap, Q>;
  expectTypeOf<Args<"UPDATE portfolio SET history = $1, settings = $2, event = $3 WHERE name = $4">>()
    .toEqualTypeOf<[NonArrayOrSqlJson<HistoryItem[]>, NonArrayOrSqlJson<Settings | null>, NonArrayOrSqlJson<Event>, string | null]>();
  expectTypeOf<JsonValue>().toExtend<NonArrayOrSqlJson<HistoryItem[]>>();
  expectTypeOf<HistoryItem[]>().not.toExtend<NonArrayOrSqlJson<HistoryItem[]>>();
  expectTypeOf<Settings>().toExtend<NonArrayOrSqlJson<unknown>>();
  expectTypeOf<Date>().toExtend<NonArrayOrSqlJson<unknown>>();
  expectTypeOf<readonly string[]>().not.toExtend<NonArrayOrSqlJson<unknown>>();
  expectTypeOf<ParamsArgs<WriteDB, DefaultTypeMap, "UPDATE docs SET data = :d, tags = :t">>()
    .toEqualTypeOf<[params: { d: NonArrayOrSqlJson<unknown>; t: (string | null)[] }]>();
  // statements without a JSON parameter keep ParamsOf
  expectTypeOf<Args<"UPDATE docs SET tags = $1 WHERE id = $2">>().toEqualTypeOf<ParamsOf<WriteDB, DefaultTypeMap, "UPDATE docs SET tags = $1 WHERE id = $2">>();

  const q = wsql("UPDATE portfolio SET history = $1, settings = $2 WHERE id = $3 RETURNING history", wsql.json(items), settings, 1);
  // the query's parameter types are still the column types
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[HistoryItem[], Settings | null, number | null]>();
  wsql("UPDATE portfolio SET history = :h WHERE id = :id", { h: wsql.json(items), id: 1 });
  wsql("UPDATE docs SET data = $1", { a: 1 });
  wsql("UPDATE docs SET data = $1", "x");
  wsql("UPDATE docs SET data = $1", null);
  wsql("UPDATE docs SET data = $1", wsql.json([1, 2]));
  wsql("UPDATE portfolio SET event = $1", { kind: "a", x: 1 });
  // fragment arguments carry sql.json() values, checked in the statement
  wsql("UPDATE portfolio SET {f}", { f: wsql.fragment("history = $1", wsql.json(items)) });
  wsql("UPDATE portfolio SET {f}", { f: wsql.fragment("history = :h", { h: wsql.json(items) }) });

  // @ts-expect-error HistoryItem[] is not assignable to NonArrayOrSqlJson<HistoryItem[]>
  wsql("UPDATE portfolio SET history = $1", items);
  // @ts-expect-error the same with a named parameter
  wsql("UPDATE portfolio SET history = :h", { h: items });
  // @ts-expect-error a plain jsonb parameter takes no raw array either
  wsql("UPDATE docs SET data = $1", [1, 2]);
  // @ts-expect-error a jsonb comparison
  wsql("SELECT id FROM docs WHERE data @> $1", ["a"]);
  // @ts-expect-error Settings is an object, not a string[]
  wsql("UPDATE portfolio SET settings = $1", ["dark"]);
  // @ts-expect-error parameter $1: a sql.json() string value cannot be used as jsonb NOT NULL
  wsql("UPDATE portfolio SET {f}", { f: wsql.fragment("history = $1", wsql.json("x")) });
  // @ts-expect-error parameter $1: an array for jsonb NOT NULL must be passed as sql.json(value)
  wsql("UPDATE portfolio SET {f}", { f: wsql.fragment("history = $1", items) });
});
