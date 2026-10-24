import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type Generated, type Nullable, type View, type RowOf, type ParamsOf, type Validate, type SqlError, type DefaultTypeMap } from "../../src/index.js";
import type { KindOf } from "../../src/engine/index.js";

interface DB {
  users: {
    id: Generated<"int4">;
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
  };
  posts: {
    id: Generated<"int8">;
    author_id: Col<"int4">;
    title: Col<"text">;
    body: Nullable<"text">;
  };
  /** Every column has a default: `DEFAULT VALUES` is legal. */
  events: {
    id: Generated<"int8">;
    at: Generated<"timestamptz">;
    note: Nullable<"text">;
  };
  active_users: View<{ id: Col<"int4">; email: Col<"text"> }>;
}

const sql = createSql<DB>();
type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
type Params<Q extends string> = ParamsOf<DB, DefaultTypeMap, Q>;
type V<Q extends string> = Validate<DB, Q>;

test("INSERT without RETURNING has no row type", () => {
  expectTypeOf<Row<"INSERT INTO users (email) VALUES ('a')">>().toEqualTypeOf<never>();
  expectTypeOf<Row<"INSERT INTO users (email, display_name) VALUES ('a', 'b'), ('c', NULL)">>().toEqualTypeOf<never>();
  expectTypeOf<KindOf<DB, "INSERT INTO users (email) VALUES ('a')">>().toEqualTypeOf<"insert">();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a')">>().toEqualTypeOf<"INSERT INTO users (email) VALUES ('a')">();
});

test("INSERT ... RETURNING", () => {
  expectTypeOf<Row<"INSERT INTO users (email) VALUES ('a') RETURNING id">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"INSERT INTO users (email) VALUES ('a') RETURNING *">>().toEqualTypeOf<{ id: number; email: string; display_name: string | null; created_at: Date }>();
  expectTypeOf<Row<"INSERT INTO users AS u (email) VALUES ('a') RETURNING u.id, u.email || 'x' AS e, 1 AS one">>().toEqualTypeOf<{ id: number; e: string; one: number }>();
  expectTypeOf<Row<"INSERT INTO users (email, display_name) VALUES ('a', DEFAULT) RETURNING display_name, created_at">>().toEqualTypeOf<{ display_name: string | null; created_at: Date }>();
  expectTypeOf<Row<"INSERT INTO ONLY users (email) VALUES ('a') RETURNING id">>().toEqualTypeOf<{ id: number }>();
});

test("VALUES: DEFAULT, multi-row, column list checks", () => {
  // DEFAULT is a VALUES item only, and stores NULL in a column without a default
  expectTypeOf<V<"INSERT INTO users (email, display_name) VALUES (DEFAULT, 'x')">>().toEqualTypeOf<SqlError<'null value in column "email" of relation "users" violates not-null constraint', 4>>();
  expectTypeOf<V<"INSERT INTO users (id, email) VALUES (DEFAULT, 'a'), (DEFAULT, 'b')">>().toEqualTypeOf<"INSERT INTO users (id, email) VALUES (DEFAULT, 'a'), (DEFAULT, 'b')">();
  expectTypeOf<V<"INSERT INTO users (email, display_name) VALUES ('a', coalesce(DEFAULT, 'b'))">>().toEqualTypeOf<SqlError<"DEFAULT is not allowed in this context", 14>>();
  expectTypeOf<V<"SELECT DEFAULT FROM users">>().toEqualTypeOf<SqlError<"DEFAULT is not allowed in this context", 1>>();
  expectTypeOf<V<"INSERT INTO users (email, display_name) VALUES ('a', DEFAULT), ('b', 'c')">>().toEqualTypeOf<"INSERT INTO users (email, display_name) VALUES ('a', DEFAULT), ('b', 'c')">();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a'), ('b', 'c')">>().toEqualTypeOf<SqlError<"VALUES lists must all be the same length", 0>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a', 'b')">>().toEqualTypeOf<SqlError<"INSERT has more expressions than target columns", 0>>();
  expectTypeOf<V<"INSERT INTO users (email, display_name) VALUES ('a')">>().toEqualTypeOf<SqlError<"INSERT has more target columns than expressions", 0>>();
  expectTypeOf<V<"INSERT INTO users (emial) VALUES ('a')">>().toEqualTypeOf<SqlError<'column "emial" of relation "users" does not exist. Perhaps you meant the column "email"?', 4>>();
  // expressions in VALUES are typed against the outer scope only
  expectTypeOf<V<"INSERT INTO users (email) VALUES (nope)">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 8>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES (users.email)">>().toEqualTypeOf<SqlError<'missing FROM-clause entry for table "users"', 2>>();
});

test("required columns (NOT NULL without default)", () => {
  expectTypeOf<V<"INSERT INTO users (display_name) VALUES ('a')">>().toEqualTypeOf<SqlError<'null value in column "email" of relation "users" violates not-null constraint', 2>>();
  expectTypeOf<V<"INSERT INTO users DEFAULT VALUES">>().toEqualTypeOf<SqlError<'null value in column "email" of relation "users" violates not-null constraint', 2>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES (NULL)">>().toEqualTypeOf<SqlError<'null value in column "email" of relation "users" violates not-null constraint', 4>>();
  // generated / nullable columns may be omitted
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a')">>().toEqualTypeOf<"INSERT INTO users (email) VALUES ('a')">();
  expectTypeOf<V<"INSERT INTO posts (author_id, title) VALUES (1, 't')">>().toEqualTypeOf<"INSERT INTO posts (author_id, title) VALUES (1, 't')">();
  expectTypeOf<Row<"INSERT INTO events DEFAULT VALUES RETURNING id, note">>().toEqualTypeOf<{ id: string; note: string | null }>();
});

test("target table errors", () => {
  expectTypeOf<V<"INSERT INTO active_users (email) VALUES ('a')">>().toEqualTypeOf<SqlError<'cannot insert into view "active_users"', 2>>();
  expectTypeOf<V<"INSERT INTO nope (email) VALUES ('a')">>().toEqualTypeOf<SqlError<'relation "nope" does not exist', 2>>();
  // a CTE is not a DML target (as in Postgres)
  expectTypeOf<V<"WITH c AS (SELECT 1 AS x) INSERT INTO c (x) VALUES (2)">>().toEqualTypeOf<SqlError<'relation "c" does not exist', 1>>();
});

test("no column list: width check only, positional order unknown", () => {
  expectTypeOf<V<"INSERT INTO users VALUES (1, 'a', NULL, now())">>().toEqualTypeOf<"INSERT INTO users VALUES (1, 'a', NULL, now())">();
  expectTypeOf<V<"INSERT INTO users VALUES (1, 'a')">>().toEqualTypeOf<"INSERT INTO users VALUES (1, 'a')">();
  expectTypeOf<V<"INSERT INTO users VALUES (1, 'a', NULL, now(), 5)">>().toEqualTypeOf<SqlError<"INSERT has more expressions than target columns", 0>>();
  expectTypeOf<Row<"INSERT INTO users VALUES (1, 'a') RETURNING id">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Params<"INSERT INTO users VALUES ($1, $2)">>().toEqualTypeOf<[unknown, unknown]>();
});

test("INSERT ... SELECT", () => {
  expectTypeOf<V<"INSERT INTO posts (author_id, title) SELECT id, email FROM users">>().toEqualTypeOf<"INSERT INTO posts (author_id, title) SELECT id, email FROM users">();
  expectTypeOf<Row<"INSERT INTO posts (author_id, title) SELECT id, email FROM users RETURNING id, title">>().toEqualTypeOf<{ id: string; title: string }>();
  expectTypeOf<V<"INSERT INTO posts (author_id, title) SELECT id FROM users">>().toEqualTypeOf<SqlError<"INSERT has more target columns than expressions", 0>>();
  expectTypeOf<V<"INSERT INTO posts (author_id, title) SELECT id, email, 1 FROM users">>().toEqualTypeOf<SqlError<"INSERT has more expressions than target columns", 0>>();
  // a `*` makes the width unknown: no count check
  expectTypeOf<V<"INSERT INTO posts (author_id, title) SELECT * FROM users">>().toEqualTypeOf<"INSERT INTO posts (author_id, title) SELECT * FROM users">();
  // parenthesized and WITH-prefixed sources
  expectTypeOf<Row<"INSERT INTO users (email) (SELECT email FROM users) RETURNING id">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"INSERT INTO users (email) WITH s AS (SELECT email FROM users) SELECT email FROM s RETURNING id">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<V<"INSERT INTO users (email) SELECT nope FROM users">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 7>>();
  expectTypeOf<V<"INSERT INTO users (email) OVERRIDING SYSTEM VALUE SELECT email FROM users">>().toEqualTypeOf<"INSERT INTO users (email) OVERRIDING SYSTEM VALUE SELECT email FROM users">();
});

test("ON CONFLICT", () => {
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO NOTHING">>().toEqualTypeOf<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO NOTHING">();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT DO NOTHING">>().toEqualTypeOf<"INSERT INTO users (email) VALUES ('a') ON CONFLICT DO NOTHING">();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT ON CONSTRAINT users_email_key DO NOTHING">>().toEqualTypeOf<"INSERT INTO users (email) VALUES ('a') ON CONFLICT ON CONSTRAINT users_email_key DO NOTHING">();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (lower(email)) WHERE id > 1 DO NOTHING">>().toEqualTypeOf<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (lower(email)) WHERE id > 1 DO NOTHING">();
  // DO UPDATE sees the target (by name or alias) and `excluded`
  expectTypeOf<Row<"INSERT INTO users (email, display_name) VALUES ('a', 'b') ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name RETURNING id, display_name">>().toEqualTypeOf<{ id: number; display_name: string | null }>();
  expectTypeOf<Row<"INSERT INTO users AS u (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET display_name = excluded.email || u.email, created_at = DEFAULT WHERE u.id > 1 RETURNING u.display_name">>().toEqualTypeOf<{ display_name: string | null }>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET email = DEFAULT">>().toEqualTypeOf<SqlError<'null value in column "email" of relation "users" violates not-null constraint', 4>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET display_name = users.email">>().toEqualTypeOf<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET display_name = users.email">();
  // an unqualified column present in both the target and `excluded` is ambiguous (Postgres behaviour)
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET display_name = email">>().toEqualTypeOf<SqlError<'column reference "email" is ambiguous', 4>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET nope = 1">>().toEqualTypeOf<SqlError<'column "nope" of relation "users" does not exist', 18>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET display_name = excluded.nope">>().toEqualTypeOf<SqlError<"column excluded.nope does not exist", 22>>();
  // RETURNING does not see `excluded`
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO NOTHING RETURNING excluded.email">>().toEqualTypeOf<SqlError<'missing FROM-clause entry for table "excluded"', 18>>();
});

test("INSERT inside WITH", () => {
  expectTypeOf<Row<"WITH ins AS (INSERT INTO users (email) VALUES ('a') RETURNING id, email) SELECT ins.id, ins.email FROM ins">>().toEqualTypeOf<{ id: number; email: string }>();
  expectTypeOf<Row<"WITH ins AS (INSERT INTO users (email) VALUES ('a') RETURNING *) SELECT i.id, p.title FROM ins i LEFT JOIN posts p ON p.author_id = i.id">>().toEqualTypeOf<{ id: number; title: string | null }>();
  expectTypeOf<Row<"WITH src AS (SELECT email FROM users) INSERT INTO users (email) SELECT email FROM src RETURNING id">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<Row<"WITH a AS (INSERT INTO users (email) VALUES ('a') RETURNING id), b AS (INSERT INTO posts (author_id, title) SELECT id, 'hi' FROM a RETURNING id) SELECT * FROM b">>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<V<"WITH ins AS (INSERT INTO users (email) VALUES ('a')) SELECT * FROM ins">>().toEqualTypeOf<SqlError<'WITH query "ins" does not have a RETURNING clause', 1>>();
});

test("syntax errors", () => {
  expectTypeOf<V<"INSERT users (email) VALUES ('a')">>().toEqualTypeOf<SqlError<"syntax error: expected INTO at or near users", 1>>();
  expectTypeOf<V<"INSERT INTO users (email) DEFAULT VALUES">>().toEqualTypeOf<SqlError<"syntax error at or near default: DEFAULT VALUES cannot be combined with a column list", 6>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') ON CONFLICT DO">>().toEqualTypeOf<SqlError<"syntax error: expected NOTHING or UPDATE SET at or near end of input", 13>>();
  expectTypeOf<V<"INSERT INTO users (email) 'a'">>().toEqualTypeOf<SqlError<"syntax error: expected VALUES, SELECT or DEFAULT VALUES at or near 'a'", 6>>();
  expectTypeOf<V<"INSERT INTO users (email) VALUES ('a') RETURNING nope">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 11>>();
});

test("sql() call sites", () => {
  const q = sql("INSERT INTO users (email) VALUES ($1) RETURNING id", "a");
  expectTypeOf(q.text).toEqualTypeOf<string>();
  sql("INSERT INTO posts (author_id, title) VALUES ($1, $2)", 1, "t");
  // @ts-expect-error wrong param type (text column)
  sql("INSERT INTO users (email) VALUES ($1) RETURNING id", 1);
  // @ts-expect-error missing param
  sql("INSERT INTO users (email) VALUES ($1)");
  expectTypeOf<Validate<DB, "INSERT INTO users (emial) VALUES ('a')">>()
    .toEqualTypeOf<SqlError<'column "emial" of relation "users" does not exist. Perhaps you meant the column "email"?', 4>>();
  expectTypeOf<Validate<DB, "INSERT INTO users (display_name) VALUES ('a')">>()
    .toEqualTypeOf<SqlError<'null value in column "email" of relation "users" violates not-null constraint', 2>>();
  expectTypeOf<Validate<DB, "INSERT INTO active_users (email) VALUES ('a')">>().toEqualTypeOf<SqlError<'cannot insert into view "active_users"', 2>>();
});
