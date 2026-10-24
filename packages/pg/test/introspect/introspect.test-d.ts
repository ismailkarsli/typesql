import { expectTypeOf, test } from "vitest";
import { createSql, type ParamsType, type RowType, type SqlError, type Validate } from "@typesql/core";
import type { IsErr } from "@typesql/core/engine";
import type { PgTypeMap } from "../../src/index.js";
import type { HistoryItem, Settings } from "./json-types.js";
import type { DB } from "./schema.generated.js";

/** Queries against the schema `typesql introspect` generated from fixture.ts. */
const sql = createSql<DB, PgTypeMap>();

test("exact Postgres types: dates, floats, uuid, numeric, arrays, enums, domains", () => {
  const q = sql(`
    SELECT id, serial_no, big, small, email, name, code, mood, moods, tags, scores, ages, age, balance,
           ratio, weight, born, wakes_at, created_at, updated_at, session_length, avatar, ip
    FROM users`);
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{
    id: string;
    serial_no: number;
    big: string;
    small: number;
    email: string;
    name: string;
    code: string | null;
    mood: "happy" | "ok" | "sad" | null;
    moods: ("happy" | "ok" | "sad")[];
    tags: string[] | null;
    scores: number[];
    ages: number[] | null;
    age: number | null;
    balance: string;
    ratio: number | null;
    weight: number | null;
    born: Date | null;
    wakes_at: string | null;
    created_at: Date;
    updated_at: Date | null;
    session_length: PgTypeMap["interval"] | null;
    avatar: Buffer | null;
    ip: string | null;
  }>();
});

test("date arithmetic follows the real column types", () => {
  const q = sql("SELECT born + 1 AS next_day, created_at - interval '1 day' AS before, updated_at::date AS d FROM users");
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ next_day: Date | null; before: Date; d: Date | null }>();
});

test("quoted identifiers", () => {
  const q = sql(`SELECT "password:write", "Display Name" FROM users`);
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ "password:write": boolean | null; "Display Name": string | null }>();
});

test("JSON columns get the TS types passed in columnTypes, as Json<T> columns", () => {
  const q = sql("SELECT history, settings FROM users");
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ history: HistoryItem[]; settings: Settings | null }>();
  const e = sql("SELECT payload FROM events");
  expectTypeOf<RowType<typeof e>>().toEqualTypeOf<{ payload: { kind: string } | null }>();
  // still json / jsonb to the SQL, and indexed into T
  const i = sql("SELECT jsonb_array_length(history) AS n, history -> 0 -> 'value' AS first, settings ->> 'theme' AS theme, payload -> 'kind' AS kind FROM users, events");
  expectTypeOf<RowType<typeof i>>().toEqualTypeOf<{ n: number; first: number | null; theme: string | null; kind: string | null }>();
});

test("JSON columns are written with sql.json()", () => {
  const items: HistoryItem[] = [{ at: "2024-01-01", value: 1 }];
  const q = sql(`UPDATE users SET history = ${sql.json(items)}, settings = $1 WHERE id = $2`, { theme: "dark" }, "id");
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[Settings | null, string | null, HistoryItem[]]>();
  sql("UPDATE users SET {set}", { set: sql.set("users", { history: sql.json(items) }) });
  // @ts-expect-error a raw array for a jsonb parameter
  sql("UPDATE users SET history = $1", items);
});

test("defaults, identity, serial and generated columns are optional on INSERT", () => {
  const q = sql("INSERT INTO users (email, name, scores) VALUES ($1, $2, $3) RETURNING id, big, greeting", "ann@example.com", "Ann", [1.5]);
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[string, string, (number | null)[]]>();
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ id: string; big: string; greeting: string | null }>();
  // name (a NOT NULL domain) and scores have no default
  expectTypeOf<IsErr<Validate<DB, "INSERT INTO users (email, scores) VALUES ($1, $2)">>>().toEqualTypeOf<true>();
});

test("other schemas nest; views and materialized views are read-only", () => {
  const q = sql("SELECT s.token, s.role, c.n, c.last FROM auth.sessions s JOIN auth.session_counts c USING (user_id)");
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ token: string; role: "member" | "admin"; n: string; last: Date | null }>();
  const v = sql("SELECT id, email, name, token, role, display, session_count, live FROM user_sessions");
  expectTypeOf<RowType<typeof v>>().toEqualTypeOf<{
    id: string;
    email: string;
    name: string;
    token: string | null;
    role: "member" | "admin" | null;
    display: string;
    session_count: string;
    live: boolean | null;
  }>();
  expectTypeOf<Validate<DB, "DELETE FROM user_sessions">>().toEqualTypeOf<SqlError<'cannot delete from view "user_sessions"', 2>>();
  expectTypeOf<Validate<DB, "UPDATE auth.session_counts SET n = 0">>().toEqualTypeOf<SqlError<'cannot update view "auth.session_counts"', 0>>();
});
