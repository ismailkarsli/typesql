import type { SqlError } from "./errors.js";
import type { Next } from "./lexer/next.js";
import type { Lex } from "./lexer/lex.js";
import type { Toks } from "./lexer/tokens.js";
import type { Analysis, ParamsOf } from "./infer.js";
import type { MaxParamStr } from "./splice.js";
import type { StripShape } from "./shape.js";

/**
 * Inline parameters: `` sql(`… WHERE id = ${sql.param(userId)}`) ``.
 *
 * `sql.param(v)` has the literal type `InlineMarker<T>`: NUL, "P", an encoding of the
 * value's TS type, NUL (or a `DefaultMarker` when the value can be `undefined`). (NUL never
 * occurs in valid SQL text, so markers cannot collide with anything the user wrote.) At the
 * call site the markers are rewritten to `$k` (numbered after the statement's own `$n` /
 * `:name` parameters), and each encoded value type is checked against the type the
 * statement's context gives that parameter.
 *
 * At runtime `sql.param(v)` returns an unforgeable token that `sql()` replaces the same way.
 * An `any` or `unknown` value is not checked, so it gets the plain marker.
 */
export type InlineMarker<T> =
  unknown extends T ? PlainMarker<T>
  : undefined extends T ? DefaultMarker<T>
  : PlainMarker<T>;
type PlainMarker<T> = `\u0000P${Enc<T>}\u0000`;
/** Marker of `sql.json(value)`: an inline parameter flagged as JSON (`J`) before the value's encoding. */
export type JsonMarker<T> = `\u0000PJ${Enc<T>}\u0000`;
/**
 * Any `sql.json()` value. Where a value is passed rather than spliced into the text (`sql.set`
 * and `sql.values` values, positional and named arguments), a json / jsonb parameter accepts
 * one; it carries its value's encoding (`ValueEnc`), which is checked like an inline one.
 */
export type JsonValue = `\u0000PJ${string}\u0000`;

/**
 * `sql.param(v)` with a value that can be `undefined`, which sends `DEFAULT` instead of a
 * parameter. NUL, "Du", the encoding of the value without `undefined`, NUL. (Two letters, so
 * that a plain marker's closing NUL followed by a "D" in the text is not read as one; no ":",
 * which `:name` rewriting would see.) The statement is typed with `$k` in its place, and
 * checked a second time with `DEFAULT` there (`WithDefaults`).
 */
export type DefaultMarker<T> = `\u0000Du${Enc<Exclude<T, undefined>>}\u0000`;

// ───────────────────────────── value type encoding ─────────────────────────────

/**
 * Encoding of a value's TS type as flags: s string, n number, b boolean, i bigint,
 * 0 null, u undefined, d Date, y Uint8Array (Buffer), o other object, [e] array of e,
 * * any/unknown. Literal types widen (`42` → `n`).
 */
export type Enc<T> =
  0 extends 1 & T ? "*"
  : unknown extends T ? "*"
  : `${Flag<T, string, "s">}${Flag<T, number, "n">}${Flag<T, boolean, "b">}${Flag<T, bigint, "i">}${Flag<T, null, "0">}${Flag<T, undefined, "u">}${Flag<T, Date, "d">}${Flag<T, Uint8Array, "y">}${ArrFlag<T>}${ObjFlag<T>}`;
type Flag<T, U, F extends string> = [Extract<T, U>] extends [never] ? "" : F;
type ArrFlag<T> = [Extract<T, readonly unknown[]>] extends [never] ? "" : `[${Enc<Extract<T, readonly unknown[]>[number]>}]`;
type ObjFlag<T> = [Exclude<Extract<T, object>, Date | Uint8Array | readonly unknown[]>] extends [never] ? "" : "o";

/**
 * Can a value of encoded type `E` be used where the TS type `P` is expected? Each flag needs
 * an overlapping member in `P` (so `string` is accepted for an enum's literal union, any object
 * for a JSON / interval / point column), and `null`/`undefined` need `null` in `P`.
 */
export type CheckEnc<E extends string, P> =
  unknown extends P ? true
  : E extends "" ? true
  : E extends `*${string}` ? true
  : E extends `[${infer R}`
    ? SplitBracket<R, "", []> extends [infer Inner extends string, infer After extends string]
      ? [Extract<P, readonly unknown[]>] extends [never] ? false
      : CheckEnc<Inner, Extract<P, readonly unknown[]>[number]> extends true ? CheckEnc<After, P> : false
      : false
  : E extends `${infer C}${infer R}` ? (FlagOk<C, P> extends true ? CheckEnc<R, P> : false)
  : true;
type FlagOk<C extends string, P> =
  C extends "s" ? Has<P, string>
  : C extends "n" ? Has<P, number>
  : C extends "b" ? Has<P, boolean>
  : C extends "i" ? Has<P, bigint>
  : C extends "0" | "u" ? Has<P, null>
  : C extends "d" ? Has<P, Date>
  : C extends "y" ? Has<P, Uint8Array>
  : C extends "o" ? Has<P, object>
  : true;
type Has<P, U> = [Extract<P, U>] extends [never] ? false : true;

/** `"n0"` → `"number | null"`, `"[s]"` → `"string[]"`. */
export type DescribeEnc<E extends string> = JoinBar<DescParts<E, []>>;
type DescParts<E extends string, Acc extends string[]> =
  E extends "" ? Acc
  : E extends `[${infer R}`
    ? SplitBracket<R, "", []> extends [infer Inner extends string, infer After extends string]
      ? DescParts<After, [...Acc, DescParts<Inner, []> extends [infer One extends string] ? `${One}[]` : `(${DescribeEnc<Inner>})[]`]>
      : Acc
  : E extends `${infer C}${infer R}` ? DescParts<R, [...Acc, FlagName<C>]>
  : Acc;
type FlagName<C extends string> =
  C extends "s" ? "string" : C extends "n" ? "number" : C extends "b" ? "boolean" : C extends "i" ? "bigint"
  : C extends "0" ? "null" : C extends "u" ? "undefined" : C extends "d" ? "Date" : C extends "y" ? "Uint8Array"
  : C extends "o" ? "object" : "unknown";
type JoinBar<Parts extends string[]> =
  Parts extends [infer A extends string] ? A
  : Parts extends [infer A extends string, ...infer R extends string[]] ? `${A} | ${JoinBar<R>}`
  : "never";

/** Split `inner]rest` at the matching `]`: `[inner, rest]`. */
type SplitBracket<S extends string, Acc extends string, Depth extends unknown[]> =
  S extends `${infer C}${infer R}`
    ? C extends "]" ? (Depth extends [unknown, ...infer D] ? SplitBracket<R, `${Acc}]`, D> : [Acc, R])
    : C extends "[" ? SplitBracket<R, `${Acc}[`, [...Depth, 0]>
    : SplitBracket<R, `${Acc}${C}`, Depth>
    : null;

// ───────────────────────────── text segmentation ─────────────────────────────

type Openers = "'" | '"' | "--" | "/*";

/**
 * `[code, opener, rest]`: the code before the first quote or comment opener ("" when none).
 * Split at the first `'` (the usual opener) and keep it when no other opener comes before;
 * a text without `'` is tested for any opener once. Trying each opener in turn cost 79
 * instantiations on a text without openers and 34 with one `'` (now 16 and 17).
 */
export type SplitFirst<T extends string> =
  T extends `${infer A}'${infer B}`
    ? (A extends `${string}${Openers}${string}` ? Earlier<A, "'", B> : [A, "'", B])
    : T extends `${string}${Openers}${string}`
      ? (T extends `${infer A}"${infer B}` ? Earlier<A, '"', B>
        : T extends `${infer A}--${infer B}` ? Earlier<A, "--", B>
        : T extends `${infer A}/*${infer B}` ? Earlier<A, "/*", B>
        : [T, "", ""])
      : [T, "", ""];
/** `[A, O, B]` split at opener `O`, or at an opener inside `A` (which comes earlier). */
type Earlier<A extends string, O extends string, B extends string> =
  A extends `${infer A2}"${infer M}` ? Earlier<A2, '"', `${M}${O}${B}`>
  : A extends `${infer A2}--${infer M}` ? Earlier<A2, "--", `${M}${O}${B}`>
  : A extends `${infer A2}/*${infer M}` ? Earlier<A2, "/*", `${M}${O}${B}`>
  : A extends `${infer A2}'${infer M}` ? Earlier<A2, "'", `${M}${O}${B}`>
  : [A, O, B];

/** The opaque segment after opener `O`, verbatim including its closer: `[segment, rest]`. */
export type Opaque<O extends string, S extends string> =
  O extends "'" | '"' ? CloseQuote<S, O, "">
  : O extends "--" ? (S extends `${infer C}\n${infer R}` ? [`${C}\n`, R] : [S, ""])
  : O extends "/*" ? (S extends `${infer C}*/${infer R}` ? [`${C}*/`, R] : [S, ""])
  : ["", S];
type CloseQuote<S extends string, Q extends string, Acc extends string> =
  S extends `${infer In}${Q}${infer R}`
    ? R extends `${Q}${infer R2}` ? CloseQuote<R2, Q, `${Acc}${In}${Q}${Q}`> : [`${Acc}${In}${Q}`, R]
    : [`${Acc}${S}`, ""];

type HasMarker<S extends string> = S extends `${string}\u0000${string}` ? true : false;

// ───────────────────────────── marker rewriting ─────────────────────────────

/**
 * Rewrite inline markers to `$k`, numbering from `Start + 1` in order of appearance.
 * Result: `[text, encodings]`, or an SqlError when a marker sits inside a quoted string or a
 * comment (the runtime refuses those too).
 */
export type RewriteInlineStr<T extends string, Start extends number> =
  HasMarker<T> extends false ? [T, []] : InlineLoop<T, "", [], Next[Start]>;

type InlineLoop<T extends string, Acc extends string, Encs extends string[], K extends number> =
  SplitFirst<T> extends [infer Code extends string, infer O extends string, infer Rest extends string]
    ? InlineCode<Code, "", Encs, K> extends [infer C extends string, infer E2 extends string[], infer K2 extends number]
      ? O extends "" ? [`${Acc}${C}`, E2]
      : Opaque<O, Rest> extends [infer Seg extends string, infer After extends string]
        ? HasMarker<Seg> extends true
          ? SqlError<`sql.param() cannot be used inside ${O extends "'" ? "a quoted string" : O extends '"' ? "a quoted identifier" : "a comment"}; remove the surrounding ${O extends "'" | '"' ? "quotes" : "comment"}`, null>
          : InlineLoop<After, `${Acc}${C}${O}${Seg}`, E2, K2>
        : never
      : never
    : never;

type InlineCode<S extends string, Acc extends string, Encs extends string[], K extends number> =
  S extends `${infer Pre}\u0000${infer Body}\u0000${infer Rest}`
    ? InlineCode<Rest, `${Acc}${Pre}$${K}`, [...Encs, MarkerEnc<Body>], Next[K]>
    : [`${Acc}${S}`, Encs, K];
/** Encoded value type of a marker body: `P<enc>`, or `Du<enc>` for a value that can be `undefined`. */
type MarkerEnc<B extends string> = B extends `P${infer E}` ? E : B extends `Du${infer E}` ? E : "*";

type AnyMarker = `\u0000${string}\u0000`;
/**
 * Encoding of a value passed as a value (a `sql.set` / `sql.values` value, a fragment argument):
 * `Enc<V>`, except that a marker (`sql.json()`, `sql.param()`) stands
 * for the value it wraps, which the runtime unwraps. A union with markers gives a union of
 * encodings, each checked.
 */
export type ValueEnc<V> =
  0 extends 1 & V ? "*"
  : [Extract<V, AnyMarker>] extends [never] ? Enc<V>
  : MarkerEncs<Extract<V, AnyMarker>> | ([Exclude<V, AnyMarker>] extends [never] ? never : Enc<Exclude<V, AnyMarker>>);
type MarkerEncs<M> = M extends `\u0000${infer B}\u0000` ? MarkerEnc<B> : never;

/** Does the text hold a `sql.param()` whose value can be `undefined`? */
export type HasDefaultable<S extends string> = S extends `${string}\u0000Du${string}` ? true : false;

/** The text with every `sql.param()` that can be `undefined` replaced by `DEFAULT`. */
export type WithDefaults<S extends string, Acc extends string = ""> =
  S extends `${infer Pre}\u0000Du${string}\u0000${infer Rest}` ? WithDefaults<Rest, `${Acc}${Pre}DEFAULT`> : `${Acc}${S}`;

// ───────────────────────────── value checks ─────────────────────────────

/**
 * Check carried value types against a statement's parameter types. `K[i]` is the encoding of
 * the value bound to `$i+1`, or `null` when that value is passed as a call argument (checked by
 * the call signature). Result: `true` or an SqlError naming the parameter.
 */
export type CheckCarried<DB, TM, X extends string, K extends readonly unknown[]> =
  K extends readonly [] ? true
  : number extends K["length"] ? true
  : CarriedLoop<DB, X, K, ParamsOf<DB, TM, X>, 0>;

type CarriedLoop<DB, X extends string, K extends readonly unknown[], P extends readonly unknown[], I extends number> =
  I extends K["length"] ? true
  : K[I] extends infer E extends string
    ? Extract<CheckValue<DB, X, Next[I], E, P[I]>, string> extends infer M extends string
      ? [M] extends [never] ? CarriedLoop<DB, X, K, P, Next[I]> : SqlError<`parameter $${Next[I]}: ${M}`, FindParam<Lex<X>, Next[I], 0>>
      : CarriedLoop<DB, X, K, P, Next[I]>
    : CarriedLoop<DB, X, K, P, Next[I]>;

/**
 * `true`, or what is wrong with the value of encoding `E` for parameter `N` (TS type `P`):
 *   - a `sql.json()` value (`J…`) needs a json / jsonb parameter (or one with no context);
 *   - a `sql.param()` array for a json / jsonb parameter is refused: node-postgres would send a
 *     Postgres array literal, so JSON goes through `sql.json()`.
 */
type CheckValue<DB, X extends string, N extends number, E extends string, P> =
  E extends `J${infer R}`
    ? JsonContext<ParamUses<DB, X, N>> extends false ? `a sql.json() value cannot be used as ${Expected<DB, X, N>}`
    : CheckEnc<R, P> extends true ? true
    : `a sql.json() ${DescribeEnc<R>} value cannot be used as ${Expected<DB, X, N>}`
  : CheckEnc<E, P> extends true
    ? E extends `${string}[${string}` ? (IsJsonParam<ParamUses<DB, X, N>> extends true ? `an array for ${Expected<DB, X, N>} must be passed as sql.json(value) (node-postgres sends a JS array as a Postgres array)` : true) : true
  : `a ${DescribeEnc<E>} value cannot be used as ${Expected<DB, X, N>}`;

/** The `ColInfo`s the statement's uses give parameter `N` (never when it has none). */
type ParamUses<DB, X extends string, N extends number> =
  Analysis<DB, X> extends { readonly params: infer M } ? (N extends keyof M ? Exclude<M[N], { readonly nullTest: true }> : never) : never;
type IsJsonParam<U> = [Extract<U, { readonly type: "json" | "jsonb" }>] extends [never] ? false : true;
/** A json / jsonb use, or no typed use at all. */
type JsonContext<U> = [U] extends [never] ? true : [Extract<U, { readonly type: "json" | "jsonb" | "unknown" }>] extends [never] ? false : true;

/** `"text NOT NULL"` / `"int4"` for parameter `N` of statement `X`. */
type Expected<DB, X extends string, N extends number> =
  Analysis<DB, X> extends { readonly params: infer M }
    ? N extends keyof M
      ? First<M[N]> extends { readonly type: infer T extends string; readonly nullable: infer Nl }
        ? `${StripShape<T>}${Nl extends true ? "" : " NOT NULL"}`
        : "this parameter"
      : "this parameter"
    : "this parameter";
type First<U> = (U extends unknown ? (u: () => U) => void : never) extends (u: infer F) => void ? (F extends () => infer R ? R : never) : never;

type FindParam<T, N extends number, I extends number> =
  T extends Toks
    ? T[I] extends { readonly k: "$"; readonly v: N } ? I
    : T[I] extends { readonly k: string } ? FindParam<T, N, Next[I]>
    : 0
    : 0;

/** `null` × N: positions whose values are call arguments. */
export type Skip<N extends number, Acc extends null[] = []> = Acc["length"] extends N ? Acc : Skip<N, [...Acc, null]>;

export type { MaxParamStr };
