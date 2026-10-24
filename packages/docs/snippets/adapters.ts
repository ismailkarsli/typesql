import type { RowType } from "@typesql/core";
import { check, type Equal } from "./_check.js";
import type { DB } from "./schema.js";

// #region pg
import { Pool } from "pg";
import { createSql, migrate } from "@typesql/pg";

const pool = new Pool();
const sql = createSql<DB>(pool); // queries run on `pool`

const users = await sql("SELECT id, email FROM users").execute(); // { id: number; email: string }[]
const maybe = await sql("SELECT id FROM users WHERE email = $1", "x").executeTakeFirst(); // row | undefined
const user = await sql("SELECT id, email FROM users WHERE id = $1", 7).executeTakeFirstOrThrow(); // row, or NoResultError
const changed = await sql("UPDATE users SET display_name = NULL").executeCount(); // row count

const id = await sql.transaction(async (tx) => {
  const { id } = await tx("INSERT INTO users (email) VALUES ($1) RETURNING id", "a@b.c").executeTakeFirstOrThrow();
  await tx("INSERT INTO posts (author_id, title) VALUES ($1, $2)", id, "Hello").execute();
  return id;
});
// #endregion pg
// #region transaction
const postId = await sql.transaction(async (tx) => {
  // tx is sql bound to the transaction: same type, same helpers
  const { id } = await tx("INSERT INTO posts (author_id, title) VALUES ($1, $2) RETURNING id", 7, "Draft").executeTakeFirstOrThrow();
  try {
    await tx.transaction(async (inner) => {
      // a savepoint: when this throws, only what ran inside it is rolled back
      await inner("UPDATE users SET display_name = $1 WHERE id = $2", "Author", 7).execute();
    });
  } catch {
    // the post stays
  }
  return id;
});
// #endregion transaction
// #region execute-per-call
import { executor } from "@typesql/pg";

const client = await pool.connect(); // a client you manage yourself
try {
  await sql("UPDATE users SET display_name = NULL WHERE id = $1", 7).execute(executor(client)); // on `client`
  await createSql<DB>(client)("DELETE FROM posts WHERE author_id = $1", 7).execute(); // or bind a sql to it
} finally {
  client.release();
}
// #endregion execute-per-call
// #region custom-executor
import { createSql as createCoreSql, type Executor } from "@typesql/core";
import type { PgTypeMap } from "@typesql/pg";

const onPool = executor(pool);
const logged: Executor = async (text, values) => {
  const started = performance.now();
  try {
    return await onPool(text, values); // { rows, rowCount }: executeCount keeps working
  } finally {
    console.debug(`${Math.round(performance.now() - started)} ms`, text);
  }
};
const sqlLogged = createCoreSql<DB, PgTypeMap>(logged);
// #endregion custom-executor
// #region transform-helper
import type { Query } from "@typesql/core";

/** Rows as they go out as JSON: dates become ISO strings. */
type Wire<Row> = { [K in keyof Row]: Row[K] extends Date ? string : Row[K] };
const toWire = (row: object) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));

async function wire<Q extends Query<object>>(q: Q): Promise<Wire<RowType<Q>>[]> {
  return (await q.execute()).map(toWire) as Wire<RowType<Q>>[];
}

const payload = await wire(sql("SELECT id, created_at FROM users")); // { id: number; created_at: string }[]
// #endregion transform-helper
check<Equal<typeof payload, { id: number; created_at: string }[]>>();
check<Equal<Awaited<ReturnType<ReturnType<typeof sqlLogged<"SELECT id FROM users">>["executeCount"]>>, number>>();
check<Equal<typeof users, { id: number; email: string }[]>>();
check<Equal<typeof maybe, { id: number } | undefined>>();
check<Equal<typeof user, { id: number; email: string }>>();
check<Equal<typeof changed, number>>();
check<Equal<typeof id, number>>();
check<Equal<typeof postId, string>>();
void migrate;

// #region postgresjs
import postgres from "postgres";
import * as pgjs from "@typesql/postgres";

const db = postgres(process.env["DATABASE_URL"]!);
const sqlJs = pgjs.createSql<DB>(db); // PostgresJsTypeMap
const posts = await sqlJs("SELECT id, title FROM posts WHERE author_id = $1", 1).execute();
// { id: string; title: string }[]   int8 is a string by default

// with bigint parsing enabled on the connection
const dbBig = postgres(process.env["DATABASE_URL"]!, { types: { bigint: postgres.BigInt } });
const big = pgjs.createSql<DB>(dbBig, { bigint: true }); // PostgresJsBigIntTypeMap
const counts = await big("SELECT author_id, count(*) AS n FROM posts GROUP BY author_id").execute();
// { author_id: number; n: bigint }[]

await sqlJs.transaction(async (tx) => {
  await tx("UPDATE posts SET title = upper(title) WHERE author_id = $1", 1).execute();
});
// #endregion postgresjs
check<Equal<typeof posts, { id: string; title: string }[]>>();
check<Equal<typeof counts, { author_id: number; n: bigint }[]>>();
check<Equal<RowType<ReturnType<typeof sql<"SELECT count(*) AS n FROM posts">>>, { n: string }>>();
