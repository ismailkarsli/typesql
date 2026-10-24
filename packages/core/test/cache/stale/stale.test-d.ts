import { expectTypeOf, test } from "vitest";
import type { Col, DefaultTypeMap, Generated, Nullable, RowOf, Sig, SqlError, Validate } from "../../../src/index.js";
import type { Analyze } from "../../../src/engine/index.js";
import type { CachedAnalysis, CachedDdl } from "../../../src/engine/cache.js";
import type { CallCached } from "../../../src/create-sql.js";
import type { DB, Q } from "./schema.js";

// This program has an augmentation the generating program did not: `score` is now a catalog
// function, which wins over the schema's own `score` (scenario "a catalog entry").
declare module "../../../src/index.js" {
  interface FunctionCatalog {
    score: Sig<["int4"], "text">;
  }
}

type TM = DefaultTypeMap;
type Hit<D, K extends string> = [CachedAnalysis<D, K>] extends [never] ? false : true;
type With<Patch> = Omit<DB, keyof Patch> & Patch;
type Users = DB["users"];

test("the schema the cache was generated for: entries are used", () => {
  expectTypeOf<Hit<DB, typeof Q.select>>().toEqualTypeOf<true>();
  expectTypeOf<Hit<DB, typeof Q.alias>>().toEqualTypeOf<true>();
  expectTypeOf<Hit<DB, typeof Q.error>>().toEqualTypeOf<true>();
  expectTypeOf<Validate<DB, typeof Q.error>>().toEqualTypeOf<SqlError<'column "nmae" does not exist. Perhaps you meant the column "name"?', 1>>();
  expectTypeOf<[CallCached<DB, TM, "preserve", typeof Q.param>] extends [never] ? false : true>().toEqualTypeOf<true>();
  expectTypeOf<[CachedDdl<DB, "ALTER TABLE users ADD COLUMN bio text">] extends [never] ? false : true>().toEqualTypeOf<true>();
});

test("a renamed, retyped or nullable column: entries over that table are computed again", () => {
  type Renamed = With<{ users: Omit<Users, "email"> & { mail: Col<"text"> } }>;
  expectTypeOf<Hit<Renamed, typeof Q.select>>().toEqualTypeOf<false>();
  expectTypeOf<RowOf<Renamed, TM, typeof Q.select>>().toEqualTypeOf<never>();
  expectTypeOf<Validate<Renamed, typeof Q.select>>().toEqualTypeOf<SqlError<'column "email" does not exist. Perhaps you meant the column "mail"?', 3>>();
  type Retyped = With<{ users: Omit<Users, "id"> & { id: Generated<"int8"> } }>;
  expectTypeOf<Hit<Retyped, typeof Q.select>>().toEqualTypeOf<false>();
  expectTypeOf<RowOf<Retyped, TM, typeof Q.select>>().toEqualTypeOf<{ id: string; email: string; name: string | null }>();
  type NotNull = With<{ users: Omit<Users, "name"> & { name: Col<"text"> } }>;
  expectTypeOf<Hit<NotNull, typeof Q.select>>().toEqualTypeOf<false>();
  expectTypeOf<RowOf<NotNull, TM, typeof Q.select>>().toEqualTypeOf<{ id: number; email: string; name: string }>();
  // a statement that does not mention users is still served from the cache
  expectTypeOf<Hit<NotNull, typeof Q.insert>>().toEqualTypeOf<true>();
  // and so is a migration step over another table, but not one over users
  expectTypeOf<[CachedDdl<NotNull, "CREATE TABLE tags (id int4 PRIMARY KEY, label text NOT NULL)">] extends [never] ? false : true>().toEqualTypeOf<true>();
  expectTypeOf<[CachedDdl<NotNull, "ALTER TABLE users ADD COLUMN bio text">] extends [never] ? false : true>().toEqualTypeOf<false>();
});

test("a new table named like a CTE or an alias", () => {
  type WithT = DB & { t: { id: Col<"text"> } };
  expectTypeOf<Hit<WithT, typeof Q.cte>>().toEqualTypeOf<false>();
  expectTypeOf<RowOf<WithT, TM, typeof Q.cte>>().toEqualTypeOf<{ id: number }>();
  type WithU = DB & { u: { id: Col<"text"> } };
  expectTypeOf<Hit<WithU, typeof Q.alias>>().toEqualTypeOf<false>();
  expectTypeOf<Hit<WithU, typeof Q.select>>().toEqualTypeOf<true>();
});

test("an enum value added or removed: every entry is computed again", () => {
  type More = With<{ $types: { mood: "happy" | "sad" | "meh" } }>;
  expectTypeOf<Hit<More, typeof Q.mood>>().toEqualTypeOf<false>();
  expectTypeOf<RowOf<More, TM, typeof Q.mood>>().toEqualTypeOf<{ mood: "happy" | "sad" | "meh" | null }>();
  expectTypeOf<Hit<More, typeof Q.select>>().toEqualTypeOf<false>();
  type Fewer = With<{ $types: { mood: "happy" } }>;
  expectTypeOf<RowOf<Fewer, TM, typeof Q.mood>>().toEqualTypeOf<{ mood: "happy" | null }>();
});

test("functions: a changed schema function, a catalog entry added by augmentation", () => {
  type Changed = With<{ $functions: { score: Sig<["int4"], "int4">; bonus: Sig<["int4"], "float8"> } }>;
  expectTypeOf<Hit<Changed, typeof Q.fn2>>().toEqualTypeOf<false>();
  expectTypeOf<RowOf<Changed, TM, typeof Q.fn2>>().toEqualTypeOf<{ b: number }>();
  expectTypeOf<Hit<DB, typeof Q.fn2>>().toEqualTypeOf<true>();
  // `score` resolves to the augmentation (text) now, for the unchanged schema too
  expectTypeOf<Hit<DB, typeof Q.fn>>().toEqualTypeOf<false>();
  expectTypeOf<RowOf<DB, TM, typeof Q.fn>>().toEqualTypeOf<{ s: string }>();
});

test("errors: a new name a hint could choose makes an error entry stale", () => {
  type Other = DB & { other: { x: Col<"text"> } };
  expectTypeOf<Hit<Other, typeof Q.error>>().toEqualTypeOf<false>();
  expectTypeOf<Hit<Other, typeof Q.select>>().toEqualTypeOf<true>();
  type Closer = With<{ users: Users & { nmaes: Col<"text"> } }>;
  expectTypeOf<Validate<Closer, typeof Q.error>>().toEqualTypeOf<SqlError<'column "nmae" does not exist. Perhaps you meant the column "nmaes"?', 1>>();
});

test("another type map or rowKeys: call entries of the generating program are not used", () => {
  type OtherTM = Omit<TM, "int4"> & { int4: bigint };
  expectTypeOf<[CallCached<DB, OtherTM, "preserve", typeof Q.param>] extends [never] ? false : true>().toEqualTypeOf<false>();
  expectTypeOf<[CallCached<DB, TM, "camelCase", typeof Q.param>] extends [never] ? false : true>().toEqualTypeOf<false>();
  expectTypeOf<[CallCached<DB, TM, "camelCase", "SELECT name AS display_name FROM users">] extends [never] ? false : true>().toEqualTypeOf<true>();
});

test("column order is not a dependency: INSERT without a column list relies on the count only", () => {
  type Reordered = With<{ posts: { title: Col<"text">; author_id: Col<"int4">; id: Generated<"int8"> } }>;
  expectTypeOf<Hit<Reordered, typeof Q.insert>>().toEqualTypeOf<true>();
  expectTypeOf<CachedAnalysis<Reordered, typeof Q.insert>["cols"]>().toEqualTypeOf<Analyze<Reordered, typeof Q.insert>["cols"]>();
  type Wider = With<{ posts: DB["posts"] & { extra: Nullable<"text"> } }>;
  expectTypeOf<Hit<Wider, typeof Q.insert>>().toEqualTypeOf<false>();
});
