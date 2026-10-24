import type { ColDesc, Table, View } from "../schema/column.js";
import type { TsParamTypeOf } from "../type-map/index.js";
import type { JsonValue, ValueEnc } from "./inline.js";
import type { JoinedText, QuotedIdent, UnionList } from "./splice.js";

/**
 * Types of the write helpers `sql.set(table, values)` and `sql.values(table, rows)`.
 *
 * Their runtime text depends on which keys are defined, so, like `sql.join` over an array, they
 * are typed with a representative text: every key of the input type once (`"a" = $1, "b" = $2`
 * / `("a", "b") VALUES ($1, $2)`), carrying the encoded value types. The statement they are
 * spliced into is checked with that text, so the columns are checked again in context.
 */

type IsTable<X> = X extends View<Table> ? false : X extends Table ? true : false;

/**
 * Writable tables of a schema: top-level tables, and `"schema.table"` for tables in a
 * namespace. Views, `$types` and namespaces themselves are not included.
 */
export type TableName<DB> =
  | { [K in keyof DB & string]: K extends "$types" ? never : IsTable<DB[K]> extends true ? K : never }[keyof DB & string]
  | { [NS in keyof DB & string]: NS extends "$types" ? never : IsTable<DB[NS]> extends true ? never : DB[NS] extends View<Table> ? never : NsTables<NS, DB[NS]> }[keyof DB & string];
type NsTables<NS extends string, N> = { [K in keyof N & string]: IsTable<N[K]> extends true ? `${NS}.${K}` : never }[keyof N & string];

/** Top-level tables and views of a schema (what an unqualified `FROM name` can read). */
export type RelationName<DB> =
  { [K in keyof DB & string]: K extends "$types" ? never : DB[K] extends View<Table> ? K : IsTable<DB[K]> extends true ? K : never }[keyof DB & string];

/** The column descriptors of a `TableName`. */
export type TableOf<DB, T extends string> =
  T extends keyof DB ? (DB[T] extends Table ? DB[T] : never)
  : T extends `${infer NS}.${infer N}` ? (NS extends keyof DB ? (N extends keyof DB[NS] ? (DB[NS][N] extends Table ? DB[NS][N] : never) : never) : never)
  : never;

/**
 * TS type a column accepts when written (the type map's parameter type, `| null` when nullable).
 * A json / jsonb column also takes a `sql.json(value)` (an array has to be one: see `CheckValue`).
 */
export type ColIn<TM, DB, D extends ColDesc> =
  D["type"] extends "null" ? null
  : (D["nullable"] extends true ? TsParamTypeOf<TM, DB, D["type"]> | null : TsParamTypeOf<TM, DB, D["type"]>) | (D["type"] extends "json" | "jsonb" ? JsonValue : never);

/** `sql.set` input: any subset of the columns; `undefined` values are skipped. */
export type SetInput<DB, TM, T extends string> =
  TableOf<DB, T> extends infer Tbl extends Table ? { readonly [K in keyof Tbl]?: ColIn<TM, DB, Tbl[K]> | undefined } : never;

type Required_<Tbl extends Table> = { [K in keyof Tbl]: Tbl[K] extends { readonly nullable: false; readonly hasDefault: false } ? K : never }[keyof Tbl];

/**
 * `sql.values` row: NOT NULL columns without a default are required; the others are optional
 * (`undefined` or a missing key sends `DEFAULT`).
 */
export type InsertInput<DB, TM, T extends string> =
  TableOf<DB, T> extends infer Tbl extends Table
    ? Flat<{ readonly [K in Required_<Tbl>]: ColIn<TM, DB, Tbl[K]> } & { readonly [K in Exclude<keyof Tbl, Required_<Tbl>>]?: ColIn<TM, DB, Tbl[K]> | undefined }>
    : never;
type Flat<O> = { [K in keyof O]: O[K] };

/** Keys of `P` that are not in `Allowed`, mapped to `never` (so each one is an error on its property). */
export type NoExtraKeys<P, Allowed> = P & { readonly [K in Exclude<keyof P, keyof Allowed>]: never };

/** Every key of every member of a union of row types. */
type KeysOf<R> = R extends unknown ? keyof R & string : never;
/** Union of the value types `K` has across the members of `R` (members without `K` add nothing). */
type ValueAt<R, K extends string> = R extends unknown ? (K extends keyof R ? R[K] : never) : never;
type CarriedOfKeys<R, Ks extends readonly unknown[], Acc extends readonly unknown[] = []> =
  Ks extends readonly [infer K extends string, ...infer Rest] ? CarriedOfKeys<R, Rest, [...Acc, ValueEnc<Exclude<ValueAt<R, K>, undefined>>]> : Acc;

type Assignments<Ks extends readonly unknown[]> = { [I in keyof Ks]: { readonly text: `${QuotedIdent<[Ks[I] & string]>} = $1` } };
type Placeholders<Ks extends readonly unknown[]> = { [I in keyof Ks]: { readonly text: "$1" } };
type Names<Ks extends readonly unknown[]> = { [I in keyof Ks]: { readonly text: QuotedIdent<[Ks[I] & string]> } };

/** Representative of `sql.set(table, values)`: `"a" = $1, "b" = $2` over the keys of `P`. */
export type SetRep<P> =
  UnionList<KeysOf<P>> extends infer Ks extends readonly unknown[]
    ? { readonly text: JoinedText<Assignments<Ks>, ", ">; readonly carried: CarriedOfKeys<P, Ks> }
    : never;

/**
 * Representative of `sql.values(table, rows)`: `("a", "b") VALUES ($1, $2)` over the keys of
 * every row type, or `DEFAULT VALUES` when the rows have no keys.
 */
export type ValuesRep<R> =
  UnionList<KeysOf<R>> extends infer Ks extends readonly unknown[]
    ? Ks extends readonly []
      ? { readonly text: "DEFAULT VALUES"; readonly carried: [] }
      : { readonly text: `(${JoinedText<Names<Ks>, ", ">}) VALUES (${JoinedText<Placeholders<Ks>, ", ">})`; readonly carried: CarriedOfKeys<R, Ks> }
    : never;
