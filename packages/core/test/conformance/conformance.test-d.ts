import { expectTypeOf, test } from "vitest";
import type { DefaultTypeMap, ParamsOf, RowOf } from "../../src/index.js";
import type { CheckEnc, Enc } from "../../src/engine/index.js";
import type { ConformanceDB, TypeofName, corpus, jsonCorpus } from "./corpus.js";

/**
 * Compile-time half of the conformance corpus. For every entry:
 *   - `keyof RowOf<ConformanceDB, DefaultTypeMap, sql>` must equal the union of `expectKeys`;
 *   - the `typeof` category recorded in `expectTypes` must be one the inferred TS type can
 *     produce (`string | null` admits "string" and "null"; `unknown` admits anything);
 *   - every value in `params` (which the runtime half sends through both drivers) is accepted
 *     by the inferred parameter type, checked like an inline `sql.param()` value.
 * `Report` is a per-case object so a failure names the case, the column and the inferred type.
 */

type Cases = typeof corpus;
type Case = Cases[number];
type Row<C extends Case> = RowOf<ConformanceDB, DefaultTypeMap, C["sql"]>;
type Keys<C extends Case> = C["expectKeys"][number];

/** typeof categories a TS type can produce at runtime (distributes over unions). */
type Categories<T> = [unknown] extends [T]
  ? TypeofName
  : T extends string ? "string"
  : T extends number ? "number"
  : T extends boolean ? "boolean"
  : T extends bigint ? "bigint"
  : T extends null ? "null"
  : T extends object ? "object"
  : never;

type KeysReport<C extends Case> =
  [keyof Row<C>] extends [Keys<C>]
    ? [Keys<C>] extends [keyof Row<C>] ? true : { missingFromRow: Exclude<Keys<C>, keyof Row<C>> }
    : { notInExpectKeys: Exclude<keyof Row<C>, Keys<C>> };

type TypeMismatches<C extends Case> = {
  [K in Keys<C> & keyof Row<C> & keyof C["expectTypes"]]: C["expectTypes"][K] extends Categories<Row<C>[K]>
    ? never
    : { column: K; expected: C["expectTypes"][K]; inferred: Row<C>[K] };
}[Keys<C> & keyof Row<C> & keyof C["expectTypes"]];

type Params<C extends Case> = ParamsOf<ConformanceDB, DefaultTypeMap, C["sql"]>;
type ParamIndex<C extends Case> = keyof C["params"] & keyof Params<C> & `${number}`;
type ParamMismatches<C extends Case> = {
  [I in ParamIndex<C>]: CheckEnc<Enc<C["params"][I]>, Params<C>[I]> extends true ? never : { param: I; value: C["params"][I]; accepts: Params<C>[I] };
}[ParamIndex<C>];

type Report = {
  [C in Case as C["name"]]: {
    keys: KeysReport<C>;
    types: [TypeMismatches<C>] extends [never] ? true : TypeMismatches<C>;
    params: [ParamMismatches<C>] extends [never] ? true : ParamMismatches<C>;
  };
};
type AllGood = { [C in Case as C["name"]]: { keys: true; types: true; params: true } };

test("every corpus entry's inferred row matches expectKeys and expectTypes", () => {
  expectTypeOf<Report>().toEqualTypeOf<AllGood>();
});

// ─── typed JSON ───

/**
 * Can a value of TS type `T` have the deep typeof `D`? Some member of `T` must: a scalar
 * category (as above), an array whose elements admit each element descriptor, or an object with
 * exactly the descriptor's keys (any keys for an index signature) whose values admit them.
 */
type Admits<T, D> = [unknown] extends [T] ? true : true extends (T extends unknown ? AdmitsOne<T, D> : never) ? true : false;
type AdmitsOne<T, D> =
  D extends string ? (D extends Categories<T> ? true : false)
  : D extends readonly unknown[]
    ? T extends readonly unknown[] ? AllTrue<{ [I in keyof D]: Admits<number extends T["length"] ? T[number] : I extends keyof T ? T[I] : never, D[I]> }> : false
  : T extends readonly unknown[] ? false
  : T extends object
    ? string extends keyof T
      ? AllTrue<{ [K in keyof D]: Admits<T[string & keyof T], D[K]> }>
      : [keyof T] extends [keyof D] ? ([keyof D] extends [keyof T] ? AllTrue<{ [K in keyof D]: Admits<T[K & keyof T], D[K]> }> : false) : false
    : false;
type AllTrue<R> = false extends R[keyof R] ? false : true;

type JsonCase_ = (typeof jsonCorpus)[number];
type JsonRow<C extends JsonCase_> = RowOf<ConformanceDB, DefaultTypeMap, C["sql"]>;
type JsonMismatches<C extends JsonCase_> = {
  [K in keyof C["expectJson"]]: K extends keyof JsonRow<C>
    ? (Admits<JsonRow<C>[K], C["expectJson"][K]> extends true ? never : { column: K; expected: C["expectJson"][K]; inferred: JsonRow<C>[K] })
    : { column: K; missingFromRow: true };
}[keyof C["expectJson"]];
type JsonReport = { [C in JsonCase_ as C["name"]]: [JsonMismatches<C>] extends [never] ? true : JsonMismatches<C> };
type JsonAllGood = { [C in JsonCase_ as C["name"]]: true };

test("every JSON corpus entry's inferred column types admit the returned JSON", () => {
  expectTypeOf<JsonReport>().toEqualTypeOf<JsonAllGood>();
});

// The check itself: exact keys, element-wise arrays, unions.
test("Admits", () => {
  expectTypeOf<Admits<{ a: number }, { a: "number" }>>().toEqualTypeOf<true>();
  expectTypeOf<Admits<{ a: number; b: string }, { a: "number" }>>().toEqualTypeOf<false>();
  expectTypeOf<Admits<{ a: number }, { a: "string" }>>().toEqualTypeOf<false>();
  expectTypeOf<Admits<(number | null)[], ["number", "null"]>>().toEqualTypeOf<true>();
  expectTypeOf<Admits<number[], ["number", "null"]>>().toEqualTypeOf<false>();
  expectTypeOf<Admits<[number, string], ["number", "string"]>>().toEqualTypeOf<true>();
  expectTypeOf<Admits<{ a: number } | null, "null">>().toEqualTypeOf<true>();
  expectTypeOf<Admits<{ [k: string]: number }, { x: "number"; y: "number" }>>().toEqualTypeOf<true>();
});
