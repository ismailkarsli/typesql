import type { EnumsOf } from "../type-map/index.js";
import type { FunctionCatalog } from "./typer/catalog.js";
import type { IsRelation, RelCols } from "./suggest.js";
import type { Analyze } from "./infer.js";
import type { AnyShaped, BaseOf } from "./shape.js";
import type { ApplyPatch } from "./ddl/apply.js";

/**
 * Type cache: results computed ahead of time by the content mapper's background job
 * (`src/cache/**`) and served to the checker from a `.typesqlcache` file, which the mapper turns
 * into an augmentation of these interfaces. Without that file both stay empty, every lookup
 * misses after one `keyof` check, and nothing else changes.
 *
 * Every entry records what it was computed from, and is used only when all of that is unchanged
 * in the current program (see `Fresh`); otherwise the lookup falls through to the full analysis.
 * A missing, old or partial cache file therefore makes checking slower, never different.
 *
 *   declare module "@typesql/core/engine" {
 *     interface QueryCacheKeys { "SELECT …": true }
 *     interface CacheSnapshots { "<file id>#0": D0 }
 *     interface QueryCache {
 *       "<file id>#0": { "SELECT …": { r: "users" | "u" | "*"; a: {…}; c?: {…} } };
 *     }
 *   }
 *
 * Entries are grouped by cache file and by the `DB` snapshot they were computed against (one
 * group per `DB` type the file covers). Grouping by file keeps two files that declare the same
 * key apart (the same key with different types in one interface is TS2717); grouping by
 * snapshot lets freshness be decided once per group (`GroupStale`), so a lookup in a group with
 * nothing stale is one indexed access. `QueryCacheKeys` repeats every key with the same type
 * `true`, which merges, so a miss is one `keyof` check however many files there are.
 */
export interface QueryCache {}
/** Every key in `QueryCache`, across files. */
export interface QueryCacheKeys {}
/** The snapshot (`DbSnapshot`) of each group of `QueryCache`. */
export interface CacheSnapshots {}

/**
 * DDL steps (`migrations().add(…)`, `ApplyDdl`): per cache file, script text → entry. Each entry
 * carries its own snapshot (`d`, of the schema before the step): every step of a migration
 * chain starts from a different schema, so there is nothing to share.
 */
export interface DdlCache {}
/** Every key in `DdlCache`, across files. */
export interface DdlCacheKeys {}

/**
 * Version of the engine's output. An entry computed by another version is never used. It is a
 * hash of the type-level sources, kept up to date by `node scripts/cache-version.ts`.
 */
export type CacheVersion = "ff059fd7c737";

/** A relation, function or catalog entry that did not exist when the entry was computed. */
export interface Missing { readonly "typesql.missing": true }
/**
 * `FunctionCatalog[name]` is one of TypeSQL's built-in entries (which an augmentation cannot
 * change, and which `CacheVersion` covers).
 */
export interface Builtin { readonly "typesql.builtin": true }

/**
 * What a cache file's entries for one `DB` type were computed from. Entries name the parts they
 * depend on (`r`); `Stale` lists the parts that changed since, once per program.
 *
 * - `v`: `CacheVersion` at generation time.
 * - `t`: the whole enum registry (`DB["$types"]`).
 * - `w`: per word of the statements (every identifier, lowercased unless quoted): the relation
 *   `DB[w]`, the `pg_catalog` relation `DB["pg_catalog"][w]`, the schema function
 *   `DB["$functions"][w]` and the catalog entry `FunctionCatalog[w]`, each `Missing` when absent.
 *   Every identifier is recorded, not only the ones that name something today, so a new table
 *   that a statement's name would now resolve to makes its entries stale.
 * - `q`: per qualified pair `a.b`: `DB[a][b]` (a relation in schema `a`).
 * - `h` (query snapshots): names "Perhaps you meant" hints choose from (`HintIndex`), for entries
 *   that are errors.
 * - `all` (DDL snapshots of `DROP TYPE` / `ALTER TYPE` steps, which rewrite columns anywhere): the
 *   whole schema.
 */
export type DbSnapshot = {
  readonly v: string;
  readonly t: unknown;
  readonly w: { readonly [word: string]: readonly [rel: unknown, pg: unknown, fn: unknown, cat: unknown] };
  readonly q: { readonly [pair: string]: unknown };
  readonly h?: unknown;
  readonly all?: unknown;
};

/**
 * Parts of `D` that differ in `DB`: `"*"` (version or enums, which every entry depends on),
 * words, pairs, or `"!h"`. Computed once per `(DB, D)`; each lookup then only intersects it with
 * an entry's dependencies.
 */
export type Stale<DB, D extends DbSnapshot> =
  | (D["v"] extends CacheVersion ? never : "*")
  | (Same<EnumsOf<DB>, D["t"]> extends true ? never : "*")
  | { [W in keyof D["w"] & string]: WordFresh<DB, W, D["w"][W]> extends true ? never : W }[keyof D["w"] & string]
  | { [P in keyof D["q"] & string]: Same<PairOf<DB, P>, D["q"][P]> extends true ? never : P }[keyof D["q"] & string]
  | (D extends { readonly h: infer H } ? (Same<HintIndex<DB>, H> extends true ? never : "!h") : never)
  | (D extends { readonly all: infer A } ? (Same<DB, A> extends true ? never : "!all") : never);

/**
 * The comparison every dependency uses: mutual assignability of expanded copies. Comparing the
 * types themselves is not enough: TypeScript relates two instantiations of one alias through the
 * variance it measured for each type parameter, and skips parameters it found independent.
 * `Col`'s `Flags` only appears inside conditional types, so `Col<"text", { nullable: true }>`
 * and `Col<"text">` would compare equal.
 */
export type Same<A, B> = Mutual<Expand<A>, Expand<B>>;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/**
 * Objects and tuples mapped member by member down to literals. Functions, and the TS type of a
 * typed JSON column (`TsShape`, possibly recursive), are kept as they are.
 */
type Expand<T> =
  T extends (...args: never) => unknown ? T
  : T extends { readonly k: "ts"; readonly v: unknown } ? T
  : T extends object ? { [K in keyof T]: Expand<T[K]> }
  : T;

type WordFresh<DB, W extends string, S extends readonly unknown[]> =
  Same<W extends keyof DB ? DB[W] : Missing, S[0]> extends false ? false
  : Same<PgRel<DB, W>, S[1]> extends false ? false
  : Same<SchemaFn<DB, W>, S[2]> extends false ? false
  : S[3] extends Builtin ? true
  : Same<W extends keyof FunctionCatalog ? FunctionCatalog[W] : Missing, S[3]>;

type PgRel<DB, W extends string> = DB extends { readonly pg_catalog: infer PC } ? (W extends keyof PC ? PC[W] : Missing) : Missing;
type SchemaFn<DB, W extends string> = DB extends { readonly $functions: infer F } ? (W extends keyof F ? F[W] : Missing) : Missing;
type PairOf<DB, P extends string> =
  P extends `${infer A}.${infer B}` ? (A extends keyof DB ? (B extends keyof DB[A] ? DB[A][B] : Missing) : Missing) : Missing;

/**
 * Names a hint can suggest: every relation name (top level and inside schemas) and every
 * `relation.column`. A misspelled-name error depends on these, not only on what it mentions.
 */
export type HintIndex<DB> = {
  [K in keyof DB & string]: K extends "$types" | "$functions" ? never
  : IsRelation<DB[K]> extends true ? K | `${K}.${RelCols<DB[K]>}`
  : { [R in keyof DB[K] & string]: IsRelation<DB[K][R]> extends true ? R | `${R}.${RelCols<DB[K][R]>}` : never }[keyof DB[K] & string];
}[keyof DB & string];

/** One cache entry: a key in one group (`c`: one per type map and `rowKeys`, a union). */
export type CacheEntry = {
  /** Dependencies: words, pairs, `"*"`, and `"!h"` for errors. */
  readonly r: string;
  /** The analysis (`Analysis`) of the key as positional text. */
  readonly a?: unknown;
  /** The `sql()` call with the key as its literal (see create-sql.ts `CallCached`). */
  readonly c?: CallEntry;
};
export type CallEntry = {
  /** Type map snapshot and `rowKeys` the call was computed with. */
  readonly m: unknown;
  readonly k: string;
  /** The query argument's check: `unknown` when valid, else the SqlError. */
  readonly g: unknown;
  /** Arguments after the query. */
  readonly p: readonly unknown[];
  /** Return type. */
  readonly q: unknown;
};

/** What changed in `DB` since group `G`'s snapshot (`"*"` for a group without one). */
type GroupStale<DB, G> = G extends keyof CacheSnapshots ? (CacheSnapshots[G] extends infer D extends DbSnapshot ? Stale<DB, D> : "*") : "*";

/** The entry of `Q` in group `G` when its dependencies are unchanged in `DB`. */
type FreshIn<DB, G, E> =
  GroupStale<DB, G> extends infer S
    ? [S] extends [never] ? E
    : E extends { readonly r: infer R } ? ([Extract<S, R>] extends [never] ? E : never) : never
    : never;

/**
 * Fresh entries of `Q` across groups, each as `[group, entry]` (usually one; never when none).
 * The group keeps entries of two files apart even when their types are the same, so `OneOf`
 * picks one of them rather than taking both as one type.
 */
export type FreshVariants<DB, Q extends string> =
  { [G in keyof QueryCache]: Q extends keyof QueryCache[G] ? (FreshIn<DB, G, QueryCache[G][Q]> extends infer E ? ([E] extends [never] ? never : [G, E]) : never) : never }[keyof QueryCache];

/**
 * One member of a union (the last, in TypeScript's order); itself for a non-union. Several fresh
 * entries for one key (from several cache files) are equivalent; this keeps one.
 */
export type OneOf<U> = IsUnion<U> extends false ? U : LastOf<U>;
type LastOf<U> = UnionToIntersection<U extends unknown ? (x: U) => void : never> extends (x: infer L) => void ? L : never;
type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (u: infer I) => void ? I : never;

/** `true` for a union of more than one member, `false` for one type, `never` for `never`. */
export type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * The cached analysis of a key of `QueryCacheKeys`, or `never` on a miss. A union `Q` (a fragment with a union text)
 * is never looked up: each member would need its own entry.
 */
export type CachedAnalysis<DB, Q extends string> =
  IsUnion<Q> extends true ? never
  : Second<OneOf<FreshVariants<DB, Q> extends infer V ? (V extends [infer G, { readonly a: infer A }] ? [G, A] : never) : never>>;

/** `P[1]`, and `never` for `never` (where `never extends [unknown, infer X]` would give `unknown`). */
export type Second<P> = [P] extends [never] ? never : P extends [unknown, infer X] ? X : never;

// ─── generation (used by the job's probe file, src/cache/**) ───

/**
 * What an entry stores for `Analysis`: `Analyze` without `stmt` (no projection reads it), with
 * the engine's internal aliases (`Shaped`, `ParamsToMap`, …) written out (`Plain`), so that the
 * printed type only names what `@typesql/core/engine` exports.
 */
export type CacheAnalysis<DB, Q extends string> =
  Analyze<DB, Q> extends infer R
    ? R extends { readonly stmt: unknown; readonly kind: infer K; readonly cols: infer C; readonly params: infer P; readonly max: infer M; readonly names: infer N }
      ? { readonly kind: K; readonly cols: Plain<C>; readonly params: Plain<P>; readonly max: M; readonly names: N }
      : R
    : never;

/**
 * The same type without aliases: objects and tuples are mapped member by member, branded type
 * names (`Shaped`) are rebuilt. A `TsShape`'s TS type is kept as it is.
 */
export type Plain<T> =
  T extends { readonly k: "ts"; readonly v: infer V } ? { readonly k: "ts"; readonly v: V }
  : T extends string ? (T extends AnyShaped ? BaseOf<T> & { readonly shape: Plain<T["shape"]> } : T)
  : T extends object ? { [K in keyof T]: Plain<T[K]> }
  : T;

/**
 * The schema after DDL script `Q`, from a fresh `DdlCache` entry: the error, or the step's
 * effect (`s`: keys set, `x`: keys removed) applied to `DB`. `never` on a miss.
 */
export type CachedDdl<DB, Q extends string> =
  IsUnion<Q> extends true ? never
  : OneOf<DdlVariants<Q> extends infer V ? (V extends { readonly d: infer D extends DbSnapshot; readonly r: infer R } ? ([Extract<Stale<DB, D>, R>] extends [never] ? DdlResult<DB, V> : never) : never) : never>;
type DdlVariants<Q extends string> = { [F in keyof DdlCache]: Q extends keyof DdlCache[F] ? DdlCache[F][Q] : never }[keyof DdlCache];
type DdlResult<DB, V> =
  V extends { readonly e: infer E } ? E
  : V extends { readonly s: infer S; readonly x: infer X } ? ApplyPatch<DB, S, X>
  : never;

/** What a `DdlCache` entry stores for a step that applies: the keys it sets and the keys it removes. */
export type DdlEffect<Before, After> = {
  readonly s: { [K in keyof After as K extends keyof Before ? (Same<Before[K], After[K]> extends true ? never : K) : K]: After[K] };
  readonly x: Exclude<keyof Before, keyof After>;
};
