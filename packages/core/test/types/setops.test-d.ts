import { expectTypeOf, test } from "vitest";
import type { SqlError } from "../../src/index.js";
import type { Lex, ParseProgram } from "../../src/engine/index.js";
import type { Row, V } from "./_schema.js";

// UNION / INTERSECT / EXCEPT, verified against PostgreSQL 18.

type Body<Q extends string> = ParseProgram<Lex<Q>> extends { readonly body: infer B } ? B : never;

test("names from the first branch, common type and nullability per position", () => {
  expectTypeOf<Row<"SELECT id FROM users UNION SELECT author_id FROM posts">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT id AS a FROM users UNION ALL SELECT author_id AS b FROM posts">>().toEqualTypeOf<{ a: number }>();
  // int4 ∪ int8 → int8, int4 ∪ numeric → numeric
  expectTypeOf<Row<"SELECT id FROM users UNION SELECT id FROM posts">>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<Row<"SELECT 1 AS x UNION ALL SELECT 2.5">>().toEqualTypeOf<{ x: string }>();
  expectTypeOf<Row<"SELECT email AS e FROM users UNION SELECT display_name FROM users">>().toEqualTypeOf<{ e: string | null }>();
  expectTypeOf<Row<"SELECT NULL AS a UNION SELECT 1">>().toEqualTypeOf<{ a: number | null }>();
  expectTypeOf<Row<"SELECT 1 AS a UNION SELECT NULL">>().toEqualTypeOf<{ a: number | null }>();
  expectTypeOf<Row<"SELECT id, email FROM users INTERSECT SELECT author_id, title FROM posts">>().toEqualTypeOf<{ id: number; email: string }>();
  expectTypeOf<Row<"SELECT id FROM users EXCEPT ALL SELECT author_id FROM posts">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT id FROM users INTERSECT DISTINCT SELECT author_id FROM posts EXCEPT DISTINCT SELECT 1">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT * FROM users UNION SELECT * FROM users">>().toEqualTypeOf<{ id: number; email: string; display_name: string | null; created_at: Date }>();
  expectTypeOf<Row<"TABLE users UNION ALL TABLE users">>().toEqualTypeOf<{ id: number; email: string; display_name: string | null; created_at: Date }>();
  expectTypeOf<Row<"VALUES (1) UNION SELECT 2">>().toEqualTypeOf<{ column1: number }>();
});

test("untyped string literals take the other branch's type; real text does not", () => {
  expectTypeOf<Row<"SELECT 1 AS x UNION SELECT '2'">>().toEqualTypeOf<{ x: number }>();
  expectTypeOf<Row<"SELECT 'a' AS x UNION SELECT 'b'">>().toEqualTypeOf<{ x: string }>();
  expectTypeOf<Row<"SELECT now() AS x UNION SELECT '2020-01-01'">>().toEqualTypeOf<{ x: Date }>();
  expectTypeOf<V<"SELECT 1 UNION SELECT 'a'::text">>().toEqualTypeOf<SqlError<"UNION types integer and text cannot be matched", 2>>();
  expectTypeOf<V<"SELECT id FROM users UNION SELECT title FROM posts">>().toEqualTypeOf<SqlError<"UNION types integer and text cannot be matched", 4>>();
  expectTypeOf<V<"SELECT 1 INTERSECT SELECT true">>().toEqualTypeOf<SqlError<"INTERSECT types integer and boolean cannot be matched", 2>>();
  // a nested set operation resolves its literals to text first
  expectTypeOf<V<"SELECT 'a' UNION SELECT 'b' UNION SELECT 1">>().toEqualTypeOf<SqlError<"UNION types text and integer cannot be matched", 2>>();
});

test("column count mismatch", () => {
  expectTypeOf<V<"SELECT id FROM users UNION SELECT id, email FROM users">>().toEqualTypeOf<SqlError<"each UNION query must have the same number of columns", 4>>();
  expectTypeOf<V<"SELECT id, email FROM users EXCEPT SELECT id FROM users">>().toEqualTypeOf<SqlError<"each EXCEPT query must have the same number of columns", 6>>();
});

test("INTERSECT binds tighter than UNION / EXCEPT; all are left-associative", () => {
  expectTypeOf<Body<"SELECT 1 UNION SELECT 2 INTERSECT SELECT 3">>().toMatchTypeOf<{ readonly op: "union"; readonly r: { readonly op: "intersect" } }>();
  expectTypeOf<Body<"SELECT 1 INTERSECT SELECT 2 UNION SELECT 3">>().toMatchTypeOf<{ readonly op: "union"; readonly l: { readonly op: "intersect" } }>();
  expectTypeOf<Body<"SELECT 1 EXCEPT SELECT 2 UNION SELECT 3">>().toMatchTypeOf<{ readonly op: "union"; readonly l: { readonly op: "except" } }>();
  expectTypeOf<Body<"SELECT 1 UNION ALL SELECT 2">>().toMatchTypeOf<{ readonly op: "union"; readonly all: true }>();
});

test("parenthesized operands keep their own ORDER BY / LIMIT; trailing ones apply to the whole operation", () => {
  expectTypeOf<Row<"(SELECT id FROM users ORDER BY id LIMIT 1) UNION (SELECT author_id FROM posts ORDER BY author_id LIMIT 1) ORDER BY id LIMIT 5">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT id FROM users UNION ALL (SELECT id FROM posts ORDER BY id) ORDER BY 1 DESC NULLS LAST LIMIT 3 OFFSET 1">>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<Row<"SELECT id AS x FROM users UNION SELECT author_id FROM posts ORDER BY x">>().toEqualTypeOf<{ x: number }>();
  expectTypeOf<Row<"((SELECT id FROM users LIMIT 0))">>().toEqualTypeOf<{ id: number }>();
  // the ORDER BY of a parenthesized query moves inside it
  expectTypeOf<Row<"(SELECT id FROM users) ORDER BY email">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<V<"(SELECT id FROM users ORDER BY id) ORDER BY email">>().toEqualTypeOf<SqlError<"multiple ORDER BY clauses not allowed", 0>>();
  expectTypeOf<V<"SELECT id FROM users ORDER BY id LIMIT 1 UNION SELECT 1">>().toEqualTypeOf<SqlError<"syntax error at or near union", 9>>();
});

test("ORDER BY of a set operation: output names and positions only", () => {
  expectTypeOf<V<"SELECT id FROM users UNION SELECT author_id FROM posts ORDER BY email">>().toEqualTypeOf<SqlError<'column "email" does not exist', 11>>();
  expectTypeOf<V<"SELECT id FROM users UNION SELECT author_id FROM posts ORDER BY id + 1">>().toEqualTypeOf<SqlError<"invalid UNION/INTERSECT/EXCEPT ORDER BY clause", 0>>();
  expectTypeOf<V<"SELECT id FROM users UNION SELECT author_id FROM posts ORDER BY users.id">>().toEqualTypeOf<SqlError<'missing FROM-clause entry for table "users"', 3>>();
  expectTypeOf<V<"SELECT id FROM users UNION SELECT author_id FROM posts ORDER BY 2">>().toEqualTypeOf<SqlError<"ORDER BY position 2 is not in select list", 0>>();
  expectTypeOf<V<"SELECT id FROM users UNION SELECT id FROM posts FOR UPDATE">>().toEqualTypeOf<SqlError<"FOR UPDATE is not allowed with UNION/INTERSECT/EXCEPT", 9>>();
});

test("set-op type errors point at the operator", () => {
  expectTypeOf<V<"SELECT 1 UNION SELECT label FROM things">>().toEqualTypeOf<SqlError<"UNION types integer and text cannot be matched", 2>>();
});
