import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type Generated, type Nullable, type Query, type Fragment, type SqlError, type ParamsType, type RelationName, type RowType, type TextType } from "../../src/index.js";
import type { Splice, SlotNames, QuotedIdent, JoinedText } from "../../src/engine/index.js";

interface DB {
  users: { id: Generated<"int4">; email: Col<"text">; display_name: Nullable<"text">; age: Nullable<"int4"> };
  posts: { id: Generated<"int8">; author_id: Col<"int4">; title: Col<"text"> };
}
const sql = createSql<DB>();

test("type-level splice", () => {
  expectTypeOf<Splice<"SELECT 1 {a} x {b}", { a: { text: "AAA" }; b: { text: "BBB" } }>>().toEqualTypeOf<"SELECT 1 AAA x BBB">();
  expectTypeOf<Splice<"SELECT $1 {a}", { a: { text: "WHERE x = $1 AND y = $2" } }>>().toEqualTypeOf<"SELECT $1 WHERE x = $2 AND y = $3">();
  expectTypeOf<Splice<"SELECT '{1,2}'::int[] {a}", { a: { text: "AS arr" } }>>().toEqualTypeOf<"SELECT '{1,2}'::int[] AS arr">();
  expectTypeOf<Splice<"SELECT 1 {zzz}", { a: { text: "x" } }>>().toEqualTypeOf<SqlError<"unknown fragment slot {zzz}", null>>();
  expectTypeOf<Splice<"SELECT 1 {a}", { a: { text: string } }>>().toEqualTypeOf<string>();
  expectTypeOf<SlotNames<"SELECT {a}, {b_c} FROM t WHERE x = '{1}'">>().toEqualTypeOf<"a" | "b_c">();
  expectTypeOf<QuotedIdent<["a"]>>().toEqualTypeOf<'"a"'>();
  expectTypeOf<QuotedIdent<["s", 'we"ird']>>().toEqualTypeOf<'"s"."we""ird"'>();
  expectTypeOf<JoinedText<[{ text: "a = $1" }, { text: "b = $1" }], " AND ">>().toEqualTypeOf<"a = $1 AND b = $2">();
});

test("fragments are spliced before inference", () => {
  const where = sql.fragment("WHERE u.id = $1", 7);
  expectTypeOf(where).toEqualTypeOf<Fragment<"WHERE u.id = $1", [unknown], ["n"]>>();
  const q = sql("SELECT u.id, u.email FROM users u {where}", { where });
  expectTypeOf(q).toEqualTypeOf<Query<{ id: number; email: string }, [number | null], "SELECT u.id, u.email FROM users u WHERE u.id = $1">>();

  // outer params come first; fragment params are renumbered and travel with the fragment
  const q2 = sql("SELECT u.id FROM users u WHERE u.email = $1 {more}", { more: sql.fragment("AND u.age > $1", 18) }, "a@b.c");
  expectTypeOf(q2).toEqualTypeOf<Query<{ id: number }, [string | null, number | null], "SELECT u.id FROM users u WHERE u.email = $1 AND u.age > $2">>();

  // a whole query can be spliced as a subquery
  const sub = sql("SELECT author_id FROM posts WHERE title = $1", "x");
  const q3 = sql("SELECT u.id FROM users u WHERE u.id IN ({sub})", { sub });
  expectTypeOf(q3).toEqualTypeOf<Query<{ id: number }, [string | null], "SELECT u.id FROM users u WHERE u.id IN (SELECT author_id FROM posts WHERE title = $1)">>();

  // identifiers and joins
  const col = sql.id("display_name");
  const q4 = sql("SELECT {col} FROM users", { col });
  expectTypeOf(q4).toEqualTypeOf<Query<{ display_name: string | null }, [], 'SELECT "display_name" FROM users'>>();
  const conds = sql.join([sql.fragment("age > $1", 1), sql.fragment("email = $1", "e")], " AND ");
  const q5 = sql("SELECT id FROM users WHERE {conds}", { conds });
  expectTypeOf(q5).toEqualTypeOf<Query<{ id: number }, [number | null, string | null], "SELECT id FROM users WHERE age > $1 AND email = $2">>();

  // errors inside spliced text are reported
  // @ts-expect-error unknown column inside the fragment
  sql("SELECT u.id FROM users u {where}", { where: sql.fragment("WHERE u.nope = 1") });
  // @ts-expect-error missing slot
  sql("SELECT u.id FROM users u {where}", {});
  // @ts-expect-error wrong outer param type
  sql("SELECT u.id FROM users u WHERE u.id = $1 {w}", { w: sql.fragment("AND true") }, "x");
});

test("dynamic fragments fall back to sql.as", () => {
  const raw = sql.raw("WHERE 1 = 1");
  expectTypeOf(raw).toEqualTypeOf<Fragment<string, [], []>>();
  // @ts-expect-error dynamic fragment cannot be inferred
  sql("SELECT id FROM users {raw}", { raw });
  const ok = sql.as<{ id: number }>("SELECT id FROM users {raw}", { raw });
  expectTypeOf(ok).toEqualTypeOf<Query<{ id: number }, readonly unknown[]>>();
  // joining an array of fragments whose texts are not known
  const arr: Fragment[] = [];
  const joined = sql.join(arr);
  expectTypeOf(joined).toEqualTypeOf<Fragment<string, readonly unknown[], []>>();
});

test("sql.join over an array: dynamic count, typed elements", () => {
  const same: Fragment<"u.id = 1", []>[] = [];
  expectTypeOf(sql.join(same, " OR ")).toEqualTypeOf<Fragment<"u.id = 1", readonly unknown[], []>>();
  const SORT = {
    email: { asc: sql.fragment("u.email"), desc: sql.fragment("u.email DESC") },
    age: { asc: sql.fragment("u.age NULLS LAST"), desc: sql.fragment("u.age DESC NULLS LAST") },
  } as const;
  const sort: { field: "email" | "age"; dir: "asc" | "desc" }[] = [];
  const order = sql.join([...sort.map(({ field, dir }) => SORT[field][dir]), sql.fragment("u.id")]);
  // the text type lists every distinct element once (in TypeScript's union order)
  expectTypeOf<TextType<typeof order>>().toEqualTypeOf<"u.age DESC NULLS LAST, u.age NULLS LAST, u.email, u.email DESC, u.id">();
  const q = sql("SELECT u.id FROM users u ORDER BY {order}", { order });
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ id: number }>();

  // every element is checked against the statement's scope
  const typo = sql.join(sort.map(({ field }) => (field === "email" ? sql.fragment("u.emial") : SORT.age.asc)));
  // @ts-expect-error column u.emial does not exist
  sql("SELECT u.id FROM users u ORDER BY {typo}", { typo });
  // @ts-expect-error posts has no column age
  sql("SELECT p.id FROM posts p ORDER BY {order}", { order });

  // carried values of every element are checked, and params are renumbered
  const conds = [sql.fragment("u.age > $1", 18), sql.fragment(`u.email = ${sql.param("e")}`)];
  const where = sql.join(conds, " AND ");
  const q2 = sql("SELECT u.id FROM users u WHERE u.id > $1 AND {where}", { where }, 1);
  expectTypeOf<ParamsType<typeof q2>>().toEqualTypeOf<[number | null, number | null, string | null]>();
  const wrong = sql.join([sql.fragment("u.age > $1", "x"), sql.fragment("u.email = $1", "e")], " AND ");
  // @ts-expect-error parameter $1: a string value cannot be used as int4
  sql("SELECT u.id FROM users u WHERE {wrong}", { wrong });

  // a union-typed element (sql.id over a union) contributes each member once
  const picked: ("email" | "display_name")[] = [];
  const cols = sql.join(picked.map((c) => sql.id(c)));
  expectTypeOf<TextType<typeof cols>>().toEqualTypeOf<'"display_name", "email"'>();
  const q3 = sql("SELECT {cols} FROM users", { cols });
  // in a select list every element counts as selected
  expectTypeOf<RowType<typeof q3>>().toEqualTypeOf<{ display_name: string | null; email: string }>();

  // dynamic elements keep the list dynamic
  const dyn = sql.join([sql.raw("x"), sql.fragment("u.id")]);
  expectTypeOf(dyn).toEqualTypeOf<Fragment<string, readonly unknown[], []>>();
  // @ts-expect-error dynamic SQL fragment
  sql("SELECT u.id FROM users u ORDER BY {dyn}", { dyn });
});

test("sql.id: unions of literals and generic relation names", () => {
  // a union of literal names is a union of texts; the statement is checked per member
  const col = "email" as "email" | "display_name";
  const c = sql.id(col);
  expectTypeOf(c).toEqualTypeOf<Fragment<'"display_name"' | '"email"', [], []>>();
  const q = sql("SELECT {c} FROM users", { c });
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ display_name: string | null } | { email: string }>();
  const bad = "email" as "email" | "title";
  const b = sql.id(bad);
  // @ts-expect-error column "title" does not exist (in users)
  sql("SELECT {b} FROM users", { b });
  // the same for a union statement text
  // @ts-expect-error column "nope" does not exist
  sql("SELECT id FROM users" as "SELECT id FROM users" | "SELECT nope FROM users");

  // a generic relation name widens to every relation of the schema
  function all<T extends RelationName<DB>>(table: T) {
    const t = sql.id(table);
    expectTypeOf(t).toEqualTypeOf<Fragment<'"posts"' | '"users"', [], []>>();
    return sql("SELECT * FROM {t}", { t });
  }
  expectTypeOf<RowType<ReturnType<typeof all>>>().toEqualTypeOf<
    { id: number; email: string; display_name: string | null; age: number | null } | { id: string; author_id: number; title: string }
  >();
  // other generic or non-literal names are dynamic: use sql.as
  function cols<C extends "email" | "age">(name: C) {
    return sql.id(name);
  }
  expectTypeOf<ReturnType<typeof cols>>().toEqualTypeOf<Fragment<string, [], []>>();
  const s = sql.id("x" as string);
  expectTypeOf(s).toEqualTypeOf<Fragment<string, [], []>>();
  // @ts-expect-error dynamic SQL fragment
  sql("SELECT * FROM {s}", { s });
  expectTypeOf(sql.id("a", "x" as string)).toEqualTypeOf<Fragment<string, [], []>>();
  expectTypeOf(sql.id("a", "b")).toEqualTypeOf<Fragment<'"a"."b"', [], []>>();
});

test("plain calls still work with object params", () => {
  const q = sql("SELECT id FROM users WHERE id = $1", 1);
  expectTypeOf(q).toEqualTypeOf<Query<{ id: number }, [number | null], "SELECT id FROM users WHERE id = $1">>();
});
