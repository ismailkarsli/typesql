// A hand-written type cache (what the content mapper would serve) whose entries are deliberately
// wrong, so the tests can tell a cached result from a computed one: `id` is cached as `bool`.
import type * as T from "../../../src/engine/index.js";
export {};

type Users = { id: T.Generated<"int4">; email: T.Col<"text"> };
type Plain = readonly [T.Missing, T.Missing, T.Missing, T.Missing];
/** A word that is a built-in function name (`lower`, `int4`). */
type Fn = readonly [T.Missing, T.Missing, T.Missing, T.Builtin];
type D0 = {
  v: T.CacheVersion;
  t: { mood: "happy" | "sad" };
  w: { select: Plain; id: Plain; from: Plain; users: readonly [Users, T.Missing, T.Missing, T.Missing]; u: Plain; email: Plain; where: Plain; lower: Fn };
  q: { "u.id": T.Missing };
  h: "users" | "users.id" | "users.email";
};
type D1 = Omit<D0, "v"> & { v: "an older engine" };
type Col<N extends string, Ty extends string> = { readonly n: N; readonly t: { readonly type: Ty; readonly nullable: false } };
type Select<C> = { readonly kind: "select"; readonly cols: C; readonly params: {}; readonly max: 0; readonly names: [] };

declare module "../../../src/engine/index.js" {
  interface QueryCacheKeys {
    "SELECT id FROM users": true;
    "SELECT u.id FROM users u": true;
    "SELECT lower(email) AS id FROM users": true;
    "SELECT email FROM users": true;
    "SELECT nope FROM users": true;
    "SELECT id FROM users WHERE id = $1": true;
  }
  interface CacheSnapshots {
    "hooks#0": D0;
    "hooks#1": D1;
  }
  interface QueryCache {
    "hooks#0": {
      "SELECT id FROM users": { r: "select" | "id" | "from" | "users" | "*"; a: Select<[Col<"id", "bool">]> };
      "SELECT u.id FROM users u": { r: "select" | "u" | "id" | "from" | "users" | "u.id" | "*"; a: Select<[Col<"id", "bool">]> };
      "SELECT lower(email) AS id FROM users": { r: "select" | "lower" | "email" | "id" | "from" | "users" | "*"; a: Select<[Col<"id", "bool">]> };
      "SELECT nope FROM users": { r: "select" | "nope" | "from" | "users" | "*" | "!h"; a: T.SqlError<"cached error", 0> };
      "SELECT id FROM users WHERE id = $1": {
        r: "select" | "id" | "from" | "users" | "where" | "*";
        c: { m: T.DefaultTypeMap; k: "preserve"; g: unknown; p: [id: boolean]; q: T.Query<{ id: boolean }, [boolean], "SELECT id FROM users WHERE id = $1"> };
      };
    };
    "hooks#1": {
      "SELECT email FROM users": { r: "select" | "email" | "from" | "users" | "*"; a: Select<[Col<"email", "bool">]> };
    };
  }
  interface DdlCacheKeys {
    "CREATE TABLE posts (id int4)": true;
  }
  interface DdlCache {
    hooks: {
      "CREATE TABLE posts (id int4)": {
        d: Omit<D0, "w" | "h"> & { w: { create: Plain; table: Plain; posts: Plain; id: Plain; int4: Fn } };
        r: "create" | "table" | "posts" | "id" | "int4" | "*";
        s: { posts: { id: T.Col<"bool"> } };
        x: never;
      };
    };
  }
}
