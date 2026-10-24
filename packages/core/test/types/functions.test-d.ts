import { expectTypeOf, test } from "vitest";
import type { SqlError } from "../../src/index.js";
import type { CacheAnalysis } from "../../src/engine/index.js";
import type { DB, Row, V, Interval } from "./_schema.js";

// Return types verified against PostgreSQL 18 (`pg_proc` and `select pg_typeof(f(...))`).
// Default type map: int2/int4/float4/float8 → number, int8/numeric → string, bytea → Uint8Array,
// date/timestamp(tz) → Date, time → string, interval → Interval, json(b) → unknown, void → void.

test("string functions", () => {
  expectTypeOf<Row<"SELECT lower(label) AS a, upper(vc) AS b, initcap(label) AS c, length(label) AS d, length(bin) AS e, length(tsv) AS f, char_length(vc) AS g, octet_length(label) AS h, bit_length(bin) AS i, bit_count(bin) AS j FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: string; d: number; e: number; f: number; g: number; h: number; i: number; j: string }>();
  expectTypeOf<Row<"SELECT concat(label, id) AS a, concat_ws(',', label, id) AS b, format('%s', id) AS c, left(label, 1) AS d, right(label, 1) AS e, lpad(label, 3) AS f, rpad(label, 3, 'x') AS g, repeat(label, 2) AS h FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: string; d: string; e: string; f: string; g: string; h: string }>();
  expectTypeOf<Row<"SELECT ltrim(label) AS a, rtrim(label, 'x') AS b, btrim(bin, bin) AS c, replace(label, 'a', 'b') AS d, reverse(label) AS e, split_part(label, ',', 1) AS f, strpos(label, 'a') AS g, substr(label, 1) AS h, substr(bin, 1, 2) AS i, translate(label, 'a', 'b') AS j, starts_with(label, 'a') AS k FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: Uint8Array; d: string; e: string; f: string; g: number; h: string; i: Uint8Array; j: string; k: boolean }>();
  expectTypeOf<Row<"SELECT ascii(label) AS a, chr(65) AS b, quote_ident(label) AS c, quote_literal(id) AS d, to_hex(id) AS e, to_hex(big) AS f, md5(label) AS g, md5(bin) AS h, parse_ident(label) AS i, unistr(label) AS j, normalize(label) AS k FROM things">>()
    .toEqualTypeOf<{ a: number; b: string; c: string; d: string; e: string; f: string; g: string; h: string; i: string[]; j: string; k: string }>();
  expectTypeOf<Row<"SELECT regexp_replace(label, 'a', 'b') AS a, regexp_replace(label, 'a', 'b', 'g') AS b, regexp_match(label, 'a') AS c, regexp_split_to_array(label, ' ') AS d, regexp_count(label, 'a') AS e, regexp_like(label, 'a') AS f, regexp_instr(label, 'a') AS g, regexp_substr(label, 'a') AS h, string_to_array(label, ',') AS i FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: string[] | null; d: string[]; e: number; f: boolean; g: number; h: string | null; i: string[] }>();
  expectTypeOf<Row<"SELECT encode(bin, 'hex') AS a, decode(label, 'hex') AS b, convert_from(bin, 'utf8') AS c, convert_to(label, 'utf8') AS d, get_byte(bin, 0) AS e, set_byte(bin, 0, 1) AS f, sha256(bin) AS g, digest(label, 'sha256') AS h, hmac(label, 'k', 'sha256') AS i, text(id) AS j FROM things">>()
    .toEqualTypeOf<{ a: string; b: Uint8Array; c: string; d: Uint8Array; e: number; f: Uint8Array; g: Uint8Array; h: Uint8Array; i: Uint8Array; j: string }>();
  // special syntax forms
  expectTypeOf<Row<"SELECT substring(label FROM 1 FOR 2) AS a, substring(bin FROM 1) AS b, trim(BOTH 'x' FROM label) AS c, trim(label, 'x') AS d, position('a' IN label) AS e, overlay(label PLACING 'x' FROM 1 FOR 2) AS f, substring(n_text, 1) AS g FROM things">>()
    .toEqualTypeOf<{ a: string; b: Uint8Array; c: string; d: string; e: number; f: string; g: string | null }>();
});

test("PostgreSQL 18 overloads: reverse(bytea), json(b)_strip_nulls(…, strip_in_arrays)", () => {
  expectTypeOf<Row<"SELECT reverse(bin) AS a, reverse(label) AS b, jsonb_strip_nulls(data, true)::text AS c, json_strip_nulls(doc, false)::text AS d, jsonb_strip_nulls(data, n_flag)::text AS e FROM things">>()
    .toEqualTypeOf<{ a: Uint8Array; b: string; c: string; d: string; e: string | null }>();
  // an untyped NULL resolves to text, Postgres's preferred string type
  expectTypeOf<Row<"SELECT reverse(NULL) AS a">>().toEqualTypeOf<{ a: string | null }>();
});

test("PostgreSQL 18 functions without curated signatures: results nullable where pg_proc says so", () => {
  // `unknown` and `void` results hide NULL in a row type: the analysis keeps it
  type Nullable<Q extends string> = CacheAnalysis<DB, Q> extends { readonly cols: infer C extends readonly { readonly t: { readonly nullable: boolean } }[] } ? { [K in keyof C]: C[K]["t"]["nullable"] } : never;
  expectTypeOf<Nullable<"SELECT array_reverse(nums) AS a, array_sort(nums) AS b FROM things">>().toEqualTypeOf<[true, true]>();
  expectTypeOf<Nullable<"SELECT pg_clear_attribute_stats('s', 't', 'c', false) AS a, pg_clear_relation_stats('s', 't') AS b">>().toEqualTypeOf<[true, true]>();
  expectTypeOf<Row<"SELECT pg_restore_attribute_stats('relation', 'x') AS a, pg_restore_relation_stats('relation', 'x') AS b">>().toEqualTypeOf<{ a: boolean | null; b: boolean | null }>();
});

test("numeric functions: integer inputs pick the float8 overload, numeric stays numeric", () => {
  expectTypeOf<Row<"SELECT abs(id) AS a, abs(small) AS b, abs(price) AS c, abs(score) AS d, round(id) AS e, round(price) AS f, round(price, 2) AS g, round(ratio) AS h, round(1.5) AS i, round(1) AS j, round(id, 1) AS k FROM things">>()
    .toEqualTypeOf<{ a: number; b: number; c: string; d: number; e: number; f: string; g: string; h: number; i: string; j: number; k: string }>();
  expectTypeOf<Row<"SELECT ceil(id) AS a, ceil(price) AS b, floor(score) AS c, trunc(price, 1) AS d, sign(price) AS e, sign(id) AS f, mod(id, 2) AS g, mod(big, 2) AS h, mod(price, 2) AS i, mod(small, small) AS j, div(price, 2) AS k FROM things">>()
    .toEqualTypeOf<{ a: number; b: string; c: number; d: string; e: string; f: number; g: number; h: string; i: string; j: number; k: string }>();
  expectTypeOf<Row<"SELECT power(2, 3) AS a, power(price, 2) AS b, power(ratio, 2) AS c, sqrt(id) AS d, sqrt(price) AS e, cbrt(id) AS f, exp(price) AS g, ln(id) AS h, log(price) AS i, log(2, 8) AS j, log10(ratio) AS k FROM things">>()
    .toEqualTypeOf<{ a: number; b: string; c: number; d: number; e: string; f: number; g: string; h: number; i: string; j: string; k: number }>();
  expectTypeOf<Row<"SELECT pi() AS a, random() AS b, random(1, 10) AS c, setseed(0.5) AS d, width_bucket(price, 0, 10, 5) AS e, scale(price) AS f, trim_scale(price) AS g, gcd(id, 4) AS h, gcd(big, 4) AS i, lcm(price, 4) AS j, factorial(5) AS k FROM things">>()
    .toEqualTypeOf<{ a: number; b: number; c: number; d: void; e: number; f: number; g: string; h: number; i: string; j: string; k: string }>();
  expectTypeOf<Row<"SELECT sin(ratio) AS a, atan2(ratio, 1) AS b, degrees(id) AS c, radians(price) AS d, erf(ratio) AS e, sinh(1) AS f FROM things">>()
    .toEqualTypeOf<{ a: number; b: number; c: number; d: number; e: number; f: number }>();
});

test("date/time functions", () => {
  expectTypeOf<Row<"SELECT now() AS a, clock_timestamp() AS b, timeofday() AS c, age(at) AS d, age(at, at) AS e, age(day) AS f, date_part('day', dur) AS g, isfinite(day) AS h, date_part('hour', clock) AS i FROM things">>()
    .toEqualTypeOf<{ a: Date; b: Date; c: string; d: Interval; e: Interval; f: Interval; g: number; h: boolean; i: number }>();
  expectTypeOf<Row<"SELECT date_trunc('day', at) AS a, date_trunc('day', ts) AS b, date_trunc('day', day) AS c, date_trunc('day', dur) AS d, date_trunc('day', at, 'utc') AS e, date_bin('1 hour', at, at) AS f, date_bin('1 hour', ts, ts) AS g, date_trunc('day', n_at) AS h FROM things">>()
    .toEqualTypeOf<{ a: Date; b: Date; c: Date; d: Interval; e: Date; f: Date; g: Date; h: Date | null }>();
  expectTypeOf<Row<"SELECT make_date(2020, 1, 1) AS a, make_time(1, 2, 3) AS b, make_timestamp(2020, 1, 1, 0, 0, 0) AS c, make_timestamptz(2020, 1, 1, 0, 0, 0, 'utc') AS d, make_interval(1, 2) AS e, make_interval() AS f, justify_days(dur) AS g, justify_interval(dur) AS h FROM things">>()
    .toEqualTypeOf<{ a: Date; b: string; c: Date; d: Date; e: Interval; f: Interval; g: Interval; h: Interval }>();
  expectTypeOf<Row<"SELECT to_char(at, 'YYYY') AS a, to_char(price, '9') AS b, to_char(dur, 'HH') AS c, to_number('1', '9') AS d, to_date('2020', 'YYYY') AS e, to_timestamp('2020', 'YYYY') AS f, to_timestamp(1.5) AS g, to_timestamp(id) AS h FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: string; d: string; e: Date; f: Date; g: Date; h: Date }>();
  expectTypeOf<Row<"SELECT timezone('utc', at) AS a, timezone('utc', ts) AS b, timezone('utc', clock) AS c, date_add(at, dur) AS d, date_subtract(at, dur, 'utc') AS e, current_setting('x') AS f, current_setting('x', true) AS g, statement_timestamp() AS h FROM things">>()
    .toEqualTypeOf<{ a: Date; b: Date; c: string; d: Date; e: Date; f: string; g: string | null; h: Date }>();
});

test("JSON functions (cast to text to observe nullability; typed JSON is in json.test-d.ts)", () => {
  expectTypeOf<Row<"SELECT to_json(id)::text AS a, to_jsonb(label)::text AS b, to_jsonb(n_text)::text AS c, jsonb_build_object('a', n_id)::text AS d, jsonb_build_array()::text AS e, json_build_object()::text AS f, json_object(words)::text AS g, jsonb_object(words, words)::text AS h FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: string | null; d: string; e: string; f: string; g: string; h: string }>();
  expectTypeOf<Row<"SELECT json_array_length(doc) AS a, jsonb_array_length(data) AS b, json_typeof(doc) AS c, jsonb_typeof(n_data) AS d, jsonb_pretty(data) AS e, jsonb_extract_path_text(data, 'a', 'b') AS f, json_extract_path_text(doc, 'a') AS g, jsonb_extract_path(data, 'a')::text AS h FROM things">>()
    .toEqualTypeOf<{ a: number; b: number; c: string; d: string | null; e: string; f: string | null; g: string | null; h: string | null }>();
  expectTypeOf<Row<"SELECT jsonb_set(data, '{a}', '1')::text AS a, jsonb_set(data, words, data, true)::text AS b, jsonb_set_lax(data, '{a}', NULL)::text AS c, jsonb_insert(data, '{a}', '1')::text AS d, jsonb_strip_nulls(n_data)::text AS e, jsonb_concat(data, data)::text AS f, jsonb_delete(data, 'a')::text AS g, jsonb_delete_path(data, words)::text AS h FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: string; d: string; e: string | null; f: string; g: string; h: string }>();
  expectTypeOf<Row<"SELECT jsonb_path_exists(data, '$.a') AS a, jsonb_path_match(data, '$.a == 1', '{}', true) AS b, jsonb_path_query_array(data, '$.a')::text AS c, jsonb_path_query_first(data, '$.a')::text AS d, jsonb_exists(data, 'a') AS e, jsonb_contains(data, data) AS f, jsonb_exists_any(data, words) AS g, row_to_json(ROW(1, 2))::text AS h, json_scalar(id)::text AS i FROM things">>()
    .toEqualTypeOf<{ a: boolean; b: boolean; c: string; d: string | null; e: boolean; f: boolean; g: boolean; h: string; i: string }>();
});

test("set-returning functions in FROM", () => {
  expectTypeOf<Row<"SELECT x FROM jsonb_array_elements_text('[1]') AS x">>().toEqualTypeOf<{ x: string | null }>();
  expectTypeOf<Row<"SELECT x FROM jsonb_array_elements('[1]') AS x">>().toEqualTypeOf<{ x: unknown }>();
  expectTypeOf<Row<"SELECT k FROM jsonb_object_keys('{}') AS k">>().toEqualTypeOf<{ k: string }>();
  expectTypeOf<Row<"SELECT u FROM unnest(ARRAY[1, 2]) AS u">>().toEqualTypeOf<{ u: number }>();
  expectTypeOf<Row<"SELECT u FROM unnest(ARRAY['a']) u">>().toEqualTypeOf<{ u: string }>();
  expectTypeOf<Row<"SELECT t.w FROM things, unnest(things.words) AS t(w)">>().toEqualTypeOf<{ w: string }>();
  expectTypeOf<Row<"SELECT g FROM generate_series(1, 3) g">>().toEqualTypeOf<{ g: number }>();
  expectTypeOf<Row<"SELECT g FROM generate_series(1, 3::int8) g">>().toEqualTypeOf<{ g: string }>();
  expectTypeOf<Row<"SELECT g FROM generate_series(1.0, 3) g">>().toEqualTypeOf<{ g: string }>();
  expectTypeOf<Row<"SELECT g FROM generate_series(now(), now(), '1 day') g">>().toEqualTypeOf<{ g: Date }>();
  expectTypeOf<Row<"SELECT s FROM regexp_split_to_table('a b', ' ') s">>().toEqualTypeOf<{ s: string }>();
  expectTypeOf<Row<"SELECT s FROM string_to_table('a,b', ',') s">>().toEqualTypeOf<{ s: string }>();
  expectTypeOf<Row<"SELECT m FROM regexp_matches('a', 'a') m">>().toEqualTypeOf<{ m: string[] }>();
  expectTypeOf<Row<"SELECT i FROM generate_subscripts(ARRAY[1], 1) i">>().toEqualTypeOf<{ i: number }>();
});

test("array functions", () => {
  expectTypeOf<Row<"SELECT array_length(nums, 1) AS a, cardinality(nums) AS b, array_append(nums, 1) AS c, array_prepend(1, nums) AS d, array_cat(nums, nums) AS e, array_remove(nums, 1) AS f, array_replace(nums, 1, 2) AS g FROM things">>()
    .toEqualTypeOf<{ a: number | null; b: number; c: number[]; d: number[]; e: number[]; f: number[]; g: number[] }>();
  expectTypeOf<Row<"SELECT array_position(nums, 1) AS a, array_positions(nums, 1) AS b, array_to_string(nums, ',') AS c, array_to_string(nums, ',', '*') AS d, array_upper(nums, 1) AS e, array_ndims(nums) AS f, array_dims(nums) AS g, array_fill(0, ARRAY[2]) AS h, array_fill(label, ARRAY[2]) AS i FROM things">>()
    .toEqualTypeOf<{ a: number | null; b: number[]; c: string; d: string; e: number | null; f: number | null; g: string | null; h: number[]; i: string[] }>();
  expectTypeOf<Row<"SELECT array_to_json(nums)::text AS a, array_sample(words, 1) AS b, array_shuffle(nums) AS c, trim_array(nums, 1) AS d, string_to_array(label, ',') AS e, array_agg(id) AS f FROM things GROUP BY id">>()
    .toEqualTypeOf<{ a: string; b: string[]; c: number[]; d: number[]; e: string[]; f: number[] }>();
});

test("uuid, crypto, sequences, system functions", () => {
  expectTypeOf<Row<"SELECT gen_random_uuid() AS a, uuid_generate_v4() AS b, gen_random_bytes(4) AS c, crypt(label, gen_salt('bf')) AS d, nextval('s') AS e, currval('s') AS f, setval('s', 1) AS g, lastval() AS h, uuid_extract_version(uid) AS i FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: Uint8Array; d: string; e: string; f: string; g: string; h: string; i: number | null }>();
  expectTypeOf<Row<"SELECT pg_typeof(id)::text AS a, txid_current() AS b, pg_backend_pid() AS c, version() AS d, current_database() AS e, pg_sleep(0) AS f, pg_notify('a', 'b') AS g, pg_try_advisory_lock(1) AS h, num_nulls(n_id, n_text) AS i, pg_column_size(label) AS j, pg_size_pretty(big) AS k FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: number; d: string; e: string; f: void; g: void; h: boolean; i: number; j: number; k: string }>();
});

test("text search and range functions", () => {
  expectTypeOf<Row<"SELECT to_tsvector(label) AS a, to_tsvector('english', label) AS b, to_tsquery('x') AS c, plainto_tsquery('english', label) AS d, websearch_to_tsquery(label) AS e, ts_rank(tsv, to_tsquery('x')) AS f, ts_headline(label, to_tsquery('x')) AS g, setweight(tsv, 'A') AS h, strip(tsv) AS i, numnode(to_tsquery('x')) AS j, tsvector_to_array(tsv) AS k, to_tsvector(data) AS l FROM things">>()
    .toEqualTypeOf<{ a: string; b: string; c: string; d: string; e: string; f: number; g: string; h: string; i: string; j: number; k: string[]; l: string }>();
  expectTypeOf<Row<"SELECT lower(rng) AS a, upper(rng) AS b, isempty(rng) AS c, lower_inc(rng) AS d, upper_inf(rng) AS e, range_merge(rng, rng) AS f, int4range(1, 5) AS g, int4range(n_id, NULL, '[]') AS h, numrange(1, 5) AS i, tstzrange(at, at) AS j, daterange(day, day) AS k FROM things">>()
    .toEqualTypeOf<{ a: number | null; b: number | null; c: boolean; d: boolean; e: boolean; f: string; g: string; h: string; i: string; j: string; k: string }>();
  // overloads chosen by argument type: lower(text) vs lower(anyrange)
  expectTypeOf<Row<"SELECT lower(label) AS a, lower(rng) AS b, lower('x') AS c FROM things">>().toEqualTypeOf<{ a: string; b: number | null; c: string }>();
});

test("unknown functions are errors, as in Postgres", () => {
  type Declare = "Declare it in the schema's $functions or in FunctionCatalog";
  expectTypeOf<V<"SELECT my_unknown_fn(id) FROM things">>().toEqualTypeOf<SqlError<`function my_unknown_fn(int4) does not exist. ${Declare}`, 1>>();
  // untyped literals and NULL are `unknown`, like Postgres prints them
  expectTypeOf<V<"SELECT my_unknown_fn(label, 'x', NULL, 1.5) FROM things">>().toEqualTypeOf<SqlError<`function my_unknown_fn(text, unknown, unknown, numeric) does not exist. ${Declare}`, 1>>();
  expectTypeOf<V<"SELECT 1 FROM things WHERE public.my_unknown_fn(id)">>().toEqualTypeOf<SqlError<`function my_unknown_fn(int4) does not exist. ${Declare}`, 7>>();
  // a close catalog name is suggested
  expectTypeOf<V<"SELECT lowr(label) FROM things">>().toEqualTypeOf<SqlError<`function lowr(text) does not exist. Perhaps you meant the function "lower"? Otherwise declare it in the schema's $functions or in FunctionCatalog`, 1>>();
  // schema qualification is dropped; a known name whose overloads do not fit stays unknown
  expectTypeOf<Row<"SELECT pg_catalog.lower(label) AS a, lower(label, label) AS b FROM things">>().toEqualTypeOf<{ a: string; b: unknown }>();
});

test("every pg_catalog function is known; function-style casts are typed", () => {
  // pg_catalog functions without a curated signature (pg-functions.ts): return type from pg_proc, arguments unchecked
  expectTypeOf<Row<"SELECT has_table_privilege('things', 'select') AS a, pg_get_viewdef('v'::regclass) AS b, pg_table_size('things') AS c, txid_current_snapshot() AS d FROM things">>()
    .toEqualTypeOf<{ a: boolean; b: string; c: string; d: unknown }>();
  expectTypeOf<Row<"SELECT date(at) AS a, int8(id) AS b, float8(n_id) AS c, timestamp(day) AS d, numeric(id) AS e FROM things">>()
    .toEqualTypeOf<{ a: Date; b: string; c: number | null; d: Date; e: string }>();
  expectTypeOf<Row<"SELECT unaccent(label) AS a, similarity(label, 'x') AS b, levenshtein(label, 'x') AS c, enum_range(mood) AS d FROM things">>()
    .toEqualTypeOf<{ a: string; b: number; c: number; d: ("happy" | "sad")[] }>();
  // errors inside arguments still surface
  expectTypeOf<V<"SELECT lower(nope) FROM things">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 3>>();
  expectTypeOf<V<"SELECT count(*) FILTER (WHERE nope) FROM things">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 8>>();
});
