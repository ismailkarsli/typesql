import type { ArgsOf, ParamsOf, RowOf, Validate } from "./engine/infer.js";
import type { NamedParams, RewriteNamedStr } from "./engine/named.js";
import type { AnyErr, SqlError } from "./engine/errors.js";
import type { CheckCarried, HasDefaultable, InlineMarker, JsonMarker, RewriteInlineStr, Skip, ValueEnc, WithDefaults } from "./engine/inline.js";
import type { HasSlots, JoinedText, MaxParamStr, QuotedIdent, SlotNames, Splice, SpliceCarried, Take, UnionList, UnknownTuple } from "./engine/splice.js";
import type { DefaultTypeMap } from "./type-map/index.js";
import { makeFragment, makeQuery, type CARRIED, type Executor, type Fragment, type Query, type TextType } from "./query.js";
import type { KeyedRow, RowKeys, SqlOptions } from "./row-keys.js";
import { joinFragments, maxParam, quoteIdent, rewriteNamedOnce, splice, type Spliceable } from "./runtime/splice.js";
import { hasInline, param, resolveInline, takeValue } from "./runtime/inline.js";
import { json } from "./runtime/json.js";
import { buildSet, buildValues } from "./runtime/write.js";
import type { InsertInput, NoExtraKeys, RelationName, SetInput, SetRep, TableName, ValuesRep } from "./engine/write.js";
import type { CallEntry, FreshVariants, IsUnion, OneOf, QueryCacheKeys, Same, Second } from "./engine/cache.js";

/**
 * `Parts` when every part is a literal (or a union of literals). A generic part leaves this
 * unresolved, which fails the first `sql.id` overload so the later ones apply.
 */
type LiteralParts<Parts extends readonly string[]> = { readonly [I in keyof Parts]: string extends Parts[I] ? never : {} extends Record<Parts[I], 1> ? never : Parts[I] };

/** Fragments accepted in a slot object: fragments or whole queries (subqueries). */
export type Slottable = Fragment<string, readonly unknown[], readonly unknown[]> | Query<unknown, readonly unknown[], string>;
export type SlotMap = { readonly [name: string]: Slottable };

/** Slot object required by a query literal: one fragment per `{name}`. */
export type SlotsFor<Q extends string, S> = { readonly [K in SlotNames<Q>]: K extends keyof S ? S[K] : Slottable };

/** Texts of the slot fragments, as literals when known. */
type SlotTexts<S> = { readonly [K in keyof S]: { readonly text: TextType<S[K]> } };

/**
 * Encoded value types a fragment carries, one per `$n`. Queries spliced as subqueries carry
 * none (their values were checked by their own `sql()` call); untyped fragments carry none.
 */
type CarriedOf<F> =
  F extends { readonly [CARRIED]?: infer C }
    ? C extends readonly unknown[] ? (number extends C["length"] ? Skip<MaxParamStr<TextType<F>>> : C) : Skip<MaxParamStr<TextType<F>>>
    : Skip<MaxParamStr<TextType<F>>>;
type SlotCarried<S> = { readonly [K in keyof S]: CarriedOf<S[K]> };

// ───────────────────────────── call-site text processing ─────────────────────────────

/** A plain string literal (or a union of them); `string` and template types with holes are not. */
type IsLiteral<Q extends string> = string extends Q ? false : {} extends Record<Q, 1> ? false : true;

/**
 * Error for non-literal SQL text. Written out at each use (not through an alias) so the
 * editor shows the message rather than an alias name.
 */
type NotLiteralMessage = "the SQL text is not a string literal: pass values as parameters ($1, :name or ${sql.param(value)}), identifiers with sql.id(), reusable pieces as {slot} fragments, or use sql.as<Row>() for dynamic SQL";

/**
 * `:name` → `$k` (first appearance), then `${sql.param(v)}` markers → `$k` after those.
 * `[text, names, inlineEncodings, count]` where `count` is the number of parameters supplied
 * as call arguments (`$n` max or distinct names), or an SqlError.
 */
type Prepared<Q extends string> =
  RewriteNamedStr<Q> extends [infer T1 extends string, infer Names extends string[]]
    ? Names extends []
      ? WithInline<T1, Names, MaxParamStr<T1>>
      : MaxParamStr<Q> extends 0 ? WithInline<T1, Names, Names["length"]> : SqlError<"cannot mix named (:name) and positional ($n) parameters", null>
    : never;
type WithInline<T1 extends string, Names extends string[], M extends number> =
  RewriteInlineStr<T1, M> extends infer R
    ? R extends [infer T2 extends string, infer Encs extends string[]] ? [T2, Names, Encs, M] : R
    : never;

/** The positional text of a call (what is validated and sent). */
type PText<Q extends string> = Prepared<Q> extends [infer X extends string, ...unknown[]] ? X : Q;

/** Arguments after the query (or after the slots): positional values or one `:name` object. */
type ArgsFor<DB, TM, X extends string, Names extends string[], Encs extends readonly unknown[], M extends number> =
  Names extends []
    ? Encs extends readonly [] ? ArgsOf<DB, TM, X> : Take<ArgsOf<DB, TM, X>, M>
    : [params: NamedParams<Names, Take<ArgsOf<DB, TM, X>, Names["length"]>>];

/** `true` when the call is valid; otherwise the SqlError (so it lands on the query literal). */
type CallCheck<DB, TM, Q extends string> =
  IsLiteral<Q> extends false ? SqlError<NotLiteralMessage, 0>
  : HasSlots<Q> extends true ? never
  : Prepared<Q> extends infer P
    ? P extends [infer X extends string, string[], infer Encs extends readonly string[], infer M extends number]
      ? Validate<DB, X> extends infer V
        ? V extends AnyErr ? V : Carried<DB, TM, X, [...Skip<M>, ...Encs]> extends infer K ? (K extends AnyErr ? K : DefaultsCheck<DB, Q, null>) : never
        : never
      : P
    : never;
/**
 * Arguments of a call. When the statement does not validate (or has slots), this signature
 * takes none, and the slotted signature takes any (`SlottedArgs`): with arguments, TypeScript
 * then rejects this one on arity and reports the slotted signature's error, which is the
 * SqlError on the query text. (An incomplete parameter tuple on both would surface as
 * "Expected 2 arguments, but got 3" and hide the SqlError.)
 */
type CallArgs<DB, TM, Q extends string> =
  IsLiteral<Q> extends false ? []
  : HasSlots<Q> extends true ? []
  : Prepared<Q> extends [infer X extends string, infer Names extends string[], infer Encs extends readonly string[], infer M extends number]
    ? Validate<DB, X> extends AnyErr ? [] : ArgsFor<DB, TM, X, Names, Encs, M>
    : [];

/** `true` when every carried value type fits its parameter, else the SqlError. */
type Carried<DB, TM, X extends string, K extends readonly unknown[]> =
  K extends readonly null[] ? true : CheckCarried<DB, TM, X, K>;

/**
 * `sql.param(v)` with a value that can be `undefined`: the statement is checked again
 * with `DEFAULT` in place of every such marker (one extra analysis, not one per marker: each
 * position allows `DEFAULT` or not on its own). `S` is the slot object, `null` without slots.
 */
type DefaultsCheck<DB, Q extends string, S> =
  HasDefaultable<Q> extends false ? true
  : PText<WithDefaults<Q>> extends infer X extends string
    ? (S extends null ? X : Splice<X, SlotTexts<S>>) extends infer X2 extends string
      ? Extract<Validate<DB, X2>, AnyErr> extends infer E ? ([E] extends [never] ? true : DefaultErr<E>) : never
      : true
    : true;

type DefaultErr<E> = E extends SqlError<infer Msg extends string, infer At> ? SqlError<`${Msg} (sql.param() sends DEFAULT for undefined)`, At> : E;

/**
 * Checks return `true` or an SqlError per member of a union text (a fragment whose text is a
 * union of literals), so the results are a union. Any error wins; then `unknown` (valid) or
 * `never` (wrong overload).
 */
type Surface<R> = [Extract<R, AnyErr>] extends [never] ? ([R] extends [never] ? never : unknown) : Extract<R, AnyErr>;

// ─── with slots ───

/** The fully spliced literal (or an SqlError / `string` for dynamic fragments). */
export type SplicedText<Q extends string, S> = Splice<PText<Q>, SlotTexts<S>>;

type SlottedCheck<DB, TM, Q extends string, S> =
  IsLiteral<Q> extends false ? SqlError<NotLiteralMessage, 0>
  : Prepared<Q> extends infer P
    ? P extends [infer T2 extends string, string[], infer Encs extends readonly string[], infer M extends number]
      ? Splice<T2, SlotTexts<S>> extends infer X
        ? X extends string
          ? string extends X ? SqlError<"dynamic SQL fragment: the statement text is not a literal; use sql.as<Row>() to assert the row type", null>
          : Validate<DB, X> extends infer V
            ? V extends AnyErr ? V
            : Carried<DB, TM, X, [...Skip<M>, ...Encs, ...SpliceCarried<T2, SlotCarried<S>>]> extends infer K ? (K extends AnyErr ? K : DefaultsCheck<DB, Q, S>) : never
            : never
          : X
        : never
      : P
    : never;
type SlottedArgs<DB, TM, Q extends string, S> =
  IsLiteral<Q> extends false ? readonly unknown[]
  : Prepared<Q> extends [infer T2 extends string, infer Names extends string[], readonly unknown[], infer M extends number]
    ? Splice<T2, SlotTexts<S>> extends infer X extends string
      ? string extends X ? readonly unknown[]
      : Validate<DB, X> extends AnyErr ? readonly unknown[]
      : Names extends [] ? Take<ArgsOf<DB, TM, X>, M> : [params: NamedParams<Names, Take<ArgsOf<DB, TM, X>, Names["length"]>>]
      : readonly unknown[]
    : readonly unknown[];
type SplicedOr<Q extends string, S> = SplicedText<Q, S> extends infer X extends string ? X : string;

// ─── fragments ───

/**
 * A fragment is checked where it is spliced, with `$k` for its values, so a `sql.param()` that
 * can be `undefined` (sent as `DEFAULT`) could not be checked for `DEFAULT` there: refused.
 */
type FragCheck<Text extends string, Slotted extends boolean> =
  IsLiteral<Text> extends false ? SqlError<NotLiteralMessage, 0>
  : HasSlots<Text> extends Slotted
    ? Prepared<Text> extends infer P
      ? P extends AnyErr ? P
      : HasDefaultable<Text> extends true ? SqlError<"a sql.param() value that can be undefined is sent as DEFAULT, which a fragment cannot check; narrow it, or pass value ?? null", null>
      : true
      : never
    : never;
/**
 * Arguments to `sql.fragment`: positional values for its `$n`, or one `:name` object. Applied as
 * `...params: A & BoxFragArgs<Text>` with `A` unconstrained: a constraint that goes through
 * `Prepared` cannot be resolved during inference, and TS would replace `A` by the constraint.
 */
type FragArgs<Text extends string> =
  Prepared<Text> extends [string, infer Names extends string[], readonly unknown[], infer M extends number]
    ? Names extends [] ? UnknownTuple<M> : [params: { readonly [K in Names[number]]: unknown }]
    : readonly unknown[];
type FragCount<Text extends string> =
  Prepared<Text> extends [string, string[], infer Encs extends readonly unknown[], infer M extends number] ? [...UnknownTuple<M>, ...Encs]["length"] : 0;
/** Encoded types of the values a fragment carries: its arguments, then its inline params. */
type FragCarried<Text extends string, A extends readonly unknown[]> =
  Prepared<Text> extends [string, infer Names extends string[], infer Encs extends readonly string[], number]
    ? Names extends [] ? [...EncAll<A>, ...Encs] : [...EncNamed<Names, A[0]>, ...Encs]
    : [];
type EncAll<A extends readonly unknown[]> = { -readonly [I in keyof A]: ValueEnc<A[I]> };
type EncNamed<Names extends string[], O> = { [I in keyof Names]: Names[I] extends keyof O ? ValueEnc<O[Names[I]]> : "*" };
type JoinedCarried<Items extends readonly unknown[], Acc extends readonly unknown[] = []> =
  Items extends readonly [infer H, ...infer R] ? JoinedCarried<R, [...Acc, ...(CarriedOf<H> extends infer C extends readonly unknown[] ? C : [])]> : Acc;

// ─── joins over arrays (dynamic count, typed elements) ───

/**
 * `[text, carried]` for every element type of a list, split per literal text (a fragment whose
 * text is a union of literals contributes one pair per member).
 */
type ElemPairs<F> =
  F extends unknown ? (TextType<F> extends infer T extends string ? (T extends unknown ? readonly [T, CarriedOf<F>] : never) : never) : never;
type AnyDynamic<P> = true extends (P extends readonly [infer T extends string, unknown] ? (IsLiteral<T> extends true ? false : true) : true) ? true : false;
type PairCarried<Ps extends readonly unknown[], Acc extends readonly unknown[] = []> =
  Ps extends readonly [readonly [string, infer C extends readonly unknown[]], ...infer R] ? PairCarried<R, [...Acc, ...C]> : Acc;
type PairTexts<Ps extends readonly unknown[]> = { [I in keyof Ps]: { readonly text: Ps[I] extends readonly [infer T extends string, unknown] ? T : string } };

/**
 * The representative statement piece of `sql.join(items, sep)` over an array: every distinct
 * element once, joined with `Sep` and renumbered, plus the values those elements carry. A
 * statement that is valid with each element present once is valid for any count and order of
 * them in a list position (ORDER BY, SET, VALUES rows, AND chains, …), so one analysis covers
 * every runtime combination. Unknown element types or a dynamic element text make the list
 * dynamic.
 */
export type ListRep<E, Sep extends string> =
  [E] extends [never] ? { readonly text: string; readonly carried: [] }
  : ElemPairs<E> extends infer P
    ? AnyDynamic<P> extends true ? { readonly text: string; readonly carried: [] }
    : UnionList<P> extends infer Ps extends readonly unknown[]
      ? { readonly text: JoinedText<PairTexts<Ps>, Sep>; readonly carried: PairCarried<Ps> }
      : never
    : never;

/**
 * `sql.join(items, sep)`: a tuple keeps the literal text (and the values in order), an array is
 * typed by its representative piece (`ListRep`).
 */
type JoinOf<Items extends readonly Slottable[], Sep extends string> =
  number extends Items["length"]
    ? Fragment<ListRep<Items[number], Sep>["text"], readonly unknown[], ListRep<Items[number], Sep>["carried"]>
    : Fragment<JoinedText<SlotTexts<Items> extends readonly { readonly text: string }[] ? SlotTexts<Items> : never, Sep>, readonly unknown[], JoinedCarried<Items>>;

type GateCallCheck<DB, TM, Keys, Q extends string> =
  [DB, TM, Q] extends [infer D, infer M, infer Q2 extends string]
    ? [Q2] extends [keyof QueryCacheKeys] ? (CallCached<D, M, Keys, Q2> extends infer C ? ([C] extends [never] ? Surface<CallCheck<D, M, Q2>> : C extends CallEntry ? C["g"] : never) : never) : Surface<CallCheck<D, M, Q2>>
    : never;
type GateSlottedCheck<DB, TM, Q extends string, S> =
  [DB, TM, Q, S] extends [infer D, infer M, infer Q2 extends string, infer S2] ? Surface<SlottedCheck<D, M, Q2, S2>> : never;
type GateFragCheck<Text extends string, Slotted extends boolean> =
  [Text, Slotted] extends [infer T2 extends string, infer B extends boolean] ? Surface<FragCheck<T2, B>> : never;
type BoxCallArgs<DB, TM, Keys, Q extends string> =
  Extract<{ [K in Q as `${K}`]: [K] extends [keyof QueryCacheKeys] ? (CallCached<DB, TM, Keys, K> extends infer C ? ([C] extends [never] ? CallArgs<DB, TM, K> : C extends CallEntry ? C["p"] : never) : never) : CallArgs<DB, TM, K> }[`${Q}`], readonly unknown[]>;
type BoxSlottedArgs<DB, TM, Q extends string, S> = Extract<{ [K in Q as `${K}`]: SlottedArgs<DB, TM, K, S> }[`${Q}`], readonly unknown[]>;
type BoxFragArgs<Text extends string> = Extract<{ [K in Text as `${K}`]: FragArgs<K> }[`${Text}`], readonly unknown[]>;

// ─── type cache (engine/cache.ts) ───

/**
 * The cached `sql(Q, …)` call for this `DB`, type map and `rowKeys`, or `never` on a miss. A hit
 * replaces the check, the arguments and the return type below with what they were when the
 * entry was computed, so the call skips the text rewrites and the row and parameter builders.
 */
/** The cached call (`never` on a miss), for a key of `QueryCacheKeys`. Exported for tests. */
export type CallCached<DB, TM, Keys, Q extends string> =
  IsUnion<Q> extends true ? never
  : Second<OneOf<FreshVariants<DB, Q> extends infer V ? (V extends [infer G, { readonly c: infer C extends CallEntry }] ? (C extends unknown ? ([Keys] extends [C["k"]] ? (Same<TM, C["m"]> extends true ? [G, C] : never) : never) : never) : never) : never>>;
/**
 * What the type cache stores for the plain call `sql(Q, …)` (engine/cache.ts `CallEntry`): the
 * query argument's check, the arguments after it and the return type. The cache job's probe file
 * evaluates it in a program without a cache.
 */
export type CallTypes<DB, TM, Keys extends RowKeys, Q extends string> = {
  readonly g: GateCallCheck<DB, TM, Keys, Q>;
  readonly p: BoxCallArgs<DB, TM, Keys, Q>;
  readonly q: CallRet<DB, TM, Keys, Q>;
};

/**
 * Return type of the plain `sql()` call. The cache test sits inside `GateCallCheck`, `BoxCallArgs`
 * and here rather than in wrappers around them, so that without a cache a call costs what it
 * did before.
 */
type CallRet<DB, TM, Keys extends RowKeys, Q extends string> =
  [Q] extends [keyof QueryCacheKeys]
    ? CallCached<DB, TM, Keys, Q> extends infer C ? ([C] extends [never] ? Query<KeyedRow<RowOf<DB, TM, PText<Q>>, Keys>, ParamsOf<DB, TM, PText<Q>>, PText<Q>> : C extends CallEntry ? C["q"] : never) : never
    : Query<KeyedRow<RowOf<DB, TM, PText<Q>>, Keys>, ParamsOf<DB, TM, PText<Q>>, PText<Q>>;

/**
 * The typed SQL function returned by `createSql<DB, TypeMap>()`.
 *
 *   sql("SELECT id FROM users WHERE id = $1", 42)                  → Query<{ id: number }, [number]>
 *   sql("SELECT id FROM users WHERE id = :id", { id: 42 })         → named parameters (rewritten to $n)
 *   sql(`SELECT id FROM users WHERE id = ${sql.param(42)}`)        → inline parameters (rewritten to $n)
 *   sql("SELECT u.id FROM users u {where}", { where }, ...outer)   → fragments spliced before inference
 *
 * On an invalid statement the `query` argument's type becomes `SqlError<"...", position>`,
 * so the compile error lands on the SQL text.
 *
 * `Keys` is the `rowKeys` option: with `"camelCase"` the row types (and the rows) have
 * camelCased keys.
 */
export interface Sql<DB, TM, Keys extends RowKeys = "preserve"> {
  <const Q extends string>(query: GateCallCheck<DB, TM, Keys, Q> & Q, ...params: BoxCallArgs<DB, TM, Keys, Q>): CallRet<DB, TM, Keys, Q>;
  <const Q extends string, const S extends SlotMap>(
    query: GateSlottedCheck<DB, TM, Q, S> & Q,
    slots: S & SlotsFor<Q, S>,
    ...params: BoxSlottedArgs<DB, TM, Q, S>
  ): Query<KeyedRow<RowOf<DB, TM, SplicedOr<Q, S>>, Keys>, ParamsOf<DB, TM, SplicedOr<Q, S>>, SplicedOr<Q, S>>;

  /**
   * Escape hatch: bypass inference and assert the row type. Accepts slots, `:name` and inline
   * params like the main call. `Row` is the row as returned, so with `rowKeys: "camelCase"` it
   * has camelCase keys.
   */
  as<Row>(query: string, ...params: readonly unknown[]): Query<Row, readonly unknown[]>;
  as<Row>(query: string, slots: SlotMap, ...params: readonly unknown[]): Query<Row, readonly unknown[]>;

  /**
   * Bind a value inline: `` sql(`… WHERE id = ${sql.param(userId)}`) ``. The value becomes a
   * `$n` parameter (never text) and its type is checked against the parameter's context.
   * `undefined` is sent as `DEFAULT`: `` VALUES (${sql.param(email)}, ${sql.param(mood)}) ``.
   * When the value can be `undefined`, the statement must also be valid with `DEFAULT` there
   * (a VALUES item or SET value, and not a NOT NULL column without a default), and
   * `sql.fragment` refuses it.
   */
  param<const T>(value: T): InlineMarker<T>;

  /**
   * Bind a JSON value inline: `` sql(`UPDATE t SET data = ${sql.json(value)}`) ``. Sent as JSON
   * text by every driver (a raw JS array would become a Postgres array under node-postgres);
   * only accepted where a json / jsonb value is expected, and checked against a `Json<T>`
   * column's `T`. `null` / `undefined` are SQL NULL.
   */
  json<const T>(value: T): JsonMarker<T>;

  /**
   * A spliceable SQL piece (not validated on its own; its parameters are typed once spliced).
   * `:name` and inline parameters are resolved at creation, so a fragment can be reused; the
   * values' types are checked when the fragment is spliced.
   */
  fragment<const Text extends string, const A extends readonly unknown[]>(text: GateFragCheck<Text, false> & Text, ...params: A & BoxFragArgs<Text>): Fragment<PText<Text>, UnknownTuple<FragCount<Text>>, FragCarried<Text, A>>;
  fragment<const Text extends string, const S extends SlotMap, const A extends readonly unknown[]>(
    text: GateFragCheck<Text, true> & Text,
    slots: S & SlotsFor<Text, S>,
    ...params: A & BoxFragArgs<Text>
  ): Fragment<SplicedOr<Text, S>, readonly unknown[], [...FragCarried<Text, A>, ...SpliceCarried<PText<Text>, SlotCarried<S>>]>;

  /**
   * Quoted identifier fragment: `sql.id("col")` → `"col"`, `sql.id("s", "t")` → `"s"."t"`. A union
   * of literals gives a union of texts, and the statement is checked once per member.
   */
  id<const Parts extends readonly [string, ...string[]]>(...parts: Parts & LiteralParts<Parts>): Fragment<QuotedIdent<Parts>, [], []>;
  /**
   * A generic relation name (`<T extends RelationName<DB>>(t: T) => sql.id(t)`) cannot be read
   * inside the generic function, so it is widened to every table and view: the statement is
   * checked against each and the row type is the union of their rows.
   */
  id(name: RelationName<DB>): Fragment<QuotedIdent<[RelationName<DB>]>, [], []>;
  /** Any other name (`string`, a generic): a dynamic fragment, for `sql.as<Row>()`. */
  id(...parts: readonly [string, ...string[]]): Fragment<string, [], []>;

  /**
   * Join fragments with a separator: `sql.join([a, b], " AND ")`, or a runtime array of
   * fragments whose texts are known, `sql.join(keys.map((k) => SORT[k]))`. A tuple keeps the
   * literal text. For an array the count and order are dynamic, but every element type is a
   * literal, so the statement is still checked: it is validated once with each distinct element
   * present (see `ListRep`). Throws at runtime when there are no items.
   */
  join<const Items extends readonly Slottable[], const Sep extends string = ", ">(items: Items, separator?: Sep): JoinOf<Items, Sep>;

  /**
   * `SET` list from an object: `sql("UPDATE users SET {set} WHERE id = $1", { set: sql.set("users", input) }, id)`.
   * Keys must be columns of `table` and values must fit them; `undefined` values are skipped.
   * Typed with every key of the input type assigned once. Throws at runtime when no value is defined.
   */
  set<const T extends TableName<DB>, const P extends SetInput<DB, TM, T>>(table: T, values: NoExtraKeys<P, SetInput<DB, TM, T>>): Fragment<SetRep<P>["text"], readonly unknown[], SetRep<P>["carried"]>;

  /**
   * Column list and `VALUES` rows from objects: `sql("INSERT INTO users {rows} RETURNING id", { rows: sql.values("users", rows) })`.
   * NOT NULL columns without a default are required; a missing or `undefined` value is `DEFAULT`.
   * Typed with every key of the row types once. Throws at runtime on an empty array.
   */
  values<const T extends TableName<DB>, const R extends readonly InsertInput<DB, TM, T>[]>(
    table: T,
    rows: R & { readonly [I in keyof R]: NoExtraKeys<R[I], InsertInput<DB, TM, T>> },
  ): Fragment<ValuesRep<R[number]>["text"], readonly unknown[], ValuesRep<R[number]>["carried"]>;

  /** Raw, untyped SQL text. Splicing it forces the override path (`sql.as`). */
  raw(text: string): Fragment<string, [], []>;
}

function isSlotMap(v: unknown): v is SlotMap {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  for (const x of Object.values(v as Record<string, unknown>)) {
    if (x === null || typeof x !== "object" || typeof (x as Spliceable).text !== "string" || !Array.isArray((x as Spliceable).values)) return false;
  }
  return true;
}

const SLOT_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/;
const NAMED_RE = /(^|[^:]):[A-Za-z_]/;

/**
 * Same order as the types: `:name` → `$1..$k`, inline params → `$k+1…`, then fragments are
 * spliced with their parameters renumbered after those.
 */
function build(text: string, rest: readonly unknown[]): { text: string; values: unknown[] } {
  let slots: SlotMap | null = null;
  let outer: readonly unknown[] = rest;
  if (SLOT_RE.test(text) && rest.length > 0 && isSlotMap(rest[0])) {
    slots = rest[0];
    outer = rest.slice(1);
  }
  let positional = text;
  let values: unknown[] = outer.map(takeValue);
  if (NAMED_RE.test(text)) {
    const rn = rewriteNamedOnce(text);
    if (rn.names.length > 0) {
      const obj = outer[0];
      if (outer.length !== 1 || obj === null || typeof obj !== "object") {
        throw new Error("typesql: a statement with :name parameters takes exactly one object argument");
      }
      const record = obj as Record<string, unknown>;
      values = rn.names.map((n) => {
        if (!(n in record)) throw new Error(`typesql: missing named parameter :${n}`);
        return takeValue(record[n]);
      });
      positional = rn.text;
    }
  }
  if (hasInline(positional)) {
    const r = resolveInline(positional, Math.max(maxParam(positional), values.length));
    positional = r.text;
    values = [...values, ...r.values];
  }
  return slots ? splice(positional, slots, values) : { text: positional, values };
}

/**
 * `executor`, when given, is what the queries' `execute*` methods run on by default.
 * `{ rowKeys: "camelCase" }` camelCases the top-level keys of every row, in the row types and in
 * the rows `execute*` return (see `CamelCase`); values, JSON included, are not touched.
 */
export function createSql<DB, TM = DefaultTypeMap>(executor: Executor | undefined, options: SqlOptions & { readonly rowKeys: "camelCase" }): Sql<DB, TM, "camelCase">;
export function createSql<DB, TM = DefaultTypeMap>(executor?: Executor, options?: SqlOptions & { readonly rowKeys?: "preserve" }): Sql<DB, TM>;
export function createSql<DB, TM = DefaultTypeMap>(executor?: Executor, options?: SqlOptions): Sql<DB, TM, RowKeys> {
  const rowKeys = options?.rowKeys ?? "preserve";
  const call = (query: string, ...rest: readonly unknown[]) => {
    const { text, values } = build(query, rest);
    return makeQuery(text, values, executor, rowKeys);
  };
  const api = Object.assign(call, {
    as: (query: string, ...rest: readonly unknown[]) => {
      const { text, values } = build(query, rest);
      return makeQuery(text, values, executor, rowKeys);
    },
    param,
    json,
    fragment: (text: string, ...rest: readonly unknown[]) => {
      const r = build(text, rest);
      return makeFragment(r.text, r.values);
    },
    id: (...parts: readonly string[]) => makeFragment(quoteIdent(...parts), []),
    join: (items: readonly Spliceable[], separator: string = ", ") => {
      if (items.length === 0) throw new Error("typesql: sql.join() needs at least one item; put a fixed element first (`[base, ...rest]`) or skip the clause");
      const r = joinFragments(items, separator);
      return makeFragment(r.text, r.values);
    },
    set: (_table: string, values: Readonly<Record<string, unknown>>) => {
      const r = buildSet(values);
      return makeFragment(r.text, r.values);
    },
    values: (_table: string, rows: readonly Readonly<Record<string, unknown>>[]) => {
      const r = buildValues(rows);
      return makeFragment(r.text, r.values);
    },
    raw: (text: string) => {
      const r = build(text, []);
      return makeFragment(r.text, r.values);
    },
  });
  return api as unknown as Sql<DB, TM, RowKeys>;
}
