import type { View } from "@typesql/core";
import type { ColDesc, PgScalarName } from "@typesql/core/engine";

/**
 * Converting a Kysely `DB` interface (kysely-codegen, prisma-kysely or hand-written) into a
 * TypeSQL schema. Kysely describes columns with TS types, TypeSQL with Postgres type names, so
 * the conversion reads the TS shape back into a type name. That is lossy (`number` may be
 * `int4` or `float8`); `Overrides` pins the exact type per column.
 *
 * Every alias here is flat: one mapped type per table and a fixed number of conditionals per
 * column, with no recursion over the schema (only `SnakeCase` recurses, per identifier, when
 * `camelCase` is on).
 */

// ───────────────────────────── public types ─────────────────────────────

/**
 * Per-column override: a Postgres type name (`"int8"`, `"uuid"`, `"mood"`, `"text[]"`), or a
 * partial descriptor (`{ type?: "float8"; nullable?: false; hasDefault?: true }`). Unset
 * fields keep the inferred value.
 */
export type ColumnOverride = string | Partial<ColDesc>;

/** Overrides for one table: column key → `ColumnOverride`, plus `$view: true` for a view. */
export type TableOverride = { readonly [column: string]: ColumnOverride | boolean };

/**
 * Overrides for `FromKysely`, keyed by the `DB` interface's own table keys (`"auth.users"`,
 * `users`) and column keys (as spelled in the interface, before any `camelCase` mapping).
 *
 *   {
 *     users: { id: "int8"; score: "float8"; created_at: { type: "timestamp"; hasDefault: false } };
 *     active_users: { $view: true };
 *     $types: { mood: Mood; "auth.role": AuthRole };
 *   }
 *
 * `$view: true` declares a table key as a view (read-only). `$types` names enums: a column whose
 * values are exactly one entry's union gets that entry's name (so the same enum is one type
 * across tables, as in Postgres).
 */
export type KyselyOverrides = { readonly [table: string]: TableOverride };

/**
 * Options for `FromKysely`.
 * - `camelCase: true`: the interface was generated with `kysely-codegen --camel-case` (or is used
 *   with `CamelCasePlugin`); keys are mapped back to snake_case the way `CamelCasePlugin` does by
 *   default (`createdAt` → `created_at`, `userID` → `user_id`). SQL text uses the real names.
 */
export type KyselyOptions = { readonly camelCase?: boolean };

/**
 * A TypeSQL schema from a Kysely `DB` interface.
 *
 *   type Schema = FromKysely<DB, { users: { id: "int8" } }>;
 *   const sql = createSql<Schema>();            // TypeSQL's createSql
 *
 * `"auth.users"` becomes `Schema["auth"]["users"]`; `"public.users"` becomes `Schema["users"]`.
 * String-literal unions become enums registered in `Schema["$types"]` (see `KyselyOverrides`).
 */
export type FromKysely<DB, Overrides extends KyselyOverrides = {}, Options extends KyselyOptions = {}> = {
  -readonly [K in (keyof DB & string) | "$types" as OuterKey<K, Options>]-?: K extends "$types"
    ? EnumRegistry<DB, Overrides, Options>
    : K extends `public.${string}` ? TableOf<DB, K, Overrides, Options>
    : K extends `${infer S}.${string}` ? NamespaceOf<DB, S, Overrides, Options>
    : TableOf<DB, K, Overrides, Options>;
};

/** Kysely's default snake_case mapping (`CamelCasePlugin`'s `createSnakeCaseMapper()`), at the type level. */
export type SnakeCase<S extends string> =
  S extends Lowercase<S> ? S
  : S extends `${infer H}${infer R}` ? SnakeRest<R, IsUpper<H>, Lowercase<H>>
  : S;

/**
 * Postgres type name, nullability and default inferred from one Kysely column type (no
 * overrides; string-literal unions are reported as `"enum"`, or `"enum[]"`).
 */
export type InferColumn<T> = {
  readonly type: PgTypeOf<NonNullable<Sel<T>>, Exclude<Hint<T>, null | undefined>, "enum">;
  readonly nullable: null extends Sel<T> ? true : false;
  readonly hasDefault: HasDefault<T>;
};

// ───────────────────────────── keys and namespaces ─────────────────────────────

type Sn<S extends string, Opt> = Opt extends { readonly camelCase: true } ? SnakeCase<S> : S;

type IsUpper<C extends string> = C extends Lowercase<C> ? false : true;
type SnakeRest<S extends string, PrevUpper extends boolean, Acc extends string> =
  S extends `${infer C}${infer R}`
    ? SnakeRest<R, IsUpper<C>, `${Acc}${IsUpper<C> extends true ? (PrevUpper extends true ? Lowercase<C> : `_${Lowercase<C>}`) : C}`>
    : Acc;

/** Top-level key of a `DB` key: `"auth.users"` → `auth`, `"public.users"` → `users`. */
type OuterKey<K extends string, Opt> =
  K extends "$types" ? K
  : K extends `public.${infer T}` ? Sn<T, Opt>
  : K extends `${infer S}.${string}` ? Sn<S, Opt>
  : Sn<K, Opt>;

/** SQL name of a table key, schema-qualified unless `public`: used to name derived enums. */
type SqlTableName<K extends string, Opt> = K extends `public.${infer T}` ? Sn<T, Opt> : Sn<K, Opt>;

type NamespaceOf<DB, S extends string, O, Opt> = {
  -readonly [K in keyof DB & `${S}.${string}` as K extends `${S}.${infer T}` ? Sn<T, Opt> : never]-?: TableOf<DB, K, O, Opt>;
};

type TableOverrides<O, K> = K extends keyof O ? O[K] : undefined;
type ColumnOverrideOf<TO, C> = C extends keyof TO ? TO[C] : undefined;

/** User enum registry (`Overrides["$types"]`), or `{}`. */
type Registry<O> = O extends { readonly $types: infer R } ? R : {};

type TableOf<DB, K extends string, O, Opt> =
  K extends keyof DB
    ? TableOverrides<O, K> extends { readonly $view: true }
      ? View<Columns<DB[K], TableOverrides<O, K>, SqlTableName<K, Opt>, Registry<O>, Opt>>
      : Columns<DB[K], TableOverrides<O, K>, SqlTableName<K, Opt>, Registry<O>, Opt>
    : never;

type Columns<Tbl, TO, TName extends string, Reg, Opt> = {
  -readonly [C in keyof Tbl & string as Sn<C, Opt>]-?: Column<Tbl[C], ColumnOverrideOf<TO, C>, Reg, `${TName}.${Sn<C, Opt>}`>;
};

// ───────────────────────────── columns ─────────────────────────────

/** Select type of a column: `ColumnType<S, …>` → S (one nested `ColumnType` is unwrapped, e.g. `GeneratedAlways<Int8>`). */
type Sel<T> = T extends { readonly __select__: infer S } ? InnerSel<S> : T;
type InnerSel<S> = S extends { readonly __select__: infer S2 } ? S2 : S;
/** Insert type of the innermost `ColumnType`: tells `Int8`/`Numeric` apart from plain strings. */
type Hint<T> = T extends { readonly __select__: infer S; readonly __insert__: infer I } ? InnerIns<S, I> : T;
type InnerIns<S, I> = S extends { readonly __insert__: infer I2 } ? I2 : I;
/** Outer insert type: `undefined` in it (`Generated`) or `never` (`GeneratedAlways`) means a default. */
type Ins<T> = T extends { readonly __insert__: infer I } ? I : T;

type HasDefault<T> =
  [Extract<T, { readonly __insert__: unknown }>] extends [never] ? false
  : undefined extends Ins<T> ? true
  : [Exclude<Ins<T>, null>] extends [never] ? true
  : false;

/** The string-literal union of an enum column (or of its array elements), else never. */
type LiteralUnion<S> =
  [S] extends [string] ? (string extends S ? never : S)
  : [S] extends [readonly (infer E)[]] ? ([NonNullable<E>] extends [string] ? (string extends NonNullable<E> ? never : NonNullable<E>) : never)
  : never;

/**
 * Postgres type name from a non-null select type `S` and insert hint `H`. `E` is the name to
 * use for a string-literal union (an enum). An array select type is a Postgres array unless
 * the insert type has no array in it: `JSONColumnType<string[]>` inserts as `string`.
 */
type PgTypeOf<S, H, E extends string> =
  unknown extends S ? "jsonb"
  : [S] extends [never] ? "text"
  : [S] extends [readonly (infer El)[]]
    ? IsJsonInsert<H> extends true ? "jsonb" : `${ScalarOf<ArrayElem<NonNullable<El>>, ArrayElem<ArrayElem<H>>, E>}[]`
    : ScalarOf<S, H, E>;

/** Insert type with no array in it (`string`, `RawBuilder`); `never` (`GeneratedAlways`) tells nothing. */
type IsJsonInsert<H> =
  [H] extends [never] ? false
  : [Extract<H, readonly unknown[]>] extends [never] ? true
  : false;

/** Element type of an array (one more level for multi-dimensional arrays: Postgres types them alike). */
type ArrayElem<T> = T extends readonly (infer E)[] ? E : T;

type ScalarOf<S, H, E extends string> =
  unknown extends S ? "jsonb"
  : [S] extends [string] ? (string extends S ? StringKind<H> : E)
  : [S] extends [number] ? "int4"
  : [S] extends [bigint] ? "int8"
  : [S] extends [boolean] ? "bool"
  : [S] extends [Date] ? "timestamptz"
  : [S] extends [Uint8Array] ? "bytea"
  : [S] extends [readonly unknown[]] ? "jsonb"
  : [S] extends [object] ? ObjectKind<S>
  : "jsonb"; // mixed unions such as kysely-codegen's `JsonValue`

/** kysely-codegen selects `int8` and `numeric` as `string`; the insert type tells them apart. */
type StringKind<H> =
  [H] extends [never] ? "text"
  : bigint extends H ? "int8"
  : number extends H ? "numeric"
  : "text";

/** Index signatures (`Record<string, …>`) are jsonb: their `keyof` is `string`, which every key check would match. */
type ObjectKind<S> =
  string extends keyof S ? "jsonb"
  : "days" extends keyof S ? "interval"
  : "radius" extends keyof S ? "circle"
  : "x" | "y" extends keyof S ? "point"
  : "jsonb";

/** Name of a `$types` entry whose union is exactly `U` (when exactly one matches), else `Default`. */
type EnumName<U, Reg, Default extends string> =
  RegistryMatch<U, Reg> extends infer N extends string ? ([N] extends [never] ? Default : IsSingle<N> extends true ? N : Default) : Default;
type RegistryMatch<U, Reg> = {
  [N in keyof Reg & string]: [U] extends [Reg[N]] ? ([Reg[N]] extends [U] ? N : never) : never;
}[keyof Reg & string];
type IsSingle<N, All = N> = N extends unknown ? ([Exclude<All, N>] extends [never] ? true : false) : never;

type OverrideType<V> = V extends string ? V : V extends { readonly type: infer X extends string } ? X : never;

/** Final type name of a column: the override's, else the inferred one. */
type ColumnTypeName<T, V, Reg, Default extends string> =
  [OverrideType<V>] extends [never]
    ? PgTypeOf<NonNullable<Sel<T>>, Exclude<Hint<T>, null | undefined>, EnumName<LiteralUnion<NonNullable<Sel<T>>>, Reg, Default>>
    : OverrideType<V>;

type Column<T, V, Reg, Default extends string> = {
  readonly type: ColumnTypeName<T, V, Reg, Default>;
  readonly nullable: [V] extends [{ readonly nullable: infer B extends boolean }] ? B : null extends Sel<T> ? true : false;
  readonly hasDefault: [V] extends [{ readonly hasDefault: infer B extends boolean }] ? B : HasDefault<T>;
};

// ───────────────────────────── enums ─────────────────────────────

type BaseName<T extends string> = T extends `${infer B}[]` ? B : T;

/** `[name, values]` when a column's type is an enum (not a built-in type) and its values are a literal union. */
type EnumEntry<T, V, Reg, Default extends string> =
  [LiteralUnion<NonNullable<Sel<T>>>] extends [never] ? never
  : BaseName<ColumnTypeName<T, V, Reg, Default>> extends infer N extends string
    ? N extends PgScalarName ? never : [N, LiteralUnion<NonNullable<Sel<T>>>]
    : never;

type TableEnums<Tbl, TO, TName extends string, Reg, Opt> = {
  [C in keyof Tbl & string]-?: EnumEntry<Tbl[C], ColumnOverrideOf<TO, C>, Reg, `${TName}.${Sn<C, Opt>}`>;
}[keyof Tbl & string];

type EnumEntries<DB, O, Opt> =
  | { [N in keyof Registry<O> & string]: [N, Registry<O>[N]] }[keyof Registry<O> & string]
  | { [K in keyof DB & string]-?: TableEnums<DB[K], TableOverrides<O, K>, SqlTableName<K, Opt>, Registry<O>, Opt> }[keyof DB & string];

type EnumRegistry<DB, O, Opt> = {
  [E in EnumEntries<DB, O, Opt> as E[0]]: E[1];
};
