import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type Enum, type Fragment, type Generated, type InsertInput, type Nullable, type ParamsType, type RowType, type SqlError, type TableName, type TextType, type View } from "../../src/index.js";
import type { InlineMarker, ValueEnc } from "../../src/engine/index.js";

interface DB {
  users: { id: Generated<"int4">; email: Col<"text">; display_name: Nullable<"text">; mood: Enum<"mood", { hasDefault: true }>; score: Generated<"int4"> };
  posts: { id: Generated<"int8">; author_id: Col<"int4">; title: Col<"text"> };
  stats: View<{ n: Col<"int8"> }>;
  auth: { sessions: { id: Col<"uuid">; user_id: Col<"int4"> } };
  $types: { mood: "happy" | "sad" };
}
const sql = createSql<DB>();

test("sql.param: a parameter, or DEFAULT for undefined", () => {
  type E<Q extends string> = Parameters<typeof sql<Q>>[0];
  type F<Q extends string> = Parameters<typeof sql.fragment<Q, []>>[0];
  const score = 0 as number | undefined;
  const name = null as string | null | undefined;
  const q = sql(`INSERT INTO users (email, score, display_name) VALUES (${sql.param("a")}, ${sql.param(score)}, ${sql.param(name)}) RETURNING id`);
  // typed with a parameter in its place; the value type is checked without `undefined`
  expectTypeOf<TextType<typeof q>>().toEqualTypeOf<"INSERT INTO users (email, score, display_name) VALUES ($1, $2, $3) RETURNING id">();
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[string, number, string | null]>();
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ id: number }>();
  sql(`UPDATE users SET score = ${sql.param(score)}, display_name = ${sql.param(name)} WHERE id = $1`, 1);
  sql(`INSERT INTO users (email, score) VALUES ('a', ${sql.param(score)}) {ret}`, { ret: sql.fragment("RETURNING id") });
  // a value that cannot be undefined is just a parameter, usable anywhere
  sql(`SELECT id FROM users WHERE score = ${sql.param(5)}`);
  // `undefined` itself is DEFAULT, with nothing to check but the position
  const lit = sql(`INSERT INTO users (email, score) VALUES ('a', ${sql.param(undefined)}) RETURNING id`);
  expectTypeOf<RowType<typeof lit>>().toEqualTypeOf<{ id: number }>();
  // the marker: `Du` and the value's encoding without `undefined`; `any` and `unknown` are not checked
  expectTypeOf(sql.param(score)).toEqualTypeOf<"\u0000Dun\u0000">();
  expectTypeOf(sql.param(undefined)).toEqualTypeOf<"\u0000Du\u0000">();
  expectTypeOf(sql.param(0 as unknown)).toEqualTypeOf<"\u0000P*\u0000">();
  expectTypeOf(sql.param(0 as any)).toEqualTypeOf<"\u0000P*\u0000">();
  expectTypeOf<InlineMarker<string | null>>().toEqualTypeOf<"\u0000Ps0\u0000">();
  // a value passed as a value stands for what it wraps; a NUL-delimited text that is no marker is unchecked
  expectTypeOf<ValueEnc<typeof score | ReturnType<typeof sql.param<typeof score>>>>().toEqualTypeOf<"n" | "nu">();
  expectTypeOf<ValueEnc<"\u0000X\u0000">>().toEqualTypeOf<"*">();

  const email = "a" as string | undefined;
  // @ts-expect-error null value in column "email" … (sql.param() sends DEFAULT for undefined)
  sql(`INSERT INTO users (email) VALUES (${sql.param(email)})`);
  // @ts-expect-error the same through a slotted call
  sql(`INSERT INTO users (email) VALUES (${sql.param(email)}) {ret}`, { ret: sql.fragment("RETURNING id") });
  const where = `SELECT id FROM users WHERE score = ${sql.param(score)}` as const;
  expectTypeOf<E<typeof where>>().toEqualTypeOf<typeof where & SqlError<"DEFAULT is not allowed in this context (sql.param() sends DEFAULT for undefined)", 7>>();
  const notNull = `INSERT INTO users (email) VALUES (${sql.param(email)})` as const;
  expectTypeOf<E<typeof notNull>>().toEqualTypeOf<typeof notNull & SqlError<"null value in column \"email\" of relation \"users\" violates not-null constraint (sql.param() sends DEFAULT for undefined)", 4>>();
  // a fragment is checked where it is spliced, with $n for its values: DEFAULT cannot be checked there
  const frag = `score = ${sql.param(score)}` as const;
  expectTypeOf<F<typeof frag>>().toEqualTypeOf<typeof frag & SqlError<"a sql.param() value that can be undefined is sent as DEFAULT, which a fragment cannot check; narrow it, or pass value ?? null", null>>();
  sql.fragment(`score = ${sql.param(score ?? 0)}`);
  // @ts-expect-error parameter $1: a string value cannot be used as int4 NOT NULL
  sql(`INSERT INTO users (email, score) VALUES ('a', ${sql.param("x" as string | undefined)})`);
  // @ts-expect-error a string | null value cannot be used as int4 NOT NULL
  sql(`INSERT INTO users (email, score) VALUES ('a', ${sql.param(null as number | null | undefined)})`);
});

test("TableName and InsertInput", () => {
  expectTypeOf<TableName<DB>>().toEqualTypeOf<"users" | "posts" | "auth.sessions">();
  expectTypeOf<InsertInput<DB, { text: string; int4: number }, "posts">>().toEqualTypeOf<{ readonly author_id: number; readonly title: string; readonly id?: unknown }>();
});

test("sql.set: typed partial SET list", () => {
  const input = {} as { email?: string; display_name?: string | null };
  const set = sql.set("users", input);
  expectTypeOf(set).toEqualTypeOf<Fragment<'"display_name" = $1, "email" = $2', readonly unknown[], ["s0", "s"]>>();
  const q = sql("UPDATE users SET {set} WHERE id = $1 RETURNING id", { set }, 1);
  expectTypeOf<TextType<typeof q>>().toEqualTypeOf<'UPDATE users SET "display_name" = $2, "email" = $3 WHERE id = $1 RETURNING id'>();
  expectTypeOf<ParamsType<typeof q>>().toEqualTypeOf<[number | null, string | null, string]>();
  // with an alias and more assignments, and in ON CONFLICT DO UPDATE
  const mood = sql.set("users", { mood: "happy", score: 3 });
  sql("UPDATE users u SET {mood}, display_name = 'x' WHERE u.id = $1", { mood }, 1);
  sql("INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET {mood}", { mood }, "a");

  // @ts-expect-error unknown column
  sql.set("users", { nope: 1 });
  // @ts-expect-error email is NOT NULL
  sql.set("users", { email: null });
  // @ts-expect-error not a value of the enum
  sql.set("users", { mood: "angry" });
  // @ts-expect-error views are not writable
  sql.set("stats", { n: "1" });
  const extra = { email: "a", nope: 1 };
  // @ts-expect-error extra keys of a variable are errors too (they would be sent)
  sql.set("users", extra);
  // the columns are checked again where the fragment is spliced
  const title = sql.set("posts", { title: "t" });
  // @ts-expect-error column "title" of relation "users" does not exist
  sql("UPDATE users SET {title}", { title });
});

test("sql.values: typed VALUES rows", () => {
  const rows = [] as { email: string; display_name?: string | null; mood?: "happy" | "sad" }[];
  const values = sql.values("users", rows);
  expectTypeOf<TextType<typeof values>>().toEqualTypeOf<'("display_name", "email", "mood") VALUES ($1, $2, $3)'>();
  const q = sql("INSERT INTO users {values} RETURNING id", { values });
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ id: number }>();

  // keys are collected over every row
  const lit = sql.values("users", [{ email: "a" }, { email: "b", score: 2 }]);
  expectTypeOf<TextType<typeof lit>>().toEqualTypeOf<'("email", "score") VALUES ($1, $2)'>();
  const up = sql("INSERT INTO users {lit} ON CONFLICT (email) DO UPDATE SET score = excluded.score RETURNING id", { lit });
  expectTypeOf<ParamsType<typeof up>>().toEqualTypeOf<[string, number]>();
  const sess = sql.values("auth.sessions", [{ id: "x", user_id: 1 }]);
  sql("INSERT INTO auth.sessions {sess}", { sess });

  // @ts-expect-error email is required (NOT NULL without a default)
  sql.values("users", [{ display_name: "x" }]);
  // @ts-expect-error unknown column
  sql.values("users", [{ email: "a", nope: 1 }]);
  // @ts-expect-error wrong value type
  sql.values("users", [{ email: 1 }]);
  // @ts-expect-error column "email" of relation "posts" does not exist
  sql("INSERT INTO posts {lit}", { lit });
});

test("sql.set and sql.values take parameter input types", () => {
  // int8 rows are strings under the default map; int8 writes also take number and bigint
  const n = 7n;
  const set = sql.set("posts", { id: n });
  sql("UPDATE posts SET {set} WHERE author_id = $1", { set }, 1);
  const rows = sql.values("posts", [{ id: 1, author_id: 1, title: "t" }]);
  sql("INSERT INTO posts {rows}", { rows });
  // @ts-expect-error int8 writes do not take a boolean
  sql.set("posts", { id: true });
});
