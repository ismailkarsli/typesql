/**
 * Must print exactly what pg-canon.ts prints from PostgreSQL's parse tree of the same statement:
 * change both together.
 */
import type { SqlError } from "../../src/index.js";
import type { Lex, ParseProgram } from "../../src/engine/index.js";
import type { Toks } from "../../src/engine/lexer/tokens.js";

export type Out = "…";

export type Canon<Q extends string> = Lex<Q> extends infer T ? (T extends SqlError<infer M extends string, any> ? `!${M}` : T extends Toks ? CanonParsed<ParseProgram<T>> : "!lexer") : never;
type CanonParsed<S> = S extends SqlError<infer M extends string, any> ? `!${M}` : CanonStmt<S>;

type ExList<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H, ...infer R] ? (ExS<H> extends infer S extends string ? ExList<R, First extends true ? S : `${Acc}, ${S}`, false> : never) : Acc;
type Names<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H extends string, ...infer R] ? Names<R, First extends true ? H : `${Acc}, ${H}`, false> : Acc;
type NameList<L> = L extends readonly [unknown, ...unknown[]] ? `(${Names<L>})` : "";
type Ref<R> = R extends { readonly schema: infer S extends string; readonly name: infer N extends string } ? `${S}.${N}` : R extends { readonly name: infer N extends string } ? N : "?ref";
type NormOp<O> = O extends "!=" ? "<>" : O extends string ? O : "?op";

/**
 * Everything but `Ex` itself reads it through this: a direct reference to `Ex` in a template
 * literal hole or a type argument triggers TS5114 ("appear infinitely circular", engine.md pitfall 9).
 */
type ExS<E> = Ex<E> extends infer S extends string ? S : never;

export type Ex<E> =
  E extends { readonly t: "col"; readonly tbl: infer T; readonly name: infer N extends string } ? (T extends string ? `${T}.${N}` : N)
  : E extends { readonly t: "num"; readonly v: infer V extends string } ? V
  : E extends { readonly t: "str"; readonly v: infer V extends string } ? `'${V}'`
  : E extends { readonly t: "bin"; readonly op: infer Op } ? (Op extends "and" | "or" ? `(${Chain<Leaves<E, Op>, Uppercase<Op>>})` : Spine<E, []>)
  : E extends { readonly t: "call" } ? Call<E>
  : E extends { readonly t: "param"; readonly n: infer N extends number } ? `$${N}`
  : E extends { readonly t: "cast"; readonly e: infer X; readonly to: infer To extends string } ? `(${ExS<X>}::${To})`
  : E extends { readonly t: "null" } ? "NULL"
  : E extends { readonly t: "bool"; readonly v: infer V extends boolean } ? `${V}`
  : E extends { readonly t: "star"; readonly tbl: infer T } ? (T extends string ? `${T}.*` : "*")
  : E extends { readonly t: "is"; readonly e: infer X; readonly what: infer W extends string; readonly not: infer Not } ? `(${ExS<X>} IS ${Not extends true ? "NOT " : ""}${Uppercase<W>})`
  : E extends { readonly t: "un"; readonly op: infer Op; readonly e: infer X } ? (Op extends "not" ? `(NOT ${ExS<X>})` : `(${NormOp<Op>} ${ExS<X>})`)
  : E extends { readonly t: "typed"; readonly type: infer Ty extends string; readonly v: infer V extends string } ? `('${V}'::${Ty})`
  : E extends { readonly t: "case"; readonly operand: infer O; readonly whens: infer Ws; readonly else: infer El } ? `CASE${O extends null ? "" : ` ${ExS<O>}`}${Whens<Ws>}${El extends null ? "" : ` ELSE ${ExS<El>}`} END`
  : E extends { readonly t: "in"; readonly e: infer X; readonly list: infer L; readonly not: infer Not } ? `(${ExS<X>} ${Not extends true ? "NOT IN" : "IN"} (${ExList<L>}))`
  : E extends { readonly t: "insub"; readonly e: infer X; readonly q: infer Q; readonly not: infer Not } ? (Not extends true ? `(NOT (${ExS<X>} IN (${Sel<Q>})))` : `(${ExS<X>} IN (${Sel<Q>}))`)
  : E extends { readonly t: "like"; readonly e: infer X; readonly pat: infer P; readonly kind: infer K; readonly not: infer Not } ? `(${ExS<X>} ${Not extends true ? "NOT " : ""}${K extends "similar" ? "SIMILAR TO" : Uppercase<K & string>} ${ExS<P>})`
  : E extends { readonly t: "between"; readonly e: infer X; readonly lo: infer Lo; readonly hi: infer Hi; readonly not: infer Not } ? `(${ExS<X>} ${Not extends true ? "NOT BETWEEN" : "BETWEEN"} ${ExS<Lo>} AND ${ExS<Hi>})`
  : E extends { readonly t: "isdistinct"; readonly l: infer L; readonly r: infer R; readonly not: infer Not } ? `(${ExS<L>} IS ${Not extends true ? "NOT " : ""}DISTINCT FROM ${ExS<R>})`
  : E extends { readonly t: "quant"; readonly l: infer L; readonly op: infer Op; readonly q: infer Q extends string; readonly r: infer R } ? `(${ExS<L>} ${NormOp<Op>} ${Uppercase<Q>} (${R extends { readonly t: "select" } ? Sel<R> : ExS<R>}))`
  : E extends { readonly t: "sub"; readonly q: infer Q } ? `(${Sel<Q>})`
  : E extends { readonly t: "exists"; readonly q: infer Q } ? `EXISTS(${Sel<Q>})`
  : E extends { readonly t: "array"; readonly items: infer L } ? `ARRAY[${ExList<L>}]`
  : E extends { readonly t: "arraysub"; readonly q: infer Q } ? `ARRAY(${Sel<Q>})`
  : E extends { readonly t: "row"; readonly items: infer L } ? `ROW(${ExList<L>})`
  : E extends { readonly t: "idx"; readonly e: infer X; readonly i: infer I } ? `${ExS<X>}[${ExS<I>}]`
  : E extends { readonly t: "slice"; readonly e: infer X; readonly lo: infer Lo; readonly hi: infer Hi } ? `${ExS<X>}[${Lo extends null ? "" : ExS<Lo>}:${Hi extends null ? "" : ExS<Hi>}]`
  : E extends { readonly t: "field"; readonly e: infer X; readonly name: infer N extends string } ? `(${ExS<X>}).${N}`
  : E extends { readonly t: "collate"; readonly e: infer X; readonly collation: infer C extends string } ? `(${ExS<X>} COLLATE ${C})`
  : E extends { readonly t: "attz"; readonly e: infer X; readonly zone: infer Z } ? `timezone(${ExS<Z>}, ${ExS<X>})`
  : E extends { readonly t: "extract"; readonly field: infer F extends string; readonly e: infer X } ? `extract('${F}', ${ExS<X>})`
  : E extends { readonly t: "position"; readonly sub: infer S; readonly in: infer I } ? `position(${ExS<I>}, ${ExS<S>})`
  : E extends { readonly t: "substring"; readonly e: infer X; readonly from: infer F; readonly for: infer G } ? `substring(${ExS<X>}${F extends null ? (G extends null ? "" : `, 1, ${ExS<G>}`) : `, ${ExS<F>}${G extends null ? "" : `, ${ExS<G>}`}`})`
  : E extends { readonly t: "trim"; readonly e: infer X; readonly chars: infer C; readonly side: infer S } ? `${S extends "leading" ? "ltrim" : S extends "trailing" ? "rtrim" : "btrim"}(${ExS<X>}${C extends null ? "" : `, ${ExS<C>}`})`
  : E extends { readonly t: "overlay"; readonly e: infer X } ? `overlay(${ExS<X>}, ${Out})`
  : E extends { readonly t: "named"; readonly name: infer N extends string; readonly e: infer X } ? `${N} => ${ExS<X>}`
  : E extends { readonly t: "variadic"; readonly e: infer X } ? `VARIADIC ${ExS<X>}`
  : E extends { readonly t: "default" } ? "DEFAULT"
  : E extends { readonly t: "isjson"; readonly e: infer X; readonly not: infer Not } ? (Not extends true ? `(NOT (${ExS<X>} IS JSON))` : `(${ExS<X>} IS JSON)`)
  : E extends { readonly t: "xml" } ? `XML(${Out})`
  : E extends { readonly t: "jsonfmt" | "jsonfn" | "jsonagg" } ? `JSON(${Out})`
  : E extends { readonly t: infer T extends string } ? `?${T}`
  : "?";

/** Walks the left spine without nesting the instantiation: `a + b + … + z` can have hundreds of terms. */
type Spine<E, Ops extends readonly unknown[]> =
  E extends { readonly t: "bin"; readonly op: infer Op; readonly l: infer L; readonly r: infer R }
    ? Op extends "and" | "or" ? (ExS<E> extends infer S extends string ? Build<S, Ops> : never) : Spine<L, [[Op, R], ...Ops]>
    : ExS<E> extends infer S extends string ? Build<S, Ops> : never;
type Build<Acc extends string, Ops> =
  Ops extends readonly [[infer Op, infer R], ...infer Rest] ? (ExS<R> extends infer S extends string ? Build<`(${Acc} ${NormOp<Op>} ${S})`, Rest> : never) : Acc;

type Leaves<E, Op> =
  E extends { readonly t: "bin"; readonly op: Op; readonly l: infer L; readonly r: infer R } ? [...Leaves<L, Op>, ...Leaves<R, Op>] : [E];
type Chain<L, Op extends string, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H, ...infer R] ? (ExS<H> extends infer S extends string ? Chain<R, Op, First extends true ? S : `${Acc} ${Op} ${S}`, false> : never) : Acc;

type Whens<Ws, Acc extends string = ""> =
  Ws extends readonly [{ readonly when: infer W; readonly then: infer T }, ...infer R] ? (`${Acc} WHEN ${ExS<W>} THEN ${ExS<T>}` extends infer S extends string ? Whens<R, S> : never) : Acc;

type Call<E> =
  E extends { readonly name: infer N extends string; readonly args: infer A; readonly distinct: infer D; readonly filter: infer F; readonly win: infer W; readonly withinGroup: infer G }
    ? `${N}(${D extends true ? "DISTINCT " : ""}${ExList<A>})${G extends null ? "" : ` WITHIN GROUP (${ExS<G>})`}${F extends null ? "" : ` FILTER (WHERE ${ExS<F>})`}${W extends null ? "" : ` OVER ${WindowSpec<W>}`}`
    : "?call";

type WindowSpec<W> =
  W extends { readonly name: infer N; readonly partition: infer P; readonly order: infer O }
    ? `(${Spaced<[N extends string ? N : "", P extends readonly [unknown, ...unknown[]] ? `PARTITION BY ${ExList<P>}` : "", O extends readonly [unknown, ...unknown[]] ? `ORDER BY ${ExList<O>}` : ""]>})`
    : "?window";
type Spaced<L, Acc extends string = ""> =
  L extends readonly [infer H extends string, ...infer R] ? Spaced<R, H extends "" ? Acc : Acc extends "" ? H : `${Acc} ${H}`> : Acc;

/** Postgres has no node for a parenthesized SELECT: the inner one's clauses merge into the outer. */
type Merged<S> =
  S extends { readonly body: { readonly t: "paren"; readonly q: infer Q } }
    ? Merged<Q> extends infer M
      ? M extends { readonly with: infer W2; readonly body: infer B; readonly orderBy: infer O2; readonly limit: infer L2; readonly offset: infer F2 }
        ? S extends { readonly with: infer W; readonly orderBy: infer O; readonly limit: infer L; readonly offset: infer F }
          ? { with: W extends null ? W2 : W; body: B; orderBy: O extends readonly [unknown, ...unknown[]] ? O : O2; limit: L extends null ? L2 : L; offset: F extends null ? F2 : F }
          : never
        : never
      : never
    : S;

export type Sel<S> = Merged<S> extends infer M ? SelM<M> : never;
type SelM<M> =
  M extends { readonly with: infer W; readonly body: infer B; readonly orderBy: infer O; readonly limit: infer L; readonly offset: infer F }
    ? `${With<W>}${Body<B>}${O extends readonly [unknown, ...unknown[]] ? ` ORDER BY ${ExList<O>}` : ""}${L extends null ? "" : ` LIMIT ${ExS<L>}`}${F extends null ? "" : ` OFFSET ${ExS<F>}`}`
    : "?select";

type HasClauses<M> =
  M extends { readonly with: null; readonly orderBy: readonly []; readonly limit: null; readonly offset: null } ? false : true;

type Body<B> =
  B extends { readonly t: "simple" } ? Simple<B>
  : B extends { readonly t: "setop"; readonly op: infer Op extends string; readonly all: infer A; readonly l: infer L; readonly r: infer R } ? `(${Operand<L>} ${Uppercase<Op>}${A extends true ? " ALL" : ""} ${Operand<R>})`
  : B extends { readonly t: "values"; readonly rows: infer Rs } ? `VALUES ${Rows<Rs>}`
  : B extends { readonly t: "paren"; readonly q: infer Q } ? Sel<Q>
  : "?body";

type Operand<X> =
  X extends { readonly t: "paren"; readonly q: infer Q }
    ? Merged<Q> extends infer M ? (HasClauses<M> extends true ? `(${SelM<M>})` : M extends { readonly body: infer B } ? Body<B> : never) : never
    : Body<X>;

type Rows<Rs, Acc extends string = "", First extends boolean = true> =
  Rs extends readonly [infer H, ...infer R] ? (ExList<H> extends infer S extends string ? Rows<R, First extends true ? `(${S})` : `${Acc}, (${S})`, false> : never) : Acc;

type Simple<B> =
  B extends { readonly distinct: infer D; readonly targets: infer Ts; readonly from: infer Fr; readonly where: infer W; readonly groupBy: infer G; readonly groupingSets: infer GS; readonly having: infer H; readonly windows: infer Wn }
    ? `SELECT${D extends true ? " DISTINCT" : D extends readonly unknown[] ? ` DISTINCT ON (${ExList<D>})` : ""}${Ts extends readonly [unknown, ...unknown[]] ? ` ${Targets<Ts>}` : ""}${Fr extends readonly [unknown, ...unknown[]] ? ` FROM ${FromList<Fr>}` : ""}${W extends null ? "" : ` WHERE ${ExS<W>}`}${G extends readonly unknown[] ? ` GROUP BY${GS extends true ? " [SETS]" : ""}${G extends readonly [unknown, ...unknown[]] ? ` ${ExList<G>}` : ""}` : ""}${H extends null ? "" : ` HAVING ${ExS<H>}`}${Wn extends readonly [unknown, ...unknown[]] ? ` WINDOW ${Windows<Wn>}` : ""}`
    : "?simple";

type Targets<Ts, Acc extends string = "", First extends boolean = true> =
  Ts extends readonly [{ readonly e: infer E; readonly alias: infer A }, ...infer R]
    ? (ExS<E> extends infer S extends string ? Targets<R, `${First extends true ? "" : `${Acc}, `}${S}${A extends string ? ` AS ${A}` : ""}`, false> : never)
    : Acc;

type Windows<Ws, Acc extends string = "", First extends boolean = true> =
  Ws extends readonly [{ readonly name: infer N extends string; readonly spec: infer S }, ...infer R]
    ? (WindowSpec<S> extends infer W extends string ? Windows<R, `${First extends true ? "" : `${Acc}, `}${N} AS ${W}`, false> : never)
    : Acc;

type With<W> =
  W extends { readonly recursive: infer Rec; readonly ctes: infer Cs } ? `WITH ${Rec extends true ? "RECURSIVE " : ""}${Ctes<Cs>} ` : "";
type Ctes<Cs, Acc extends string = "", First extends boolean = true> =
  Cs extends readonly [infer C, ...infer R] ? (Cte<C> extends infer S extends string ? Ctes<R, `${First extends true ? "" : `${Acc}, `}${S}`, false> : never) : Acc;
type Cte<C> =
  C extends { readonly name: infer N extends string; readonly cols: infer Cols; readonly q: infer Q; readonly search: infer S; readonly cycle: infer Cy }
    ? `${N}${NameList<Cols>} AS (${CanonStmt<Q>})${Search<S>}${Cycle<Cy>}`
    : "?cte";
type Search<S> =
  S extends { readonly breadth: infer B; readonly cols: infer Cols; readonly set: infer Set extends string } ? ` SEARCH ${B extends true ? "BREADTH" : "DEPTH"} FIRST BY ${Names<Cols>} SET ${Set}` : "";
type Cycle<C> =
  C extends { readonly cols: infer Cols; readonly set: infer Set extends string; readonly to: infer To; readonly default: infer D; readonly using: infer U extends string }
    ? ` CYCLE ${Names<Cols>} SET ${Set}${To extends null ? "" : ` TO ${ExS<To>} DEFAULT ${ExS<D>}`} USING ${U}`
    : "";

type FromList<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H, ...infer R] ? (From<H> extends infer S extends string ? FromList<R, First extends true ? S : `${Acc}, ${S}`, false> : never) : Acc;

type Alias<A, C> = A extends string ? ` AS ${A}${NameList<C>}` : "";
type ColDefs<D, Acc extends string = "", First extends boolean = true> =
  D extends readonly [{ readonly name: infer N extends string; readonly type: infer T extends string }, ...infer R] ? ColDefs<R, `${First extends true ? "" : `${Acc}, `}${N} ${T}`, false> : `(${Acc})`;
type JoinKindWord = { inner: "INNER"; left: "LEFT"; right: "RIGHT"; full: "FULL"; cross: "CROSS" };

type From<F> =
  F extends { readonly t: "table"; readonly ref: infer R; readonly alias: infer A; readonly colAliases: infer C } ? `${Ref<R>}${Alias<A, C>}`
  : F extends { readonly t: "join"; readonly kind: infer K extends keyof JoinKindWord; readonly l: infer L; readonly r: infer R; readonly on: infer On; readonly using: infer U; readonly natural: infer Nat }
    ? K extends "cross" ? `(${From<L>} CROSS JOIN ${From<R>})`
    : Nat extends true ? `(${From<L>} NATURAL ${JoinKindWord[K]} JOIN ${From<R>})`
    : U extends readonly string[] ? `(${From<L>} ${JoinKindWord[K]} JOIN ${From<R>} USING (${Names<U>}))`
    : `(${From<L>} ${JoinKindWord[K]} JOIN ${From<R>} ON ${ExS<On>})`
  : F extends { readonly t: "sub"; readonly q: infer Q; readonly alias: infer A; readonly colAliases: infer C; readonly lateral: infer Lat } ? `${Lat extends true ? "LATERAL " : ""}(${Sel<Q>})${Alias<A, C>}`
  : F extends { readonly t: "func"; readonly call: infer Call; readonly alias: infer A; readonly colAliases: infer C; readonly colDefs: infer D; readonly lateral: infer Lat; readonly withOrdinality: infer Ord }
    ? `${Lat extends true ? "LATERAL " : ""}${ExS<Call>}${Ord extends true ? " WITH ORDINALITY" : ""}${A extends string ? ` AS ${A}${D extends null ? NameList<C> : ""}` : ""}${D extends null ? "" : ` ${ColDefs<D>}`}`
  : F extends { readonly t: "rowsfrom"; readonly funcs: infer Fs; readonly alias: infer A; readonly colAliases: infer C; readonly colDefs: infer D; readonly lateral: infer Lat; readonly withOrdinality: infer Ord }
    ? `${Lat extends true ? "LATERAL " : ""}ROWS FROM (${RowsFromFuncs<Fs>})${Ord extends true ? " WITH ORDINALITY" : ""}${A extends string ? ` AS ${A}${D extends null ? NameList<C> : ""}` : ""}${D extends null ? "" : ` ${ColDefs<D>}`}`
  : F extends { readonly t: "sample"; readonly table: infer Tb; readonly method: infer M extends string; readonly args: infer Args; readonly repeatable: infer Rep } ? `${From<Tb>} TABLESAMPLE ${M}(${ExList<Args>})${Rep extends null ? "" : ` REPEATABLE (${ExS<Rep>})`}`
  : F extends { readonly t: "xmltable"; readonly alias: infer A; readonly colAliases: infer C } ? `XMLTABLE(${Out})${Alias<A, C>}`
  : F extends { readonly t: "jsontable"; readonly alias: infer A; readonly colAliases: infer C } ? `JSON_TABLE(${Out})${Alias<A, C>}`
  : "?from";
type RowsFromFuncs<Fs, Acc extends string = "", First extends boolean = true> =
  Fs extends readonly [{ readonly call: infer Call; readonly colDefs: infer D }, ...infer R]
    ? (ExS<Call> extends infer S extends string ? RowsFromFuncs<R, `${First extends true ? "" : `${Acc}, `}${S}${D extends null ? "" : ` AS ${ColDefs<D>}`}`, false> : never)
    : Acc;

type AssignCols<Cols, Ind, I extends readonly unknown[] = [], Acc extends string = ""> =
  Cols extends readonly [infer C extends string, ...infer R]
    ? ((Ind extends readonly unknown[] ? (Ind[I["length"]] extends null ? C : ExS<Ind[I["length"]]>) : C) extends infer S extends string ? AssignCols<R, Ind, [...I, 0], `${I extends [] ? "" : `${Acc}, `}${S}`> : never)
    : Acc;
type SetList<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H, ...infer R] ? (SetItem<H> extends infer S extends string ? SetList<R, `${First extends true ? "" : `${Acc}, `}${S}`, false> : never) : Acc;
type SetItem<S> =
  S extends { readonly t: "set"; readonly col: infer C extends string; readonly e: infer E } ? `${C} = ${ExS<E>}`
  : S extends { readonly t: "setind"; readonly target: infer Tg; readonly e: infer E } ? `${ExS<Tg>} = ${ExS<E>}`
  : S extends { readonly t: "setmulti"; readonly cols: infer Cols; readonly ind: infer Ind; readonly e: infer E } ? `(${AssignCols<Cols, Ind>}) = ${ExS<E>}`
  : "?set";
type Returning<Ret, Opts> =
  Ret extends readonly unknown[]
    ? ` RETURNING ${Opts extends readonly [unknown, ...unknown[]] ? `WITH (${RetOpts<Opts>}) ` : ""}${Targets<Ret>}`
    : "";
type RetOpts<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [{ readonly kind: infer K extends string; readonly alias: infer A extends string }, ...infer R] ? RetOpts<R, `${First extends true ? "" : `${Acc}, `}${Uppercase<K>} AS ${A}`, false> : Acc;
type DmlTarget<S> = S extends { readonly table: infer R; readonly alias: infer A } ? `${Ref<R>}${A extends string ? ` AS ${A}` : ""}` : "?target";
type Where<W> = W extends null ? "" : ` WHERE ${ExS<W>}`;

type Insert<S> =
  S extends { readonly with: infer W; readonly columns: infer Cols; readonly colInd: infer Ind; readonly source: infer Src; readonly onConflict: infer Oc; readonly returning: infer Ret; readonly retOpts: infer Opts }
    ? `${With<W>}INSERT INTO ${DmlTarget<S>}${Cols extends readonly string[] ? ` (${AssignCols<Cols, Ind>})` : ""}${Src extends { readonly t: "values"; readonly rows: infer Rs } ? ` VALUES ${Rows<Rs>}` : Src extends { readonly t: "select"; readonly q: infer Q } ? ` ${Sel<Q>}` : " DEFAULT VALUES"}${Oc extends { readonly t: "update"; readonly set: infer Set; readonly where: infer Wh } ? ` ON CONFLICT DO UPDATE SET ${SetList<Set>}${Where<Wh>}` : Oc extends { readonly t: "nothing" } ? " ON CONFLICT DO NOTHING" : ""}${Returning<Ret, Opts>}`
    : "?insert";
type Update<S> =
  S extends { readonly with: infer W; readonly set: infer Set; readonly from: infer Fr; readonly where: infer Wh; readonly returning: infer Ret; readonly retOpts: infer Opts }
    ? `${With<W>}UPDATE ${DmlTarget<S>} SET ${SetList<Set>}${Fr extends readonly [unknown, ...unknown[]] ? ` FROM ${FromList<Fr>}` : ""}${Where<Wh>}${Returning<Ret, Opts>}`
    : "?update";
type Delete<S> =
  S extends { readonly with: infer W; readonly using: infer U; readonly where: infer Wh; readonly returning: infer Ret; readonly retOpts: infer Opts }
    ? `${With<W>}DELETE FROM ${DmlTarget<S>}${U extends readonly [unknown, ...unknown[]] ? ` USING ${FromList<U>}` : ""}${Where<Wh>}${Returning<Ret, Opts>}`
    : "?delete";
type Merge<S> =
  S extends { readonly with: infer W; readonly source: infer Src; readonly on: infer On; readonly whens: infer Ws; readonly returning: infer Ret; readonly retOpts: infer Opts }
    ? `${With<W>}MERGE INTO ${DmlTarget<S>} USING ${From<Src>} ON ${ExS<On>}${MergeWhens<Ws>}${Returning<Ret, Opts>}`
    : "?merge";
type MergeWhens<Ws, Acc extends string = ""> =
  Ws extends readonly [{ readonly match: infer M; readonly cond: infer C; readonly action: infer A }, ...infer R]
    ? (`${Acc} WHEN ${M extends "matched" ? "MATCHED" : M extends "source" ? "NOT MATCHED BY SOURCE" : "NOT MATCHED"}${C extends null ? "" : ` AND ${ExS<C>}`} THEN ${MergeAction<A>}` extends infer S extends string ? MergeWhens<R, S> : never)
    : Acc;
type MergeAction<A> =
  A extends { readonly t: "update"; readonly set: infer Set } ? `UPDATE SET ${SetList<Set>}`
  : A extends { readonly t: "delete" } ? "DELETE"
  : A extends { readonly t: "insert"; readonly columns: infer Cols; readonly colInd: infer Ind; readonly values: infer V } ? `INSERT${Cols extends readonly string[] ? ` (${AssignCols<Cols, Ind>})` : ""}${V extends readonly unknown[] ? ` VALUES (${ExList<V>})` : " DEFAULT VALUES"}`
  : "DO NOTHING";

type Refs<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H, ...infer R] ? Refs<R, `${First extends true ? "" : `${Acc}, `}${Ref<H>}`, false> : Acc;
type ColDef<C> =
  C extends { readonly name: infer N extends string; readonly type: infer T extends string; readonly notNull: infer NN; readonly hasDefault: infer HD; readonly primaryKey: infer PK }
    ? `${N} ${T}${NN extends true ? " NOT NULL" : ""}${HD extends true ? " DEFAULT" : ""}${PK extends true ? " PRIMARY KEY" : ""}`
    : "?column";
type ColDefList<L, Acc extends readonly string[] = []> = L extends readonly [infer H, ...infer R] ? ColDefList<R, [...Acc, ColDef<H>]> : Acc;
type TableConstraints<L, Acc extends readonly string[] = []> =
  L extends readonly [infer H, ...infer R]
    ? TableConstraints<R, [...Acc, H extends { readonly t: "pk"; readonly cols: infer Cols } ? `PRIMARY KEY (${Names<Cols>})` : H extends { readonly t: "not_null"; readonly col: infer N extends string } ? `NOT NULL ${N}` : `CONSTRAINT ${Out}`]>
    : Acc;
type Likes<L, Acc extends readonly string[] = []> =
  L extends readonly [{ readonly ref: infer Rf; readonly defaults: infer D }, ...infer R] ? Likes<R, [...Acc, `LIKE ${Ref<Rf>}${D extends true ? " DEFAULTS" : ""}`]> : Acc;

type CreateTable<S> =
  S extends { readonly ifNotExists: infer Ine; readonly table: infer T; readonly columns: infer Cols; readonly constraints: infer Cons; readonly like: infer L; readonly inherits: infer Inh; readonly of: infer Of }
    ? `CREATE TABLE ${Ine extends true ? "IF NOT EXISTS " : ""}${Ref<T>}${Of extends null ? "" : ` OF ${Ref<Of>}`} (${Names<[...ColDefList<Cols>, ...TableConstraints<Cons>, ...Likes<L>]>})${Inh extends readonly [unknown, ...unknown[]] ? ` INHERITS (${Refs<Inh>})` : ""}`
    : "?create_table";

type AlterActions<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H, ...infer R] ? AlterActions<R, `${First extends true ? "" : `${Acc}, `}${AlterAction<H>}`, false> : Acc;
type AlterAction<A> =
  A extends { readonly t: "add_column"; readonly ifNotExists: infer Ine; readonly col: infer C } ? `ADD COLUMN ${Ine extends true ? "IF NOT EXISTS " : ""}${ColDef<C>}`
  : A extends { readonly t: "drop_column"; readonly ifExists: infer Ife; readonly name: infer N extends string } ? `DROP COLUMN ${Ife extends true ? "IF EXISTS " : ""}${N}`
  : A extends { readonly t: "rename_column"; readonly from: infer F extends string; readonly to: infer T extends string } ? `RENAME COLUMN ${F} TO ${T}`
  : A extends { readonly t: "rename_table"; readonly to: infer T extends string } ? `RENAME TO ${T}`
  : A extends { readonly t: "set_schema"; readonly schema: infer Sc extends string } ? `SET SCHEMA ${Sc}`
  : A extends { readonly t: "alter_type"; readonly name: infer N extends string; readonly type: infer T extends string } ? `ALTER COLUMN ${N} TYPE ${T}`
  : A extends { readonly t: "set_not_null"; readonly name: infer N extends string } ? `ALTER COLUMN ${N} SET NOT NULL`
  : A extends { readonly t: "drop_not_null"; readonly name: infer N extends string } ? `ALTER COLUMN ${N} DROP NOT NULL`
  : A extends { readonly t: "set_default"; readonly name: infer N extends string } ? `ALTER COLUMN ${N} SET DEFAULT`
  : A extends { readonly t: "drop_default"; readonly name: infer N extends string } ? `ALTER COLUMN ${N} DROP DEFAULT`
  : A extends { readonly t: "add_identity"; readonly name: infer N extends string } ? `ALTER COLUMN ${N} ADD IDENTITY`
  : A extends { readonly t: "add_pk"; readonly cols: infer Cols } ? `ADD PRIMARY KEY (${Names<Cols>})`
  : Out;

type Quoted<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H extends string, ...infer R] ? Quoted<R, `${First extends true ? "" : `${Acc}, `}'${H}'`, false> : Acc;
type AlterEnum<S> =
  S extends { readonly name: infer N; readonly action: infer A }
    ? A extends { readonly t: "add_value"; readonly value: infer V extends string; readonly ifNotExists: infer Ine } ? `ALTER TYPE ${Ref<N>} ADD VALUE ${Ine extends true ? "IF NOT EXISTS " : ""}'${V}'`
    : A extends { readonly t: "rename_value"; readonly from: infer F extends string; readonly to: infer T extends string } ? `ALTER TYPE ${Ref<N>} RENAME VALUE '${F}' TO '${T}'`
    : A extends { readonly t: "rename"; readonly to: infer T extends string } ? `ALTER TYPE ${Ref<N>} RENAME TO ${T}`
    : Out
    : "?alter_enum";

type SchemaElements<L, Acc extends string = "", First extends boolean = true> =
  L extends readonly [infer H, ...infer R] ? (CanonStmt<H> extends infer X extends string ? SchemaElements<R, `${First extends true ? "" : `${Acc}; `}${X}`, false> : never) : Acc;

export type CanonStmt<S> =
  S extends { readonly t: "select" } ? Sel<S>
  : S extends { readonly t: "insert" } ? Insert<S>
  : S extends { readonly t: "update" } ? Update<S>
  : S extends { readonly t: "delete" } ? Delete<S>
  : S extends { readonly t: "merge" } ? Merge<S>
  : S extends { readonly t: "declare_cursor"; readonly name: infer N extends string; readonly q: infer Q } ? `DECLARE ${N} CURSOR FOR ${Sel<Q>}`
  : S extends { readonly t: "create_view"; readonly materialized: infer M; readonly view: infer V; readonly cols: infer Cols; readonly q: infer Q } ? `CREATE ${M extends true ? "MATERIALIZED VIEW" : "VIEW"} ${Ref<V>}${NameList<Cols>} AS ${Sel<Q>}`
  : S extends { readonly t: "create_table_as"; readonly table: infer T; readonly cols: infer Cols; readonly q: infer Q } ? `CREATE TABLE ${Ref<T>}${NameList<Cols>} AS ${Q extends { readonly t: "execute"; readonly name: infer N extends string } ? `EXECUTE ${N}` : Sel<Q>}`
  : S extends { readonly t: "create_table" } ? CreateTable<S>
  : S extends { readonly t: "alter_table"; readonly ifExists: infer Ife; readonly table: infer T; readonly actions: infer As } ? `ALTER TABLE ${Ife extends true ? "IF EXISTS " : ""}${Ref<T>} ${AlterActions<As>}`
  : S extends { readonly t: "drop_table"; readonly ifExists: infer Ife; readonly tables: infer L } ? `DROP TABLE ${Ife extends true ? "IF EXISTS " : ""}${Refs<L>}`
  : S extends { readonly t: "drop_view"; readonly ifExists: infer Ife; readonly materialized: infer M; readonly views: infer L } ? `DROP ${M extends true ? "MATERIALIZED VIEW" : "VIEW"} ${Ife extends true ? "IF EXISTS " : ""}${Refs<L>}`
  : S extends { readonly t: "drop_type"; readonly ifExists: infer Ife; readonly names: infer L; readonly cascade: infer C } ? `DROP TYPE ${Ife extends true ? "IF EXISTS " : ""}${Refs<L>}${C extends true ? " CASCADE" : ""}`
  : S extends { readonly t: "drop_schema"; readonly ifExists: infer Ife; readonly names: infer L; readonly cascade: infer C } ? `DROP SCHEMA ${Ife extends true ? "IF EXISTS " : ""}${Names<L>}${C extends true ? " CASCADE" : ""}`
  : S extends { readonly t: "create_enum"; readonly name: infer N; readonly values: infer Vs } ? `CREATE TYPE ${Ref<N>} AS ENUM (${Quoted<Vs>})`
  : S extends { readonly t: "alter_enum" } ? AlterEnum<S>
  : S extends { readonly t: "create_schema"; readonly ifNotExists: infer Ine; readonly name: infer N extends string; readonly elements: infer Es } ? `CREATE SCHEMA ${Ine extends true ? "IF NOT EXISTS " : ""}${N}${Es extends readonly [unknown, ...unknown[]] ? ` (${SchemaElements<Es>})` : ""}`
  : S extends { readonly t: "rename_schema"; readonly from: infer F extends string; readonly to: infer T extends string } ? `ALTER SCHEMA ${F} RENAME TO ${T}`
  : S extends { readonly t: "create_function"; readonly name: infer N; readonly ret: infer R extends string; readonly srf: infer Srf } ? `CREATE FUNCTION ${Ref<N>} RETURNS ${Srf extends true ? "SETOF " : ""}${R}`
  : S extends { readonly t: "fetch" | "move"; readonly cursor: infer C extends string } ? `${S extends { readonly t: "move" } ? "MOVE" : "FETCH"} ${C}`
  : S extends { readonly t: "close_cursor"; readonly cursor: infer C } ? `CLOSE ${C extends string ? C : "ALL"}`
  : Out;
