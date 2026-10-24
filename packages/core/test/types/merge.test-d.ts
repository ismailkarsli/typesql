import { expectTypeOf, test } from "vitest";
import { createSql, type Col, type Generated, type Nullable, type View, type RowOf, type ParamsOf, type Validate, type SqlError, type DefaultTypeMap } from "../../src/index.js";
import type { KindOf } from "../../src/engine/index.js";

interface DB {
  accounts: {
    id: Col<"int4">;
    balance: Col<"numeric">;
    note: Nullable<"text">;
    created_at: Generated<"timestamptz">;
  };
  deltas: {
    sid: Col<"int4">;
    delta: Col<"numeric">;
    label: Nullable<"text">;
  };
  active_accounts: View<{ id: Col<"int4"> }>;
}

const sql = createSql<DB>();
type Row<Q extends string> = RowOf<DB, DefaultTypeMap, Q>;
type Params<Q extends string> = ParamsOf<DB, DefaultTypeMap, Q>;
type V<Q extends string> = Validate<DB, Q>;

test("MERGE without RETURNING has no row type", () => {
  type Q = "MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN UPDATE SET balance = a.balance + d.delta WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (d.sid, d.delta)";
  expectTypeOf<V<Q>>().toEqualTypeOf<Q>();
  expectTypeOf<KindOf<DB, Q>>().toEqualTypeOf<"merge">();
  expectTypeOf<Row<Q>>().toEqualTypeOf<never>();
});

test("every WHEN form parses and validates", () => {
  type Q = `MERGE INTO ONLY accounts AS a USING (SELECT sid, delta FROM deltas WHERE delta > 0) AS d ON a.id = d.sid
    WHEN MATCHED AND a.balance > 100 THEN DELETE
    WHEN MATCHED AND d.delta = 0 THEN DO NOTHING
    WHEN MATCHED THEN UPDATE SET (balance, note) = (a.balance + d.delta, 'x')
    WHEN NOT MATCHED BY SOURCE AND a.balance = 0 THEN DELETE
    WHEN NOT MATCHED BY SOURCE THEN UPDATE SET note = 'orphan'
    WHEN NOT MATCHED BY TARGET AND d.delta > 1 THEN INSERT VALUES (d.sid, d.delta)
    WHEN NOT MATCHED THEN INSERT (id, balance, note) OVERRIDING USER VALUE VALUES (d.sid, d.delta, DEFAULT)`;
  expectTypeOf<V<Q>>().toEqualTypeOf<Q>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d JOIN accounts x ON x.id = d.sid ON a.id = d.sid WHEN MATCHED THEN DELETE">>().toEqualTypeOf<"MERGE INTO accounts a USING deltas d JOIN accounts x ON x.id = d.sid ON a.id = d.sid WHEN MATCHED THEN DELETE">();
  expectTypeOf<V<"MERGE INTO accounts a USING generate_series(1, 3) AS g ON a.id = g WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (g, 0)">>().toEqualTypeOf<"MERGE INTO accounts a USING generate_series(1, 3) AS g ON a.id = g WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (g, 0)">();
});

test("RETURNING: merge_action(), target, source and old / new", () => {
  expectTypeOf<Row<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN UPDATE SET balance = d.delta RETURNING merge_action(), a.*, d.label">>().toEqualTypeOf<{
    merge_action: string; id: number; balance: string; note: string | null; created_at: Date; label: string | null;
  }>();
  // NOT MATCHED BY SOURCE rows have no source row: its columns are NULL there
  expectTypeOf<Row<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED BY SOURCE THEN DELETE RETURNING a.id, d.sid">>().toEqualTypeOf<{ id: number; sid: number | null }>();
  // ... unless that action is DO NOTHING (no row is returned)
  expectTypeOf<Row<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED BY SOURCE THEN DO NOTHING WHEN MATCHED THEN DELETE RETURNING d.sid">>().toEqualTypeOf<{ sid: number }>();
  // old is NULL for inserted rows, new for deleted rows
  expectTypeOf<Row<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN UPDATE SET balance = 1 RETURNING old.balance AS was, new.balance AS now">>().toEqualTypeOf<{ was: string; now: string }>();
  expectTypeOf<Row<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN DELETE WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (d.sid, 0) RETURNING old.balance AS was, new.balance AS now">>().toEqualTypeOf<{ was: string | null; now: string | null }>();
  expectTypeOf<Row<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (d.sid, 0) RETURNING WITH (OLD AS o, NEW AS n) o.id AS o_id, n.id AS n_id">>().toEqualTypeOf<{ o_id: number | null; n_id: number }>();
});

test("MERGE in a CTE and WITH ... MERGE", () => {
  expectTypeOf<Row<"WITH m AS (MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN DELETE RETURNING a.id, merge_action() AS act) SELECT id, act FROM m">>().toEqualTypeOf<{ id: number; act: string }>();
  expectTypeOf<Row<"WITH src AS (SELECT sid, delta FROM deltas) MERGE INTO accounts a USING src ON a.id = src.sid WHEN MATCHED THEN UPDATE SET balance = src.delta RETURNING a.balance">>().toEqualTypeOf<{ balance: string }>();
  expectTypeOf<V<"WITH m AS (MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN DELETE) SELECT * FROM m">>().toEqualTypeOf<SqlError<'WITH query "m" does not have a RETURNING clause', 1>>();
});

test("scopes: each WHEN clause sees what Postgres lets it see", () => {
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (a.id, d.delta)">>().toEqualTypeOf<SqlError<'invalid reference to FROM-clause entry for table "a"', 3>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED AND a.balance = 1 THEN DO NOTHING">>().toEqualTypeOf<SqlError<'invalid reference to FROM-clause entry for table "a"', 3>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED BY SOURCE AND d.delta = 1 THEN DELETE">>().toEqualTypeOf<SqlError<'invalid reference to FROM-clause entry for table "d"', 6>>();
  expectTypeOf<V<"MERGE INTO accounts a USING (SELECT * FROM deltas WHERE a.id > sid) d ON a.id = d.sid WHEN MATCHED THEN DELETE">>().toEqualTypeOf<SqlError<'invalid reference to FROM-clause entry for table "a"', 3>>();
  // the matched clauses see both: an unqualified name in both is ambiguous
  expectTypeOf<V<"MERGE INTO accounts a USING accounts b ON a.id = b.id WHEN MATCHED THEN UPDATE SET balance = balance + 1">>().toEqualTypeOf<SqlError<'column reference "balance" is ambiguous', 20>>();
});

test("semantic errors", () => {
  expectTypeOf<V<"MERGE INTO accounts USING accounts ON true WHEN MATCHED THEN DO NOTHING">>().toEqualTypeOf<SqlError<'name "accounts" specified more than once', 2>>();
  expectTypeOf<V<"MERGE INTO active_accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN DELETE">>().toEqualTypeOf<SqlError<'cannot merge into view "active_accounts"', 2>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN UPDATE SET nope = 1">>().toEqualTypeOf<SqlError<'column "nope" of relation "accounts" does not exist. Perhaps you meant the column "note"?', 20>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN INSERT (id) VALUES (d.sid)">>().toEqualTypeOf<SqlError<'null value in column "balance" of relation "accounts" violates not-null constraint', 2>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN INSERT (id, balance) VALUES (d.sid)">>().toEqualTypeOf<SqlError<"INSERT has more target columns than expressions", 0>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN INSERT DEFAULT VALUES">>().toEqualTypeOf<SqlError<'null value in column "id" of relation "accounts" violates not-null constraint', 10>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN DELETE WHEN MATCHED AND d.delta > 0 THEN DO NOTHING">>().toEqualTypeOf<SqlError<"unreachable WHEN clause specified after unconditional WHEN clause", 0>>();
});

test("syntax errors", () => {
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid">>().toEqualTypeOf<SqlError<"syntax error: expected WHEN at or near end of input", 15>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN MATCHED THEN INSERT DEFAULT VALUES">>().toEqualTypeOf<SqlError<"syntax error: expected UPDATE, DELETE or DO NOTHING at or near insert", 18>>();
  expectTypeOf<V<"MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN DELETE">>().toEqualTypeOf<SqlError<"syntax error: expected INSERT or DO NOTHING at or near delete", 19>>();
  expectTypeOf<V<"MERGE accounts USING deltas ON true WHEN MATCHED THEN DELETE">>().toEqualTypeOf<SqlError<"syntax error: expected INTO at or near accounts", 1>>();
});

test("parameters take their context's type", () => {
  expectTypeOf<Params<"MERGE INTO accounts a USING deltas d ON a.id = d.sid AND d.delta > $1 WHEN MATCHED AND a.note = $2 THEN UPDATE SET balance = $3, note = $4 WHEN NOT MATCHED THEN INSERT (id, balance, note) VALUES ($5, $6, $7)">>().toEqualTypeOf<
    [string | number | bigint | null, string | null, string | number | bigint, string | null, number, string | number | bigint, string | null]
  >();
  expectTypeOf<Params<"MERGE INTO accounts a USING (SELECT * FROM deltas WHERE sid = $1) d ON a.id = d.sid WHEN MATCHED THEN DELETE RETURNING $2::text AS tag">>().toEqualTypeOf<[number | null, string]>();
});

test("sql() call sites", () => {
  sql("MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN INSERT (id, balance) VALUES ($1, $2)", 1, "10");
  // @ts-expect-error wrong parameter type
  sql("MERGE INTO accounts a USING deltas d ON a.id = d.sid WHEN NOT MATCHED THEN INSERT (id, balance) VALUES ($1, $2)", "x", "10");
});
