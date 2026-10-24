import { expectTypeOf, test } from "vitest";
import { createSql, migrations, type Migrations, type Col, type Generated, type Nullable, type NullableGenerated, type RowType, type SchemaOf, type SqlError, type View } from "../../src/index.js";
import type { ValidateDdl } from "../../src/engine/index.js";

const m = migrations()
  .add("CREATE TYPE mood AS ENUM ('happy', 'sad')")
  .add("CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL)")
  .add("ALTER TABLE users ADD COLUMN display_name text, ADD COLUMN mood mood NOT NULL DEFAULT 'happy'")
  .add(`
    CREATE TABLE posts (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      author_id int NOT NULL REFERENCES users (id),
      title text NOT NULL
    );
    CREATE INDEX posts_author_idx ON posts (author_id);
  `)
  .add("CREATE VIEW user_emails AS SELECT id, email FROM users")
  .add("INSERT INTO users (email) VALUES ('admin@example.com')");

type Expected = {
  $types: { mood: "happy" | "sad" };
  users: { id: Generated<"int4">; email: Col<"text">; display_name: Nullable<"text">; mood: Generated<"mood"> };
  posts: { id: Generated<"int8">; author_id: Col<"int4">; title: Col<"text"> };
  user_emails: View<{ id: Col<"int4">; email: Col<"text"> }>;
};

test("the chain accumulates the schema", () => {
  expectTypeOf<SchemaOf<typeof m>>().toEqualTypeOf<Expected>();
  expectTypeOf(m.schema).toEqualTypeOf<Expected>();
  expectTypeOf(m.statements).toEqualTypeOf<readonly string[]>();
  expectTypeOf(m).toEqualTypeOf<Migrations<Expected>>();
  expectTypeOf(migrations()).toEqualTypeOf<Migrations<{}>>();
});

test("createSql over the migrated schema", () => {
  const sql = createSql<SchemaOf<typeof m>>();
  const q = sql("SELECT u.id, u.mood, u.display_name, p.title FROM users u JOIN posts p ON p.author_id = u.id WHERE u.email = $1", "a@b.c");
  expectTypeOf<RowType<typeof q>>().toEqualTypeOf<{ id: number; mood: "happy" | "sad"; display_name: string | null; title: string }>();
  const v = sql("SELECT email FROM user_emails");
  expectTypeOf<RowType<typeof v>>().toEqualTypeOf<{ email: string }>();
});

test("invalid DDL is a compile error on the literal", () => {
  // @ts-expect-error relation "users" already exists
  m.add("CREATE TABLE users (id int)");
  // @ts-expect-error column "nope" of relation "users" does not exist
  m.add("ALTER TABLE users DROP COLUMN nope");
  // @ts-expect-error syntax error
  m.add("CREATE TABLE t (id int foo)");
  // @ts-expect-error seed data is checked too: column "nope" of relation "users" does not exist
  m.add("INSERT INTO users (nope) VALUES (1)");
  // @ts-expect-error a non-literal string cannot be checked
  m.add("CREATE TABLE t (id int)" as string);

  expectTypeOf<ValidateDdl<{}, "CREATE TABLE t (id int)">>().toEqualTypeOf<"CREATE TABLE t (id int)">();
  expectTypeOf<ValidateDdl<{}, "DROP TABLE t">>().toEqualTypeOf<SqlError<'table "t" does not exist', 2>>();
});

test("starting from an existing schema", () => {
  interface Base {
    users: { id: Generated<"int4">; email: Col<"text"> };
  }
  const m2 = migrations<Base>().add("ALTER TABLE users ADD COLUMN bio text DEFAULT ''");
  expectTypeOf<SchemaOf<typeof m2>>().toEqualTypeOf<{ users: { id: Generated<"int4">; email: Col<"text">; bio: NullableGenerated<"text"> } }>();
});

test("schema elements, recursive views, table-level NOT NULL and cursors in migrations", () => {
  const m2 = migrations()
    .add(`CREATE SCHEMA app
      CREATE VIEW active AS SELECT id, parent FROM nodes WHERE parent IS NOT NULL
      CREATE TABLE nodes (id int PRIMARY KEY, parent int, label text, NOT NULL label)
      CREATE INDEX nodes_parent_idx ON nodes (parent)`)
    .add("CREATE RECURSIVE VIEW app.tree (id, depth) AS SELECT id, 0 FROM app.nodes WHERE parent IS NULL UNION ALL SELECT n.id, t.depth + 1 FROM app.nodes n JOIN tree t ON n.parent = t.id")
    .add("ALTER TABLE app.nodes ADD COLUMN w int, ADD NOT NULL w")
    .add("BEGIN; DECLARE c CURSOR FOR SELECT label FROM app.nodes; FETCH 10 FROM c; CLOSE c; END");
  expectTypeOf<SchemaOf<typeof m2>>().toEqualTypeOf<{
    app: {
      nodes: { id: Col<"int4">; parent: Nullable<"int4">; label: Col<"text">; w: Col<"int4"> };
      active: View<{ id: Col<"int4">; parent: Col<"int4"> }>;
      tree: View<{ id: Col<"int4">; depth: Col<"int4"> }>;
    };
  }>();
  // @ts-expect-error column "nope" does not exist
  m2.add("DECLARE c2 CURSOR FOR SELECT nope FROM app.nodes");
});

test("raw() appends unchecked SQL and keeps or asserts the schema", () => {
  const m2 = m.raw("SELECT pg_advisory_lock(1)");
  expectTypeOf<SchemaOf<typeof m2>>().toEqualTypeOf<Expected>();
  const m3 = migrations().raw<{ t: { x: Col<"int4"> } }>("CREATE TABLE t (x int NOT NULL) PARTITION BY some_future_syntax");
  expectTypeOf<SchemaOf<typeof m3>>().toEqualTypeOf<{ t: { x: Col<"int4"> } }>();
});
