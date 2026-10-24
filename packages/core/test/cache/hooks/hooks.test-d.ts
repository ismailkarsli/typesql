import { expectTypeOf, test } from "vitest";
import { createSql, migrations, type ApplyDdl, type Col, type DefaultTypeMap, type Generated, type RowOf, type SchemaOf, type SqlError } from "../../../src/index.js";
import type { Analyze, ValidateDdl } from "../../../src/engine/index.js";
import "./cache.js";

// The schema the fixture's snapshot describes (cache.ts `D0`).
interface DB {
  users: { id: Generated<"int4">; email: Col<"text"> };
  $types: { mood: "happy" | "sad" };
}
type TM = DefaultTypeMap;

test("a fresh entry is used", () => {
  expectTypeOf<RowOf<DB, TM, "SELECT id FROM users">>().toEqualTypeOf<{ id: boolean }>();
  expectTypeOf<RowOf<DB, TM, "SELECT u.id FROM users u">>().toEqualTypeOf<{ id: boolean }>();
  expectTypeOf<RowOf<DB, TM, "SELECT lower(email) AS id FROM users">>().toEqualTypeOf<{ id: boolean }>();
  // a key the cache does not have is analysed
  expectTypeOf<RowOf<DB, TM, "SELECT email FROM users WHERE id = 1">>().toEqualTypeOf<{ email: string }>();
});

test("Analyze itself is never cached", () => {
  expectTypeOf<Analyze<DB, "SELECT id FROM users">["cols"][0]["t"]["type"]>().toEqualTypeOf<"int4">();
});

test("a changed relation makes its entries stale", () => {
  type Retyped = { users: { id: Generated<"int8">; email: Col<"text"> }; $types: DB["$types"] };
  expectTypeOf<RowOf<Retyped, TM, "SELECT id FROM users">>().toEqualTypeOf<{ id: string }>();
  type Nullable = { users: { id: Generated<"int4">; email: Col<"text", { nullable: true }> }; $types: DB["$types"] };
  expectTypeOf<RowOf<Nullable, TM, "SELECT id FROM users">>().toEqualTypeOf<{ id: number }>();
  type ExtraColumn = { users: DB["users"] & { name: Col<"text"> }; $types: DB["$types"] };
  expectTypeOf<RowOf<ExtraColumn, TM, "SELECT id FROM users">>().toEqualTypeOf<{ id: number }>();
});

test("a new relation that a name could resolve to makes its entries stale", () => {
  type WithU = DB & { u: { x: Col<"text"> } };
  expectTypeOf<RowOf<WithU, TM, "SELECT u.id FROM users u">>().toEqualTypeOf<{ id: number }>();
  // `id` is a word of the statement too: a table named `id` is a dependency
  type WithId = DB & { id: { x: Col<"text"> } };
  expectTypeOf<RowOf<WithId, TM, "SELECT id FROM users">>().toEqualTypeOf<{ id: number }>();
});

test("a changed enum registry makes every entry stale", () => {
  type MoreMoods = { users: DB["users"]; $types: { mood: "happy" | "sad" | "meh" } };
  expectTypeOf<RowOf<MoreMoods, TM, "SELECT id FROM users">>().toEqualTypeOf<{ id: number }>();
});

test("functions: a schema function with the name of a word makes the entry stale", () => {
  // (the built-in `lower` still wins over the schema's, so the computed row is text)
  type WithFn = DB & { $functions: { lower: import("../../../src/index.js").Sig<["text"], "int4"> } };
  expectTypeOf<RowOf<WithFn, TM, "SELECT lower(email) AS id FROM users">>().toEqualTypeOf<{ id: string }>();
});

test("an entry from another engine version is never used", () => {
  expectTypeOf<RowOf<DB, TM, "SELECT email FROM users">>().toEqualTypeOf<{ email: string }>();
});

test("errors: hint candidates are a dependency", () => {
  expectTypeOf<import("../../../src/index.js").Validate<DB, "SELECT nope FROM users">>().toEqualTypeOf<SqlError<"cached error", 0>>();
  type WithPosts = DB & { posts: { nope: Col<"text"> } };
  expectTypeOf<import("../../../src/index.js").Validate<WithPosts, "SELECT nope FROM users">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 1>>();
});

test("a cached call: check, arguments and return type", () => {
  const sql = createSql<DB>();
  const q = sql("SELECT id FROM users WHERE id = $1", true);
  expectTypeOf(q).toEqualTypeOf<import("../../../src/index.js").Query<{ id: boolean }, [boolean], "SELECT id FROM users WHERE id = $1">>();
  // another type map or rowKeys: not this entry
  const camel = createSql<DB>(undefined, { rowKeys: "camelCase" });
  expectTypeOf(camel("SELECT id FROM users WHERE id = $1", 1)).toEqualTypeOf<import("../../../src/index.js").Query<{ id: number }, [number | null], "SELECT id FROM users WHERE id = $1">>();
  type OtherMap = Omit<DefaultTypeMap, "int4"> & { int4: bigint };
  const other = createSql<DB, OtherMap>();
  expectTypeOf(other("SELECT id FROM users WHERE id = $1", 1n)).toEqualTypeOf<import("../../../src/index.js").Query<{ id: bigint }, [bigint | null], "SELECT id FROM users WHERE id = $1">>();
});

test("a union of texts is never looked up", () => {
  expectTypeOf<RowOf<DB, TM, "SELECT id FROM users" | "SELECT email FROM users">>().toEqualTypeOf<{ id: number } | { email: string }>();
});

test("DDL: a fresh step applies its cached effect; a changed schema does not", () => {
  expectTypeOf<ApplyDdl<DB, "CREATE TABLE posts (id int4)">["posts"]>().toEqualTypeOf<{ id: Col<"bool"> }>();
  const m = migrations<DB>().add("CREATE TABLE posts (id int4)");
  expectTypeOf<SchemaOf<typeof m>["posts"]>().toEqualTypeOf<{ id: Col<"bool"> }>();
  expectTypeOf<SchemaOf<typeof m>["users"]>().toEqualTypeOf<DB["users"]>();
  type WithPosts = DB & { posts: { title: Col<"text"> } };
  expectTypeOf<ApplyDdl<WithPosts, "CREATE TABLE posts (id int4)">>().toEqualTypeOf<SqlError<'relation "posts" already exists', 2>>();
  expectTypeOf<ValidateDdl<DB, "CREATE TABLE posts (id int4)">>().toEqualTypeOf<"CREATE TABLE posts (id int4)">();
});
