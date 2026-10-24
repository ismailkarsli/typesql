import { expectTypeOf, test } from "vitest";
import { createSql, type ApplyDdl, type Col, type DefaultTypeMap, type Generated, type Nullable, type ParamsOf, type RowOf, type RowType, type SqlError, type Validate } from "../../src/index.js";
import type { KindOf } from "../../src/engine/index.js";

interface DB {
  users: { id: Generated<"int4">; email: Col<"text">; name: Nullable<"text"> };
}
type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
type Params<Q extends string> = ParamsOf<DB, DefaultTypeMap, Q>;
type V<Q extends string> = Validate<DB, Q>;

test("DECLARE checks its query and types its parameters; it returns no rows", () => {
  expectTypeOf<KindOf<DB, "DECLARE c CURSOR FOR SELECT * FROM users">>().toEqualTypeOf<"declare_cursor">();
  expectTypeOf<Row<"DECLARE c CURSOR FOR SELECT * FROM users">>().toEqualTypeOf<never>();
  expectTypeOf<V<"DECLARE c NO SCROLL CURSOR WITH HOLD FOR SELECT id FROM users ORDER BY id FOR UPDATE">>().toEqualTypeOf<"DECLARE c NO SCROLL CURSOR WITH HOLD FOR SELECT id FROM users ORDER BY id FOR UPDATE">();
  expectTypeOf<V<"DECLARE c BINARY INSENSITIVE SCROLL CURSOR WITHOUT HOLD FOR WITH t AS (SELECT 1 AS x) TABLE t">>().toEqualTypeOf<"DECLARE c BINARY INSENSITIVE SCROLL CURSOR WITHOUT HOLD FOR WITH t AS (SELECT 1 AS x) TABLE t">();
  expectTypeOf<V<"DECLARE c CURSOR FOR VALUES (1), (2)">>().toEqualTypeOf<"DECLARE c CURSOR FOR VALUES (1), (2)">();
  expectTypeOf<Params<"DECLARE c CURSOR FOR SELECT email FROM users WHERE id = $1 AND name = $2">>().toEqualTypeOf<[number | null, string | null]>();
});

test("DECLARE errors", () => {
  expectTypeOf<V<"DECLARE c CURSOR FOR SELECT nope FROM users">>().toEqualTypeOf<SqlError<'column "nope" does not exist. Perhaps you meant the column "name"?', 5>>();
  expectTypeOf<V<"DECLARE c CURSOR FOR SELECT 1 INTO t">>().toEqualTypeOf<SqlError<"SELECT ... INTO is not allowed here", 6>>();
  expectTypeOf<V<"DECLARE c CURSOR FOR INSERT INTO users (email) VALUES ('a')">>().toEqualTypeOf<SqlError<"syntax error: expected SELECT, VALUES, TABLE or ( at or near insert", 4>>();
  expectTypeOf<V<"DECLARE c FOR SELECT 1">>().toEqualTypeOf<SqlError<"syntax error: expected CURSOR at or near for", 2>>();
});

test("FETCH / MOVE / CLOSE: every direction form; FETCH has no row type (the cursor's query is another statement)", () => {
  expectTypeOf<KindOf<DB, "FETCH 10 FROM c">>().toEqualTypeOf<"fetch">();
  expectTypeOf<KindOf<DB, "MOVE BACKWARD ALL IN c">>().toEqualTypeOf<"move">();
  expectTypeOf<KindOf<DB, "CLOSE ALL">>().toEqualTypeOf<"close_cursor">();
  expectTypeOf<Row<"FETCH ALL FROM c">>().toEqualTypeOf<never>();
  expectTypeOf<V<"FETCH c">>().toEqualTypeOf<"FETCH c">();
  expectTypeOf<V<"FETCH next">>().toEqualTypeOf<"FETCH next">(); // a cursor named "next"
  expectTypeOf<V<"FETCH NEXT c">>().toEqualTypeOf<"FETCH NEXT c">();
  expectTypeOf<V<"FETCH PRIOR FROM c">>().toEqualTypeOf<"FETCH PRIOR FROM c">();
  expectTypeOf<V<"FETCH FIRST IN c">>().toEqualTypeOf<"FETCH FIRST IN c">();
  expectTypeOf<V<"FETCH LAST c">>().toEqualTypeOf<"FETCH LAST c">();
  expectTypeOf<V<"FETCH ABSOLUTE -1 FROM c">>().toEqualTypeOf<"FETCH ABSOLUTE -1 FROM c">();
  expectTypeOf<V<"FETCH RELATIVE 0 FROM c">>().toEqualTypeOf<"FETCH RELATIVE 0 FROM c">();
  expectTypeOf<V<"FETCH 3 c">>().toEqualTypeOf<"FETCH 3 c">();
  expectTypeOf<V<"FETCH FORWARD FROM c">>().toEqualTypeOf<"FETCH FORWARD FROM c">();
  expectTypeOf<V<"FETCH BACKWARD 2 FROM c">>().toEqualTypeOf<"FETCH BACKWARD 2 FROM c">();
  expectTypeOf<V<"MOVE FORWARD ALL IN c">>().toEqualTypeOf<"MOVE FORWARD ALL IN c">();
  expectTypeOf<V<"CLOSE c">>().toEqualTypeOf<"CLOSE c">();
  expectTypeOf<V<"FETCH ABSOLUTE FROM c">>().toEqualTypeOf<SqlError<"syntax error: expected integer at or near from", 2>>();
  expectTypeOf<V<"FETCH 1 2">>().toEqualTypeOf<SqlError<"syntax error: expected cursor name at or near 2", 2>>();
  expectTypeOf<V<"CLOSE">>().toEqualTypeOf<SqlError<"syntax error: expected cursor name or ALL at or near end of input", 1>>();
});

test("sql() over cursor statements", () => {
  const sql = createSql<DB>();
  const d = sql("DECLARE c CURSOR WITH HOLD FOR SELECT email FROM users WHERE id = $1", 1);
  expectTypeOf<RowType<typeof d>>().toEqualTypeOf<never>();
  sql("FETCH FORWARD 10 FROM c");
  sql("CLOSE c");
  // @ts-expect-error the parameter is a number
  sql("DECLARE c CURSOR FOR SELECT email FROM users WHERE id = $1", "x");
  expectTypeOf<V<"DECLARE c CURSOR FOR SELECT nope FROM users">>().toEqualTypeOf<SqlError<'column "nope" does not exist. Perhaps you meant the column "name"?', 5>>();
});

test("cursor statements in a migration script leave the schema unchanged; DECLARE is checked", () => {
  expectTypeOf<ApplyDdl<DB, "BEGIN; DECLARE c SCROLL CURSOR FOR SELECT * FROM users; FETCH 2 FROM c; MOVE ABSOLUTE 1 IN c; CLOSE c; END; ABORT">>().toEqualTypeOf<DB>();
  expectTypeOf<ApplyDdl<DB, "DECLARE c CURSOR FOR SELECT nope FROM users">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 5>>();
});
