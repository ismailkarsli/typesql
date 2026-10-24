import { expectTypeOf, test } from "vitest";
import type { ApplyDdl, Col, Generated, Nullable, RowOf, ParamsOf, Validate, SqlError, DefaultTypeMap } from "../../src/index.js";
import type { KindOf } from "../../src/engine/index.js";

interface DB {
  items: {
    id: Generated<"int4">;
    name: Col<"text">;
    tags: Col<"text[]">;
    scores: Nullable<"int4[]">;
    data: Col<"jsonb">;
    pos: Nullable<"point">;
    addr: Nullable<"address">;
  };
  notes: { id: Generated<"int4">; body: Nullable<"text"> };
  logs: {
    id: Generated<"int8">;
    item_id: Col<"int4">;
    msg: Nullable<"text">;
  };
}

type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
type Params<Q extends string> = ParamsOf<DB, DefaultTypeMap, Q>;
type V<Q extends string> = Validate<DB, Q>;

test("subscripted and field assignment targets", () => {
  expectTypeOf<V<"UPDATE items SET tags[1] = 'a', scores[1:2] = '{1,2}', data['k'] = '1', addr.city = 'x', pos[0] = 1 WHERE id = 1">>().toEqualTypeOf<"UPDATE items SET tags[1] = 'a', scores[1:2] = '{1,2}', data['k'] = '1', addr.city = 'x', pos[0] = 1 WHERE id = 1">();
  expectTypeOf<V<"INSERT INTO items (name, tags[1:2], data['a']['b']) VALUES ('n', '{a,b}', '1')">>().toEqualTypeOf<"INSERT INTO items (name, tags[1:2], data['a']['b']) VALUES ('n', '{a,b}', '1')">();
  expectTypeOf<V<"INSERT INTO items (name, tags[1], tags[2], data) VALUES ('n', NULL, 'b', '{}') ON CONFLICT (id) DO UPDATE SET tags[1] = excluded.tags[1]">>().toEqualTypeOf<"INSERT INTO items (name, tags[1], tags[2], data) VALUES ('n', NULL, 'b', '{}') ON CONFLICT (id) DO UPDATE SET tags[1] = excluded.tags[1]">();
  expectTypeOf<V<"UPDATE items SET (tags[1], name) = ('a', 'b')">>().toEqualTypeOf<"UPDATE items SET (tags[1], name) = ('a', 'b')">();
  // a subscript is an expression of the statement's scope
  expectTypeOf<V<"UPDATE items SET tags[id] = name">>().toEqualTypeOf<"UPDATE items SET tags[id] = name">();
});

test("assignment target errors", () => {
  expectTypeOf<V<"UPDATE items SET name[1] = 'x'">>().toEqualTypeOf<SqlError<"cannot subscript type text because it does not support subscripting", 0>>();
  expectTypeOf<V<"UPDATE items SET data[1:2] = '1'">>().toEqualTypeOf<SqlError<"jsonb subscript does not support slices", 0>>();
  expectTypeOf<V<"UPDATE items SET nope[1] = 1">>().toEqualTypeOf<SqlError<'column "nope" of relation "items" does not exist. Perhaps you meant the column "name"?', 3>>();
  // SET targets are not qualified: `i.name` is field `name` of a column `i`
  expectTypeOf<V<"UPDATE items i SET i.name = 'x'">>().toEqualTypeOf<SqlError<'column "i" of relation "items" does not exist', 2>>();
  expectTypeOf<V<"INSERT INTO items (name, tags[nope]) VALUES ('a', 'b')">>().toEqualTypeOf<SqlError<'column "nope" does not exist. Perhaps you meant the column "name"?', 8>>();
});

test("parameters of indirected targets take the element / field type", () => {
  expectTypeOf<Params<"UPDATE items SET tags[$1] = $2, scores[1:2] = $3 WHERE id = $4">>().toEqualTypeOf<[number, string | null, (number | null)[] | null, number | null]>();
  expectTypeOf<Params<"INSERT INTO items (name, tags[1], data) VALUES ($1, $2, $3)">>().toEqualTypeOf<[string, string | null, unknown]>();
});

test("WHERE CURRENT OF", () => {
  expectTypeOf<Row<"DELETE FROM items WHERE CURRENT OF c RETURNING id">>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<V<"UPDATE items SET name = 'x' WHERE CURRENT OF c">>().toEqualTypeOf<"UPDATE items SET name = 'x' WHERE CURRENT OF c">();
});

test("RETURNING old / new (PostgreSQL 18)", () => {
  // INSERT: no old row
  expectTypeOf<Row<"INSERT INTO logs (item_id) VALUES (1) RETURNING old.id AS o, new.id AS n, id">>().toEqualTypeOf<{ o: string | null; n: string; id: string }>();
  expectTypeOf<Row<"INSERT INTO logs (item_id) VALUES (1) RETURNING old.*">>().toEqualTypeOf<{ id: string | null; item_id: number | null; msg: string | null }>();
  // UPDATE: both
  expectTypeOf<Row<"UPDATE logs SET msg = 'x' RETURNING old.msg AS before, new.msg AS after, old.item_id">>().toEqualTypeOf<{ before: string | null; after: string | null; item_id: number }>();
  // DELETE: no new row
  expectTypeOf<Row<"DELETE FROM logs RETURNING old.item_id AS o, new.item_id AS n">>().toEqualTypeOf<{ o: number; n: number | null }>();
  // whole rows, sub-queries, renamed with WITH (...)
  expectTypeOf<Row<"UPDATE logs SET msg = 'x' RETURNING (SELECT old.item_id + 1) AS next">>().toEqualTypeOf<{ next: number | null }>();
  expectTypeOf<Row<"UPDATE logs SET msg = 'x' RETURNING WITH (OLD AS o, NEW AS n) o.msg AS a, n.msg AS b">>().toEqualTypeOf<{ a: string | null; b: string | null }>();
  // `*` stays the target's columns
  expectTypeOf<Row<"DELETE FROM logs RETURNING *">>().toEqualTypeOf<{ id: string; item_id: number; msg: string | null }>();
});

test("RETURNING old / new: Postgres's errors and masking", () => {
  expectTypeOf<V<"INSERT INTO logs (item_id) VALUES (1) RETURNING WITH (new AS logs) *">>().toEqualTypeOf<SqlError<'table name "logs" specified more than once', 2>>();
  expectTypeOf<V<"INSERT INTO logs (item_id) VALUES (1) RETURNING WITH (old AS o, new AS n, old AS o) *">>().toEqualTypeOf<SqlError<"OLD cannot be specified multiple times", 0>>();
  expectTypeOf<V<"INSERT INTO logs (item_id) VALUES (1) RETURNING WITH (old AS o, new AS n, new AS n) *">>().toEqualTypeOf<SqlError<"NEW cannot be specified multiple times", 0>>();
  expectTypeOf<V<"INSERT INTO logs (item_id) VALUES (1) RETURNING WITH (old AS x, new AS x) *">>().toEqualTypeOf<SqlError<'table name "x" specified more than once', 15>>();
  // renamed: `old` is no longer a name
  expectTypeOf<V<"UPDATE logs SET msg = 'x' RETURNING WITH (OLD AS o) old.msg">>().toEqualTypeOf<SqlError<'missing FROM-clause entry for table "old"', 9>>();
  // a FROM item named `old` masks the default
  expectTypeOf<Row<"UPDATE logs SET msg = old.name FROM items old WHERE old.id = logs.item_id RETURNING old.name">>().toEqualTypeOf<{ name: string }>();
  // old / new columns are not reachable unqualified
  expectTypeOf<V<"DELETE FROM logs RETURNING nope">>().toEqualTypeOf<SqlError<'column "nope" does not exist', 4>>();
});

test("INSERT ... SELECT with an empty target list", () => {
  expectTypeOf<V<"INSERT INTO notes SELECT RETURNING id">>().toEqualTypeOf<"INSERT INTO notes SELECT RETURNING id">();
});

test("SELECT INTO creates a table", () => {
  expectTypeOf<KindOf<DB, "SELECT id, name INTO TEMP TABLE copy FROM items">>().toEqualTypeOf<"create_table_as">();
  expectTypeOf<Row<"SELECT id, name INTO copy FROM items">>().toEqualTypeOf<never>();
  type DB2 = ApplyDdl<DB, "SELECT id, name AS label INTO copy FROM items WHERE id > 1">;
  expectTypeOf<RowOf<DB2, DefaultTypeMap, "SELECT * FROM copy">>().toEqualTypeOf<{ id: number | null; label: string | null }>();
  expectTypeOf<V<"SELECT * FROM (SELECT 1 INTO f) bar">>().toEqualTypeOf<SqlError<"SELECT ... INTO is not allowed here", 6>>();
  expectTypeOf<V<"INSERT INTO logs (item_id) SELECT 1 INTO f">>().toEqualTypeOf<SqlError<"SELECT ... INTO is not allowed here", 8>>();
});
