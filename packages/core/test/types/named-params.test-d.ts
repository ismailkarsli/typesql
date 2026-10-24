import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type Generated, type Nullable, type Query, type Fragment, type Validate, type SqlError, type DefaultTypeMap } from "../../src/index.js";
import type { NamesOf, ParamsArgs } from "../../src/engine/index.js";

interface DB {
  users: { id: Generated<"int4">; email: Col<"text">; display_name: Nullable<"text">; age: Nullable<"int4"> };
}
const sql = createSql<DB>();

test("named parameters are rewritten in first-appearance order", () => {
  expectTypeOf<NamesOf<DB, "SELECT id FROM users WHERE id = :id AND email = :email OR id = :id">>().toEqualTypeOf<["id", "email"]>();
  expectTypeOf<ParamsArgs<DB, DefaultTypeMap, "SELECT id FROM users WHERE id = :id AND email = :email">>().toEqualTypeOf<[params: { id: number | null; email: string | null }]>();
  expectTypeOf<ParamsArgs<DB, DefaultTypeMap, "SELECT id FROM users WHERE id = $1">>().toEqualTypeOf<[number | null]>();
  const q = sql("SELECT id FROM users WHERE id = :id AND email = :email", { id: 1, email: "x" });
  expectTypeOf(q).toEqualTypeOf<Query<{ id: number }, [number | null, string | null], "SELECT id FROM users WHERE id = $1 AND email = $2">>();
  // @ts-expect-error wrong type for a named parameter
  sql("SELECT id FROM users WHERE id = :id", { id: "1" });
  // @ts-expect-error missing named parameter
  sql("SELECT id FROM users WHERE id = :id AND email = :email", { id: 1 });
});

test("casts, := and colons in literals are not parameters", () => {
  expectTypeOf<NamesOf<DB, "SELECT id::text, 'a:b', age FROM users WHERE id = $1">>().toEqualTypeOf<[]>();
  const q = sql("SELECT id::text AS t, 'a:b' AS s FROM users WHERE id = :id", { id: 3 });
  expectTypeOf(q).toEqualTypeOf<Query<{ t: string; s: string }, [number | null], "SELECT id::text AS t, 'a:b' AS s FROM users WHERE id = $1">>();
});

test("mixing styles is an error", () => {
  expectTypeOf<Validate<DB, "SELECT id FROM users WHERE id = :id AND email = $1">>().toEqualTypeOf<SqlError<"cannot mix named (:name) and positional ($n) parameters", 0>>();
});

test("named parameters work with fragments", () => {
  const where = sql.fragment("WHERE age > :min", { min: 18 });
  expectTypeOf(where).toEqualTypeOf<Fragment<"WHERE age > $1", [unknown], ["n"]>>();
  const q = sql("SELECT id FROM users u {where}", { where });
  expectTypeOf(q).toEqualTypeOf<Query<{ id: number }, [number | null], "SELECT id FROM users u WHERE age > $1">>();
  // outer named params come first, fragment params are renumbered after them
  const more = sql.fragment("AND age > :min", { min: 18 });
  const q2 = sql("SELECT id FROM users u WHERE email = :email {more}", { more }, { email: "e" });
  expectTypeOf(q2).toEqualTypeOf<Query<{ id: number }, [string | null, number | null], "SELECT id FROM users u WHERE email = $1 AND age > $2">>();
});
