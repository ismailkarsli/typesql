import { expectTypeOf, test } from "vitest";
import type { Col, DefaultTypeMap, Generated, Nullable, RowOf, SqlError, Validate, View } from "../../src/index.js";
import type { Lex, ParseProgram } from "../../src/engine/index.js";

// Joins, FROM-item naming and WHERE-based nullability narrowing, verified against PostgreSQL 18.

interface DB {
  users: { id: Generated<"int4">; email: Col<"text">; display_name: Nullable<"text">; created_at: Generated<"timestamptz"> };
  posts: { id: Generated<"int8">; author_id: Col<"int4">; title: Col<"text">; body: Nullable<"text">; tags: Col<"text[]">; meta: Nullable<"jsonb"> };
  a: { x: Col<"int4">; y: Col<"int4">; z: Col<"int4"> };
  b: { y: Col<"int4">; x: Nullable<"int8">; w: Col<"text"> };
  c: { x: Nullable<"int4">; v: Nullable<"text"> };
  active_users: View<{ id: Col<"int4">; email: Col<"text"> }>;
  auth: { sessions: { id: Col<"uuid">; user_id: Col<"int4">; expires: Nullable<"timestamptz"> } };
}
type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
type V<Q extends string> = Validate<DB, Q>;
type Body<Q extends string> = ParseProgram<Lex<Q>> extends { readonly body: infer B } ? B : never;
type User = { id: number; email: string; display_name: string | null; created_at: Date };

test("join kinds and nullability", () => {
  expectTypeOf<Row<"SELECT u.id, p.title FROM users u JOIN posts p ON p.author_id = u.id">>().toEqualTypeOf<{ id: number; title: string }>();
  expectTypeOf<Row<"SELECT u.id, p.title FROM users u INNER JOIN posts p ON p.author_id = u.id">>().toEqualTypeOf<{ id: number; title: string }>();
  expectTypeOf<Row<"SELECT u.id, p.title FROM users u LEFT OUTER JOIN posts p ON p.author_id = u.id">>().toEqualTypeOf<{ id: number; title: string | null }>();
  expectTypeOf<Row<"SELECT u.id, p.title FROM users u RIGHT JOIN posts p ON p.author_id = u.id">>().toEqualTypeOf<{ id: number | null; title: string }>();
  expectTypeOf<Row<"SELECT u.id, p.title FROM users u FULL OUTER JOIN posts p ON p.author_id = u.id">>().toEqualTypeOf<{ id: number | null; title: string | null }>();
  expectTypeOf<Row<"SELECT u.id, p.title FROM users u CROSS JOIN posts p">>().toEqualTypeOf<{ id: number; title: string }>();
  expectTypeOf<Row<"SELECT u.id, p.title FROM users u, posts p">>().toEqualTypeOf<{ id: number; title: string }>();
  // chained joins apply left to right
  expectTypeOf<Row<"SELECT u.id, p.title, s.expires FROM users u LEFT JOIN posts p ON p.author_id = u.id RIGHT JOIN auth.sessions s ON s.user_id = u.id">>()
    .toEqualTypeOf<{ id: number | null; title: string | null; expires: Date | null }>();
  // nested parenthesized joins: the inner join's columns all become nullable
  expectTypeOf<Row<"SELECT u.id, p.title, a.z FROM users u LEFT JOIN (posts p JOIN a ON a.x = p.author_id) ON p.author_id = u.id">>()
    .toEqualTypeOf<{ id: number; title: string | null; z: number | null }>();
  // an INNER join's ON condition proves the compared columns non-null
  expectTypeOf<Row<"SELECT b.x, c.v FROM b JOIN c ON c.x = b.x AND c.v IS NOT NULL">>().toEqualTypeOf<{ x: string; v: string }>();
  expectTypeOf<Row<"SELECT b.x FROM b LEFT JOIN c ON c.x = b.x">>().toEqualTypeOf<{ x: string | null }>();
});

test("USING: merged columns, qualified access, star order", () => {
  // merged column: common type (int4 ∪ int8), listed first, unqualified reference is not ambiguous
  expectTypeOf<Row<"SELECT * FROM users u JOIN posts p USING (id)">>()
    .toEqualTypeOf<{ id: string; email: string; display_name: string | null; created_at: Date; author_id: number; title: string; body: string | null; tags: string[]; meta: unknown }>();
  expectTypeOf<Row<"SELECT id, u.id AS uid, p.id AS pid FROM users u JOIN posts p USING (id)">>().toEqualTypeOf<{ id: string; uid: number; pid: string }>();
  expectTypeOf<Row<"SELECT * FROM a JOIN b USING (x, y)">>().toEqualTypeOf<{ x: string; y: number; z: number; w: string }>();
  // nullability of the merged column: inner → never null; LEFT → the left column; RIGHT → the right one; FULL → both
  expectTypeOf<Row<"SELECT x, b.x AS bx FROM a JOIN b USING (x)">>().toEqualTypeOf<{ x: string; bx: string }>();
  expectTypeOf<Row<"SELECT x, a.x AS ax FROM a LEFT JOIN b USING (x)">>().toEqualTypeOf<{ x: string; ax: number }>();
  expectTypeOf<Row<"SELECT x FROM a RIGHT JOIN b USING (x)">>().toEqualTypeOf<{ x: string | null }>();
  expectTypeOf<Row<"SELECT x FROM a FULL JOIN b USING (x)">>().toEqualTypeOf<{ x: string }>();
  expectTypeOf<Row<"SELECT x FROM b FULL JOIN c USING (x)">>().toEqualTypeOf<{ x: string | null }>();
  // the merged item belongs to its join: an outer join on top nulls it
  expectTypeOf<Row<"SELECT u.id, x, w FROM users u LEFT JOIN (a JOIN b USING (x)) ON true">>().toEqualTypeOf<{ id: number; x: string | null; w: string | null }>();
  // a join alias hides the inner names; USING ... AS j is accepted
  expectTypeOf<Row<"SELECT j.x, j.w FROM (a JOIN b USING (x)) AS j">>().toEqualTypeOf<{ x: string; w: string }>();
  expectTypeOf<Row<"SELECT x FROM a JOIN b USING (x) AS j">>().toEqualTypeOf<{ x: string }>();
  // (Postgres words this one "invalid reference to FROM-clause entry for table "a"")
  expectTypeOf<V<"SELECT a.z FROM (a JOIN b USING (x)) AS j">>().toEqualTypeOf<SqlError<'missing FROM-clause entry for table "a"', 1>>();
  expectTypeOf<V<"SELECT * FROM users u JOIN posts p USING (nope)">>().toEqualTypeOf<SqlError<'column "nope" specified in USING clause does not exist in left table', 10>>();
  expectTypeOf<V<"SELECT * FROM users u JOIN posts p USING (title)">>().toEqualTypeOf<SqlError<'column "title" specified in USING clause does not exist in left table', 10>>();
  expectTypeOf<V<"SELECT * FROM a JOIN users u USING (x)">>().toEqualTypeOf<SqlError<'column "x" specified in USING clause does not exist in right table', 9>>();
});

test("NATURAL joins", () => {
  expectTypeOf<Row<"SELECT * FROM a NATURAL JOIN b">>().toEqualTypeOf<{ x: string; y: number; z: number; w: string }>();
  expectTypeOf<Row<"SELECT * FROM a NATURAL LEFT JOIN b">>().toEqualTypeOf<{ x: string; y: number; z: number; w: string | null }>();
  expectTypeOf<Row<"SELECT * FROM users u NATURAL JOIN (SELECT 1 AS id) s">>().toEqualTypeOf<User>();
  // no common column: a cross join
  expectTypeOf<Row<"SELECT * FROM (SELECT 1 AS id) s NATURAL JOIN (SELECT 2 AS n) t">>().toEqualTypeOf<{ id: number; n: number }>();
});

test("SELECT * across joins: duplicate names keep the last column (like the row object)", () => {
  expectTypeOf<Row<"SELECT * FROM users CROSS JOIN posts">>()
    .toEqualTypeOf<{ id: string; email: string; display_name: string | null; created_at: Date; author_id: number; title: string; body: string | null; tags: string[]; meta: unknown }>();
  expectTypeOf<Row<"SELECT * FROM auth.sessions s JOIN users u ON u.id = s.user_id">>()
    .toEqualTypeOf<{ id: number; user_id: number; expires: Date | null; email: string; display_name: string | null; created_at: Date }>();
  expectTypeOf<Row<"SELECT u.*, p.id AS post_id FROM users u LEFT JOIN posts p ON p.author_id = u.id">>().toEqualTypeOf<{ id: number; email: string; display_name: string | null; created_at: Date; post_id: string | null }>();
});

test("table references: ONLY, *, schemas, namespaces, views, aliases", () => {
  expectTypeOf<Row<"SELECT id FROM ONLY users">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT id FROM users *">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT users.id FROM public.users">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT s.id, s.expires FROM auth.sessions s">>().toEqualTypeOf<{ id: string; expires: Date | null }>();
  expectTypeOf<Row<"SELECT sessions.user_id FROM auth.sessions">>().toEqualTypeOf<{ user_id: number }>();
  expectTypeOf<Row<"SELECT * FROM active_users">>().toEqualTypeOf<{ id: number; email: string }>();
  expectTypeOf<Row<"SELECT v.email FROM active_users v JOIN users u USING (id)">>().toEqualTypeOf<{ email: string }>();
  // keywords as aliases: non-reserved ones bare or after AS, reserved ones quoted
  expectTypeOf<Row<"SELECT day.id FROM users AS day">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT day.id FROM users day">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT \"order\".id FROM users AS \"order\"">>().toEqualTypeOf<{ id: number }>();
  // column aliases after AS may be any keyword
  expectTypeOf<Row<"SELECT id AS order, email AS from FROM users">>().toEqualTypeOf<{ order: number; from: string }>();
  expectTypeOf<V<"SELECT id FROM users AS order">>().toEqualTypeOf<SqlError<"syntax error at or near order", 5>>();
  expectTypeOf<V<"SELECT id FROM users AS left">>().toEqualTypeOf<SqlError<"syntax error at or near left", 5>>();
  expectTypeOf<V<"SELECT * FROM auth.nope">>().toEqualTypeOf<SqlError<'relation "auth.nope" does not exist', 0>>();
  expectTypeOf<V<"SELECT * FROM nope.users">>().toEqualTypeOf<SqlError<'relation "nope.users" does not exist', 0>>();
  expectTypeOf<V<"SELECT * FROM users, public.users">>().toEqualTypeOf<SqlError<'table name "users" specified more than once', 3>>();
});

test("ON errors", () => {
  expectTypeOf<V<"SELECT u.id FROM users u JOIN posts p ON p.nope = u.id">>().toEqualTypeOf<SqlError<"column p.nope does not exist", 13>>();
  expectTypeOf<V<"SELECT u.id FROM users u JOIN posts p ON p.title">>().toEqualTypeOf<SqlError<"argument of JOIN/ON must be type boolean, not type text", 0>>();
  expectTypeOf<V<"SELECT u.id FROM users u JOIN posts p ON 1">>().toEqualTypeOf<SqlError<"argument of JOIN/ON must be type boolean, not type integer", 0>>();
  expectTypeOf<V<"SELECT id FROM users u JOIN posts p ON true">>().toEqualTypeOf<SqlError<'column reference "id" is ambiguous', 1>>();
  expectTypeOf<V<"SELECT u.id FROM users u JOIN users u ON true">>().toEqualTypeOf<SqlError<'table name "u" specified more than once', 1>>();
  expectTypeOf<V<"SELECT u.id FROM users u JOIN posts p">>().toEqualTypeOf<SqlError<"syntax error: expected ON or USING at or near end of input", 10>>();
});

test("WHERE narrowing: IS NOT NULL and comparisons make a column non-null", () => {
  expectTypeOf<Row<"SELECT p.title FROM users u LEFT JOIN posts p ON p.author_id = u.id WHERE p.title IS NOT NULL">>().toEqualTypeOf<{ title: string }>();
  expectTypeOf<Row<"SELECT p.title, p.body FROM users u LEFT JOIN posts p ON p.author_id = u.id WHERE p.title IS NOT NULL AND p.body NOTNULL">>().toEqualTypeOf<{ title: string; body: string }>();
  // only the tested column is narrowed
  expectTypeOf<Row<"SELECT p.title, p.id FROM users u LEFT JOIN posts p ON p.author_id = u.id WHERE p.title IS NOT NULL">>().toEqualTypeOf<{ title: string; id: string | null }>();
  // comparisons, IN, LIKE, BETWEEN, = ANY reject NULLs
  expectTypeOf<Row<"SELECT display_name FROM users WHERE display_name = 'x'">>().toEqualTypeOf<{ display_name: string }>();
  expectTypeOf<Row<"SELECT display_name AS d FROM users WHERE id > 1 AND display_name LIKE 'a%'">>().toEqualTypeOf<{ d: string }>();
  expectTypeOf<Row<"SELECT u.display_name FROM users u WHERE u.display_name IN ('a', 'b')">>().toEqualTypeOf<{ display_name: string }>();
  expectTypeOf<Row<"SELECT b.x FROM b WHERE b.x BETWEEN 1 AND 10">>().toEqualTypeOf<{ x: string }>();
  expectTypeOf<Row<"SELECT x FROM b WHERE x = ANY ('{1,2}')">>().toEqualTypeOf<{ x: string }>();
  expectTypeOf<Row<"SELECT c.x, c.v FROM c WHERE c.x::text = c.v">>().toEqualTypeOf<{ x: number; v: string }>();
  // narrowing reaches *, expressions and later clauses
  expectTypeOf<Row<"SELECT * FROM c WHERE v IS NOT NULL">>().toEqualTypeOf<{ x: number | null; v: string }>();
  expectTypeOf<Row<"SELECT upper(v) AS u, v || '!' AS w FROM c WHERE v IS NOT NULL">>().toEqualTypeOf<{ u: string; w: string }>();
  // a merged USING column and a FULL join
  expectTypeOf<Row<"SELECT x FROM b FULL JOIN c USING (x) WHERE x IS NOT NULL">>().toEqualTypeOf<{ x: string }>();
});

test("WHERE narrowing goes through AND only, never OR / NOT, and stays in its query level", () => {
  expectTypeOf<Row<"SELECT v FROM c WHERE v IS NOT NULL OR x = 1">>().toEqualTypeOf<{ v: string | null }>();
  expectTypeOf<Row<"SELECT v FROM c WHERE NOT (v IS NULL)">>().toEqualTypeOf<{ v: string | null }>();
  expectTypeOf<Row<"SELECT v FROM c WHERE v IS NULL">>().toEqualTypeOf<{ v: string | null }>();
  expectTypeOf<Row<"SELECT v FROM c WHERE v IS DISTINCT FROM 'a'">>().toEqualTypeOf<{ v: string | null }>();
  expectTypeOf<Row<"SELECT v FROM c WHERE coalesce(v, 'a') = 'a'">>().toEqualTypeOf<{ v: string | null }>();
  // a subquery's WHERE does not narrow the outer query, and vice versa
  expectTypeOf<Row<"SELECT c.v FROM c WHERE EXISTS (SELECT 1 FROM b WHERE c.v IS NOT NULL)">>().toEqualTypeOf<{ v: string | null }>();
  expectTypeOf<Row<"SELECT (SELECT c.v) AS v FROM c WHERE c.v IS NOT NULL">>().toEqualTypeOf<{ v: string | null }>();
  // narrowing changes nullability only, never the type
  expectTypeOf<Row<"SELECT x FROM b WHERE x IS NOT NULL">>().toEqualTypeOf<{ x: string }>();
});

test("WHERE narrowing follows AND/OR precedence: AND binds tighter", () => {
  expectTypeOf<Row<"SELECT v FROM c WHERE x = 1 OR true AND v IS NOT NULL">>().toEqualTypeOf<{ v: string | null }>();
  expectTypeOf<Row<"SELECT v FROM c WHERE v IS NOT NULL AND true OR x = 1">>().toEqualTypeOf<{ v: string | null }>();
  expectTypeOf<Row<"SELECT v FROM c WHERE (x = 1 OR true) AND v IS NOT NULL">>().toEqualTypeOf<{ v: string }>();
  expectTypeOf<Body<"SELECT 1 WHERE a = 1 OR b AND c">>().toMatchTypeOf<{ readonly where: { readonly t: "bin"; readonly op: "or"; readonly r: { readonly t: "bin"; readonly op: "and" } } }>();
  expectTypeOf<Body<"SELECT 1 WHERE a AND b OR c">>().toMatchTypeOf<{ readonly where: { readonly t: "bin"; readonly op: "or"; readonly l: { readonly t: "bin"; readonly op: "and" } } }>();
});

test("WHERE narrowing: NOT BETWEEN narrows its operand, never its bounds", () => {
  // 0 NOT BETWEEN 1 AND NULL is TRUE (0 < 1), so x stays nullable
  expectTypeOf<Row<"SELECT x FROM c WHERE 0 NOT BETWEEN 1 AND x">>().toEqualTypeOf<{ x: number | null }>();
  expectTypeOf<Row<"SELECT x FROM c WHERE 5 NOT BETWEEN x AND 1">>().toEqualTypeOf<{ x: number | null }>();
  expectTypeOf<Row<"SELECT x FROM c WHERE x NOT BETWEEN 1 AND 2">>().toEqualTypeOf<{ x: number }>();
  expectTypeOf<Row<"SELECT x FROM c WHERE 0 BETWEEN 1 AND x">>().toEqualTypeOf<{ x: number }>();
});

test("WHERE narrowing of a USING column narrows the merged column only, not the hidden side's", () => {
  expectTypeOf<Row<"SELECT x, b.x AS bx FROM a LEFT JOIN b USING (x) WHERE x IS NOT NULL">>().toEqualTypeOf<{ x: string; bx: string | null }>();
  expectTypeOf<Row<"SELECT b.x FROM a LEFT JOIN b USING (x) WHERE x IS NOT NULL">>().toEqualTypeOf<{ x: string | null }>();
  expectTypeOf<Row<"SELECT b.x FROM a LEFT JOIN b USING (x) WHERE b.x IS NOT NULL">>().toEqualTypeOf<{ x: string }>();
});

test("WHERE / HAVING must be boolean", () => {
  expectTypeOf<V<"SELECT id FROM users WHERE id">>().toEqualTypeOf<SqlError<"argument of WHERE must be type boolean, not type integer", 0>>();
  expectTypeOf<V<"SELECT id FROM users WHERE email">>().toEqualTypeOf<SqlError<"argument of WHERE must be type boolean, not type text", 0>>();
  expectTypeOf<V<"SELECT count(*) FROM users HAVING count(*)">>().toEqualTypeOf<SqlError<"argument of HAVING must be type boolean, not type bigint", 0>>();
  expectTypeOf<Row<"SELECT id FROM users WHERE NULL">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"SELECT id FROM users WHERE 'true'">>().toEqualTypeOf<{ id: number }>();
});
