import type { ParamsType, Query, RelationName, RowType, TextType } from "@typesql/core";
import { check, type Equal } from "./_check.js";
import { sql, type DB } from "./schema.js";

// #region slots
const byAuthor7 = sql.fragment("WHERE p.author_id = $1", 7);
const q = sql("SELECT p.id, p.title FROM posts p {byAuthor7} ORDER BY p.id", { byAuthor7 });
q.text; // "SELECT p.id, p.title FROM posts p WHERE p.author_id = $1 ORDER BY p.id"
// Query<{ id: string; title: string }, [number | null]>
// #endregion slots
check<Equal<typeof q, Query<{ id: string; title: string }, [number | null], "SELECT p.id, p.title FROM posts p WHERE p.author_id = $1 ORDER BY p.id">>>();

// #region outer
const byAuthor = sql(
  "SELECT p.title FROM posts p WHERE p.author_id = $1 {more}",
  { more: sql.fragment(`AND p.title <> ${sql.param("draft")}`) },
  42,
);
byAuthor.text; // "SELECT p.title FROM posts p WHERE p.author_id = $1 AND p.title <> $2"
byAuthor.values; // [42, "draft"]
// #endregion outer
check<Equal<ParamsType<typeof byAuthor>, [number | null, string | null]>>();

// #region subquery
const authors = sql("SELECT author_id FROM posts GROUP BY author_id HAVING count(*) >= $1::int4", 3);
const prolific = sql("SELECT email FROM users WHERE id IN ({authors})", { authors });
// #endregion subquery
check<Equal<RowType<typeof prolific>, { email: string }>>();

// #region helpers
const column = sql.id("display_name"); // "display_name", quoted
const both = sql.join([sql.fragment("u.id > $1", 10), sql.fragment(`u.email LIKE ${sql.param("%@example.com")}`)], " AND ");
const listed = sql("SELECT {column} FROM users u WHERE {both}", { column, both });
listed.text; // 'SELECT "display_name" FROM users u WHERE u.id > $1 AND u.email LIKE $2'
// Query<{ display_name: string | null }, [number, string]>
// #endregion helpers
check<Equal<RowType<typeof listed>, { display_name: string | null }>>();
check<Equal<TextType<typeof listed>, 'SELECT "display_name" FROM users u WHERE u.id > $1 AND u.email LIKE $2'>>();

// #region id-union
declare const shown: "email" | "display_name";
const pick = sql.id(shown); // Fragment<'"display_name"' | '"email"'>
const picked = sql("SELECT {pick} FROM users", { pick });
// RowType: { display_name: string | null } | { email: string }

function countRows<T extends RelationName<DB>>(table: T) {
  const t = sql.id(table); // every table and view of DB
  return sql("SELECT count(*) AS n FROM {t}", { t });
}
// #endregion id-union
check<Equal<RowType<typeof picked>, { display_name: string | null } | { email: string }>>();
check<Equal<RowType<ReturnType<typeof countRows>>, { n: string }>>();

// #region list
const SORT = {
  title: { asc: sql.fragment("p.title"), desc: sql.fragment("p.title DESC") },
  author: { asc: sql.fragment("p.author_id"), desc: sql.fragment("p.author_id DESC") },
} as const;
declare const sortBy: { field: keyof typeof SORT; dir: "asc" | "desc" }[]; // chosen by the user
const order = sql.join([...sortBy.map(({ field, dir }) => SORT[field][dir]), sql.fragment("p.id")]);
const sorted = sql("SELECT p.id, p.title FROM posts p ORDER BY {order}", { order });
// Query<{ id: string; title: string }, []>: checked with each of the five elements once
// #endregion list
check<Equal<RowType<typeof sorted>, { id: string; title: string }>>();

// #region dynamic
declare const userChosenColumns: string[];
const raw = sql.raw(userChosenColumns.map((c) => `"${c.replaceAll('"', '""')}"`).join(", "));
const dynamic = sql.as<{ [column: string]: unknown }>("SELECT {raw} FROM users", { raw });
// #endregion dynamic
check<Equal<RowType<typeof dynamic>, { [column: string]: unknown }>>();
