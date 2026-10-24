// TypeSQL with postgres.js (@typesql/postgres). Queries run with sql.unsafe(text, values), and rows
// are typed by what postgres.js parses: int8 is a string, or a bigint with BigInt parsing on.
import type { Sql } from "postgres";
import { createSql } from "@typesql/postgres";
import type { Col, Generated, Nullable } from "@typesql/core";

interface DB {
  users: {
    id: Generated<"int4">;
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
  };
  posts: {
    id: Generated<"int8">;
    author_id: Col<"int4">;
    title: Col<"text">;
    tags: Col<"text[]">;
  };
}

declare const db: Sql; // postgres("postgres://localhost/app")
const sql = createSql<DB>(db);

const posts = await sql(`SELECT id, title, tags FROM posts WHERE $1 = ANY (tags)`, "sql").execute();
//    ^?

// On a connection with `types: { bigint: postgres.BigInt }`, int8 and count(*) come back as bigint.
declare const dbBig: Sql<{ bigint: bigint }>;
const big = createSql<DB>(dbBig, { bigint: true });
const counts = await big(`SELECT author_id, count(*) AS n FROM posts GROUP BY author_id`).execute();
//    ^?

// sql.transaction is sql.begin; tx.transaction is a savepoint.
await sql.transaction(async (tx) => {
  await tx(`UPDATE posts SET title = upper(title) WHERE author_id = $1`, 7).execute();
  const n = await tx(`DELETE FROM posts WHERE cardinality(tags) = 0`).executeCount();
  //    ^?
});

sql(`SELECT id FROM posts WHERE tags @> $1`, "sql"); // error: tags @> takes a text[]
