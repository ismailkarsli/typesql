import { expectTypeOf, test } from "vitest";
import type { SqlError } from "../../src/index.js";
import type { IdTok, Lex, NumTok, OpTok, ParamTok, StrTok, WordTok } from "../../src/engine/index.js";
import type { Row, V } from "./_schema.js";

/** Token values only, for compact assertions. */
type Vals<Q extends string> = Lex<Q> extends infer T ? (T extends readonly unknown[] ? { [K in keyof T]: T[K] extends { readonly v: infer V } ? V : never } : T) : never;

test("words fold to lowercase; quoted identifiers keep case and unescape \"\"", () => {
  expectTypeOf<Lex<'SELECT Foo, "Bar", "a""b"'>>().toEqualTypeOf<[WordTok<"select">, WordTok<"foo">, OpTok<",">, IdTok<"Bar">, OpTok<",">, IdTok<'a"b'>]>();
  // non-ASCII identifier characters are accepted; only ASCII letters fold
  expectTypeOf<Vals<"SELECT Café, naïve">>().toEqualTypeOf<["select", "café", ",", "naïve"]>();
});

test("string literals: '' escapes, E'' (escapes kept raw), B'' / X'', dollar quoting", () => {
  expectTypeOf<Lex<"SELECT 'it''s'">>().toEqualTypeOf<[WordTok<"select">, StrTok<"it's">]>();
  expectTypeOf<Lex<"SELECT E'a\\'b'">>().toEqualTypeOf<[WordTok<"select">, StrTok<"a\\'b">]>();
  expectTypeOf<Lex<"SELECT X'1F', B'101'">>().toEqualTypeOf<[WordTok<"select">, StrTok<"1F">, OpTok<",">, StrTok<"101">]>();
  expectTypeOf<Lex<"SELECT $$it's $1$$, $fn$ a $$ b $fn$">>().toEqualTypeOf<[WordTok<"select">, StrTok<"it's $1">, OpTok<",">, StrTok<" a $$ b ">]>();
});

test("numbers", () => {
  expectTypeOf<Vals<"SELECT 1, 1.5, .5, 1., 1e3, 2.5E-2, 0x1F, 1_000">>().toEqualTypeOf<
    ["select", "1", ",", "1.5", ",", ".5", ",", "1.", ",", "1e3", ",", "2.5E-2", ",", "0x1F", ",", "1_000"]
  >();
  expectTypeOf<Lex<"SELECT 42">>().toEqualTypeOf<[WordTok<"select">, NumTok<"42">]>();
});

test("parameters $1..$99", () => {
  expectTypeOf<Lex<"SELECT $1, $10, $99">>().toEqualTypeOf<[WordTok<"select">, ParamTok<1>, OpTok<",">, ParamTok<10>, OpTok<",">, ParamTok<99>]>();
});

test("operators use longest match", () => {
  expectTypeOf<Vals<"a::int ->> b #>> c !~* d <> e != f || g @> h <@ i ?| j ?& k @? l #- m <= n >= o">>().toEqualTypeOf<
    ["a", "::", "int", "->>", "b", "#>>", "c", "!~*", "d", "<>", "e", "!=", "f", "||", "g", "@>", "h", "<@", "i", "?|", "j", "?&", "k", "@?", "l", "#-", "m", "<=", "n", ">=", "o"]
  >();
  expectTypeOf<Vals<"a->b">>().toEqualTypeOf<["a", "->", "b"]>();
  // fast paths: punctuation without lookahead, `=` / `:` / `.` with one character of lookahead
  expectTypeOf<Vals<"f(a,b);x[1]+-y*z%2^3">>().toEqualTypeOf<["f", "(", "a", ",", "b", ")", ";", "x", "[", "1", "]", "+", "-", "y", "*", "z", "%", "2", "^", "3"]>();
  expectTypeOf<Vals<"a=b c=>d e:=f g::h :i j:k">>().toEqualTypeOf<["a", "=", "b", "c", "=>", "d", "e", ":=", "f", "g", "::", "h", ":", "i", "j", ":", "k"]>();
  expectTypeOf<Vals<"t.c .5 t.*">>().toEqualTypeOf<["t", ".", "c", ".5", "t", ".", "*"]>();
  // a word starting with e / b / x is only a string prefix when a quote follows
  expectTypeOf<Lex<"e x'1' ex b'0' bx E''">>().toEqualTypeOf<[WordTok<"e">, StrTok<"1">, WordTok<"ex">, StrTok<"0">, WordTok<"bx">, StrTok<"">]>();
});

test("operators follow Postgres's rules: any run of operator characters, trailing + / - split off", () => {
  // user-defined and geometric operators are single tokens
  expectTypeOf<Vals<"a *= b ~<~ c |>> d <<| e &<| f @-@ g !=- h">>().toEqualTypeOf<["a", "*=", "b", "~<~", "c", "|>>", "d", "<<|", "e", "&<|", "f", "@-@", "g", "!=-", "h"]>();
  // a trailing + / - is a separate token unless the operator has one of ~ ! @ # ^ & | ` ? %
  expectTypeOf<Vals<"a+-b c*-1 d<-e f@-g">>().toEqualTypeOf<["a", "+", "-", "b", "c", "*", "-", "1", "d", "<", "-", "e", "f", "@-", "g"]>();
  // comments end an operator
  expectTypeOf<Vals<"a+--c\nb */*x*/ c">>().toEqualTypeOf<["a", "+", "b", "*", "c"]>();
});

test("comments are skipped, including nested block comments", () => {
  expectTypeOf<Vals<"SELECT 1 -- trailing\n, 2 /* block */ , /* outer /* inner */ still comment */ 3">>().toEqualTypeOf<["select", "1", ",", "2", ",", "3"]>();
  expectTypeOf<Vals<"SELECT 1 -- no newline at the end">>().toEqualTypeOf<["select", "1"]>();
});

test("lexer errors carry the index of the token that could not be produced", () => {
  expectTypeOf<Lex<"SELECT 'abc">>().toEqualTypeOf<SqlError<"unterminated quoted string", 1>>();
  expectTypeOf<Lex<'SELECT "abc'>>().toEqualTypeOf<SqlError<"unterminated quoted identifier", 1>>();
  expectTypeOf<Lex<"SELECT 1 /* open">>().toEqualTypeOf<SqlError<"unterminated /* comment", 2>>();
  expectTypeOf<Lex<"SELECT 1 /* a /* b */">>().toEqualTypeOf<SqlError<"unterminated /* comment", 2>>();
  expectTypeOf<Lex<"SELECT $$abc">>().toEqualTypeOf<SqlError<"unterminated dollar-quoted string", 1>>();
});

test("string literals: continuation across newlines, E'' backslash parity, U&'' / U&\"\" with UESCAPE", () => {
  // adjacent literals separated by whitespace with a newline are one literal; on one line they are two tokens
  expectTypeOf<Vals<"SELECT 'a'\n  'b'\n'c', 'x' 'y'">>().toEqualTypeOf<["select", "abc", ",", "x", "y"]>();
  // `\\` before the closing quote is an escaped backslash, not an escaped quote
  expectTypeOf<Vals<"SELECT E'\\\\', e'a\\'b'">>().toEqualTypeOf<["select", "\\\\", ",", "a\\'b"]>();
  // U& identifiers are decoded (ASCII / Latin-1 code points); U& string values stay raw
  expectTypeOf<Vals<"SELECT U&'d\\0061t' AS U&\"d\\0061t\\+000061\"">>().toEqualTypeOf<["select", "d\\0061t", "as", "data"]>();
  expectTypeOf<Vals<"SELECT 1 AS U&\"d*0061t\\+000061\" UESCAPE '*'">>().toEqualTypeOf<["select", "1", "as", "dat\\+000061"]>();
  expectTypeOf<Row<"SELECT 1 AS U&\"\\00E4\"">>().toEqualTypeOf<{ "\u00e4": number }>();
});

test("Unicode escapes are validated like Postgres", () => {
  expectTypeOf<Lex<"SELECT U&'\\061'">>().toEqualTypeOf<SqlError<"invalid Unicode escape", 1>>();
  expectTypeOf<Lex<"SELECT U&'\\db99'">>().toEqualTypeOf<SqlError<"invalid Unicode surrogate pair", 1>>();
  expectTypeOf<Lex<"SELECT U&'\\+2FFFFF'">>().toEqualTypeOf<SqlError<"invalid Unicode escape value", 1>>();
  expectTypeOf<Lex<"SELECT E'\\udb99\\udc00 ok', E'\\u061'">>().toEqualTypeOf<SqlError<"invalid Unicode escape", 3>>();
  expectTypeOf<Lex<"SELECT U&'x' UESCAPE +">>().toEqualTypeOf<SqlError<'UESCAPE must be followed by a simple string literal at or near "+"', 1>>();
  expectTypeOf<Lex<"SELECT U&'x' UESCAPE '+'">>().toEqualTypeOf<SqlError<"invalid Unicode escape character at or near \"'+'\"", 1>>();
  expectTypeOf<Lex<'SELECT 1 AS ""'>>().toEqualTypeOf<SqlError<'zero-length delimited identifier at or near """"', 3>>();
});

test("numbers: digit separators, radix prefixes and trailing junk follow Postgres 16+", () => {
  expectTypeOf<Vals<"SELECT 0x_42F, 0b101, 0o17, 1_000.5e1, 12.e-3, 1..2">>().toEqualTypeOf<
    ["select", "0x_42F", ",", "0b101", ",", "0o17", ",", "1_000.5e1", ",", "12.e-3", ",", "1", ".", ".2"]
  >();
  expectTypeOf<Lex<"SELECT 123abc">>().toEqualTypeOf<SqlError<'trailing junk after numeric literal at or near "123a"', 1>>();
  expectTypeOf<Lex<"SELECT 100__000">>().toEqualTypeOf<SqlError<'trailing junk after numeric literal at or near "100_"', 1>>();
  expectTypeOf<Lex<"SELECT 0.0e+a">>().toEqualTypeOf<SqlError<'trailing junk after numeric literal at or near "0.0e+"', 1>>();
  expectTypeOf<Lex<"SELECT 0x">>().toEqualTypeOf<SqlError<'invalid hexadecimal integer at or near "0x"', 1>>();
  expectTypeOf<Lex<"SELECT $1a">>().toEqualTypeOf<SqlError<'trailing junk after parameter at or near "$1a"', 1>>();
  // digit separators do not count towards the int4 / int8 / numeric choice; very long literals are numeric
  type D1200 = `${"1234567890123456789012345678901234567890"}${"1234567890123456789012345678901234567890"}`;
  type Long = `${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}${D1200}`;
  expectTypeOf<Row<`SELECT 1_000_000_000 AS a, ${Long} AS b`>>().toEqualTypeOf<{ a: number; b: string }>();
});

test("lexing feeds the engine end to end", () => {
  expectTypeOf<Row<'SELECT "id" AS "Id", label AS "Label" FROM things'>>().toEqualTypeOf<{ Id: number; Label: string }>();
  expectTypeOf<V<"SELECT id FROM things WHERE label = 'a''b' -- comment">>().toEqualTypeOf<"SELECT id FROM things WHERE label = 'a''b' -- comment">();
});

test("long statements are lexed in chunks (4 KB, > 1000 tokens)", () => {
  type Q8 = "SELECT id, label, id + 1 AS a, label || 'x' AS b FROM things WHERE id > 0 AND label <> 'zzz' ";
  type Q64 = `${Q8}${Q8}${Q8}${Q8}${Q8}${Q8}${Q8}${Q8}`;
  type Big = `${Q64}${Q64}${Q64}${Q64}${Q64}${Q64}`;
  expectTypeOf<Lex<Big>["length"]>().toEqualTypeOf<1248>();
});
