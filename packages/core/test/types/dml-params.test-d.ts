import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type Generated, type Nullable, type ParamsOf, type DefaultTypeMap } from "../../src/index.js";
import type { Analyze } from "../../src/engine/index.js";

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
    views: Generated<"int4">;
  };
}

const sql = createSql<DB>();
type Params<Q extends string> = ParamsOf<DB, DefaultTypeMap, Q>;
/** Raw `{ [n]: ColInfo }` map before the type map is applied. */
type Raw<Q extends string> = Analyze<DB, Q> extends { readonly params: infer P } ? { -readonly [K in keyof P]: P[K] } : never;
type T<Ty extends string, N extends boolean> = { readonly type: Ty; readonly nullable: N };

test("INSERT ... VALUES: column type, nullable iff the column is nullable", () => {
  expectTypeOf<Params<"INSERT INTO users (email) VALUES ($1)">>().toEqualTypeOf<[string]>();
  expectTypeOf<Params<"INSERT INTO posts (author_id, title) VALUES ($1, $2)">>().toEqualTypeOf<[number, string]>();
  expectTypeOf<Params<"INSERT INTO posts (title, author_id) VALUES ($2, $1)">>().toEqualTypeOf<[number, string]>();
  expectTypeOf<Raw<"INSERT INTO users (email, display_name) VALUES ($1, $2)">>().toEqualTypeOf<{ 1: T<"text", false>; 2: T<"text", true> }>();
  expectTypeOf<Raw<"INSERT INTO posts (author_id, title, body) VALUES ($1, $2, $3), ($4, $5, $6)">>().toEqualTypeOf<{
    1: T<"int4", false>; 2: T<"text", false>; 3: T<"text", true>; 4: T<"int4", false>; 5: T<"text", false>; 6: T<"text", true>;
  }>();
  // DEFAULT and literals take no slot; nested params fall back to the expression rules
  expectTypeOf<Params<"INSERT INTO users (email, display_name) VALUES ($1, DEFAULT)">>().toEqualTypeOf<[string]>();
  expectTypeOf<Params<"INSERT INTO posts (author_id, title) VALUES ($1 + 1, $2 || 'x')">>().toEqualTypeOf<[number, string]>();
  expectTypeOf<Params<"INSERT INTO posts (author_id, title) VALUES ($1::int4, 'x')">>().toEqualTypeOf<[number]>();
  // without a column list the positional order is unknown
  expectTypeOf<Params<"INSERT INTO users VALUES ($1, $2)">>().toEqualTypeOf<[unknown, unknown]>();
});

test("INSERT ... SELECT", () => {
  expectTypeOf<Params<"INSERT INTO posts (author_id, title) SELECT $1, $2">>().toEqualTypeOf<[number, string]>();
  expectTypeOf<Raw<"INSERT INTO posts (author_id, title, body) SELECT $1, $2, $3">>().toEqualTypeOf<{ 1: T<"int4", false>; 2: T<"text", false>; 3: T<"text", true> }>();
  expectTypeOf<Params<"INSERT INTO posts (author_id, title) SELECT id, email FROM users WHERE id = $1 AND email LIKE $2">>().toEqualTypeOf<[number | null, string | null]>();
  expectTypeOf<Params<"INSERT INTO posts (author_id, title) SELECT id, $1 FROM users LIMIT $2">>().toEqualTypeOf<[string, number | null]>();
});

test("ON CONFLICT DO UPDATE: SET takes the column type; WHERE sees the target and excluded", () => {
  expectTypeOf<Params<"INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = $2 WHERE users.id > $3">>().toEqualTypeOf<[string, string, number | null]>();
  expectTypeOf<Raw<"INSERT INTO users (email) VALUES ('a') ON CONFLICT (email) DO UPDATE SET display_name = $1 WHERE excluded.email = $2">>().toEqualTypeOf<{ 1: T<"text", true>; 2: T<"text", true> }>();
  expectTypeOf<Params<"INSERT INTO posts (author_id, title) VALUES (1, 'x') ON CONFLICT (id) DO UPDATE SET views = posts.views + $1">>().toEqualTypeOf<[number]>();
});

test("UPDATE", () => {
  expectTypeOf<Params<"UPDATE users SET email = $1 WHERE id = $2">>().toEqualTypeOf<[string, number | null]>();
  expectTypeOf<Raw<"UPDATE users SET email = $1, display_name = $2 WHERE id = $3">>().toEqualTypeOf<{ 1: T<"text", false>; 2: T<"text", true>; 3: T<"int4", true> }>();
  expectTypeOf<Params<"UPDATE posts SET (author_id, title) = ($1, $2) WHERE id = $3">>().toEqualTypeOf<[number, string, string | number | bigint | null]>();
  expectTypeOf<Params<"UPDATE posts SET views = views + $1 WHERE title LIKE $2">>().toEqualTypeOf<[number, string | null]>();
  // FROM items, WHERE and RETURNING use the expression rules with the target in scope
  expectTypeOf<Params<"UPDATE users u SET display_name = p.title FROM posts p WHERE p.author_id = u.id AND p.views > $1 RETURNING u.id, $2::text AS tag">>().toEqualTypeOf<[number | null, string]>();
  expectTypeOf<Params<"UPDATE users SET email = $1 FROM (SELECT id FROM posts WHERE views = $2) s WHERE s.id = users.id">>().toEqualTypeOf<[string, number | null]>();
  // the same parameter used twice is unified
  expectTypeOf<Params<"UPDATE users SET email = $1 WHERE email = $1">>().toEqualTypeOf<[string]>();
  // cast beats context
  expectTypeOf<Params<"UPDATE posts SET title = $1::text">>().toEqualTypeOf<[string]>();
});

test("DELETE", () => {
  expectTypeOf<Params<"DELETE FROM users WHERE id = $1">>().toEqualTypeOf<[number | null]>();
  expectTypeOf<Params<"DELETE FROM users u USING posts p WHERE p.author_id = u.id AND p.title = $1 AND u.id = ANY($2) RETURNING u.id">>().toEqualTypeOf<[string | null, (number | null)[] | null]>();
  expectTypeOf<Params<"DELETE FROM posts WHERE author_id IN (SELECT id FROM users WHERE email = $1) RETURNING id, $2::int4 AS n">>().toEqualTypeOf<[string | null, number]>();
  expectTypeOf<Params<"DELETE FROM users">>().toEqualTypeOf<[]>();
});

test("parameters inside WITH bodies", () => {
  expectTypeOf<Params<"WITH p AS (SELECT id FROM posts WHERE title = $1) INSERT INTO users (email) SELECT 'x' FROM p WHERE p.id = $2">>().toEqualTypeOf<[string | null, string | number | bigint | null]>();
  expectTypeOf<Params<"WITH del AS (DELETE FROM posts WHERE id = $1 RETURNING author_id) UPDATE users SET email = $2 FROM del WHERE users.id = del.author_id">>().toEqualTypeOf<[string | number | bigint | null, string]>();
});

test("nullable columns accept null at the sql() boundary", () => {
  expectTypeOf<Params<"INSERT INTO users (email, display_name) VALUES ($1, $2)">>().toEqualTypeOf<[string, string | null]>();
  expectTypeOf<Params<"UPDATE users SET display_name = $1">>().toEqualTypeOf<[string | null]>();
  sql("INSERT INTO users (email, display_name) VALUES ($1, $2)", "a", null);
  // the same param used for a nullable and a non-null column must be non-null
  expectTypeOf<Params<"UPDATE users SET display_name = $1, email = $1">>().toEqualTypeOf<[string]>();
});

test("sql() call sites", () => {
  sql("INSERT INTO posts (author_id, title) VALUES ($1, $2) RETURNING id", 1, "t");
  sql("UPDATE posts SET views = views + $1 WHERE id = $2", 1, "7");
  sql("DELETE FROM users WHERE id = ANY($1)", [1, 2]);
  // @ts-expect-error int4 column given a string
  sql("INSERT INTO posts (author_id, title) VALUES ($1, $2)", "1", "t");
  // @ts-expect-error null for a NOT NULL column
  sql("INSERT INTO users (email) VALUES ($1)", null);
  // @ts-expect-error too many params
  sql("UPDATE users SET email = $1", "a", "b");
  // int8 params take a string, a number or a bigint
  sql("DELETE FROM posts WHERE id = $1", "1");
  sql("DELETE FROM posts WHERE id = $1", 1);
});
