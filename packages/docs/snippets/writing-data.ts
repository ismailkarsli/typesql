import type { ParamsType, RowType } from "@typesql/core";
import { check, type Equal } from "./_check.js";
import { sql } from "./schema.js";

// #region insert
const created = sql(
  "INSERT INTO users (email, display_name, mood) VALUES ($1, $2, $3) RETURNING id, created_at",
  "a@b.c",
  null,
  "happy",
);
// Query<{ id: number; created_at: Date }, [string, string | null, "happy" | "neutral" | "sad"]>
// #endregion insert
check<Equal<RowType<typeof created>, { id: number; created_at: Date }>>();
check<Equal<ParamsType<typeof created>, [string, string | null, "happy" | "neutral" | "sad"]>>();

// #region optional-values
declare const mood: "happy" | "neutral" | "sad" | undefined; // optional input
const signup = sql(`
  INSERT INTO users (email, mood)
  VALUES (${sql.param("a@b.c")}, ${sql.param(mood)})
  RETURNING id, mood`);
signup.text; // "… VALUES ($1, $2) …", or "… VALUES ($1, DEFAULT) …" when mood is undefined
// #endregion optional-values
check<Equal<RowType<typeof signup>, { id: number; mood: "happy" | "neutral" | "sad" }>>();

// #region set
declare const patch: { display_name?: string | null; mood?: "happy" | "neutral" | "sad" }; // e.g. a PATCH body
const set = sql.set("users", patch); // keys and values checked against users; undefined is skipped
const patched = sql("UPDATE users SET {set} WHERE id = $1 RETURNING id, display_name, mood", { set }, 7);
patched.text; // 'UPDATE users SET "display_name" = $2 WHERE id = $1 …' when only display_name is set
// #endregion set
check<Equal<RowType<typeof patched>, { id: number; display_name: string | null; mood: "happy" | "neutral" | "sad" }>>();

// #region values
declare const imported: { email: string; display_name?: string | null }[];
const rows = sql.values("users", imported); // email is required; missing values are DEFAULT
const inserted = sql("INSERT INTO users {rows} ON CONFLICT (email) DO NOTHING RETURNING id", { rows });
inserted.text; // 'INSERT INTO users ("email", "display_name") VALUES ($1, $2), ($3, DEFAULT) …'
// #endregion values
check<Equal<RowType<typeof inserted>, { id: number }>>();

// #region update
const renamed = sql("UPDATE users SET display_name = $1 WHERE id = $2", "Ada", 7);
// RowType<typeof renamed> is never: no RETURNING. Run it with execute() to get the row count.
const touched = sql(`
  UPDATE posts p SET title = upper(p.title)
  FROM users u
  WHERE u.id = p.author_id AND u.mood = 'sad'
  RETURNING p.id, u.email`);
// { id: string; email: string }
// #endregion update
check<Equal<RowType<typeof renamed>, never>>();
check<Equal<RowType<typeof touched>, { id: string; email: string }>>();

// #region upsert
const upsert = sql(`
  INSERT INTO users (email, mood) VALUES ($1, $2)
  ON CONFLICT (email) DO UPDATE SET mood = EXCLUDED.mood
  RETURNING id`, "a@b.c", "neutral");
// #endregion upsert
check<Equal<RowType<typeof upsert>, { id: number }>>();

// #region delete
const removed = sql("DELETE FROM posts p USING users u WHERE u.id = p.author_id AND u.email = $1 RETURNING p.id, p.title", "a@b.c");
// { id: string; title: string }
// #endregion delete
check<Equal<RowType<typeof removed>, { id: string; title: string }>>();

// #region cte
const moved = sql(`
  WITH archived AS (
    DELETE FROM posts WHERE author_id = $1 RETURNING id
  )
  SELECT count(*) AS n FROM archived`, 7);
// { n: string }
// #endregion cte
check<Equal<RowType<typeof moved>, { n: string }>>();
