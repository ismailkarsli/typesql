import { mkdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { discover } from "../../src/cache/discover.js";
import { evaluateTypes, PROBE_HEAD, ProbeSession, parseTypeText, readAnalysis, type Evaluated } from "../../src/cache/evaluate.js";
import { coreNames, Printer } from "../../src/cache/print.js";
import { maxParam, rewriteNamed } from "../../src/runtime/splice.js";
import { hashOf, preview } from "./baseline.js";
import { compareStatement, type Observed, type Ours, type Server } from "./compare.js";
import type { Disagreement } from "./kinds.js";
import { count, emptyResult, record, type OracleResult, type Verdict } from "./result.js";
import { viewable, viewCheck } from "./views.js";
import { Connection, isRejection, type Ran, type ServerError } from "./replay.js";
import { NORM_PRELUDE, readDb, sampleTexts, schemaDdl, seedRows, tablesOf, type Db, type Relation } from "./schema.js";

const here = import.meta.dirname;
const core = resolve(here, "../..");
export const isCorePath = (p: string): boolean => p.startsWith(join(core, "src") + sep);

export interface Candidate {
  readonly sql: string;
  readonly source: string;
  readonly db: Db;
}

/** `:name` parameters and inline markers as `$n`, the way a call's text is sent: names first, markers numbered after them. */
export function positional(text: string): string {
  const named = rewriteNamed(text).text;
  let k = maxParam(named);
  return named.replace(/\u0000[PD][^\u0000]*\u0000/g, () => `$${++k}`);
}

interface Group {
  readonly id: string;
  readonly snapshot: string;
  db?: Db;
  dbError?: string;
}

interface Item {
  readonly group: Group;
  readonly text: string;
  readonly file: string;
  readonly ddl: boolean;
  result?: Evaluated;
}

/** Statements that end or change the transaction the runs happen in: described, not run. */
const NOT_RUN = /^\s*(begin|commit|end|rollback|abort|start\s+transaction|savepoint|release|prepare\s+transaction|vacuum|checkpoint|set\s+(session\s+)?characteristics|discard|reindex\s+database|create\s+database|drop\s+database|alter\s+system)\b/i;
/** Server errors a DDL step meets because our `DB` has no constraints (foreign keys, ON CONFLICT targets). */
const MISSING_CONSTRAINTS = new Set(["42830", "42P10"]);

export async function typesOracle(url: string, log: (m: string) => void, options: { readonly views?: boolean } = {}): Promise<{ readonly types: OracleResult; readonly views: OracleResult; readonly candidates: Candidate[] }> {
  const started = performance.now();
  const result = emptyResult();
  const views = emptyResult();
  const candidates: Candidate[] = [];
  mkdirSync(join(here, ".probe"), { recursive: true });
  const session = new ProbeSession(join(here, "tsconfig.types.json"), join(here, ".probe/__oracle_probe__.ts"));
  const notes = result.notes;
  const skip = (reason: string): void => count(result, `skip: ${reason}`);
  try {
    const { program, checker, sf } = await session.withProbe(PROBE_HEAD);
    const kinds = (await session.typescript()).kinds;
    const sites = await discover(program, checker, kinds, isCorePath, (f) => f.includes(`${sep}test${sep}types${sep}`) && !f.endsWith(".d.ts"));
    const printer = new Printer(checker, sf, isCorePath);
    const groups = new Map<string, Group>();
    const groupOf = new Map<number, Group | null>();
    const groupFor = async (db: { id: number }): Promise<Group | null> => {
      if (!groupOf.has(db.id)) {
        const snap = await printer.snapshot(db as never);
        if (snap === null) groupOf.set(db.id, null);
        else {
          const text = coreNames(snap);
          const id = hashOf(text).slice(0, 12);
          const g = groups.get(id) ?? { id, snapshot: text };
          groups.set(id, g);
          groupOf.set(db.id, g);
        }
      }
      return groupOf.get(db.id)!;
    };
    const items = new Map<string, Item>();
    const add = async (site: { key: string; db: unknown; file: string }, ddl: boolean): Promise<void> => {
      const g = await groupFor(site.db as { id: number });
      if (!g) return skip("schema-unrepresentable");
      const text = ddl ? site.key : positional(site.key);
      const k = `${g.id}\0${ddl}\0${text}`;
      if (!items.has(k)) items.set(k, { group: g, text, file: basename(site.file), ddl });
    };
    for (const s of sites.sql) {
      if (s.slots) skip("slots");
      else await add(s, false);
    }
    for (const s of sites.types) await add(s, false);
    for (const s of sites.ddl) await add(s, true);
    const list = [...items.values()];
    log(`types oracle: ${sites.sql.length + sites.types.length + sites.ddl.length} sites, ${list.length} distinct statements over ${groups.size} schemas`);

    let base = PROBE_HEAD + NORM_PRELUDE;
    for (const g of groups.values()) base += `type DB_${g.id} = ${g.snapshot};\n`;
    const gl = [...groups.values()];
    const exprs = [
      ...gl.map((g) => `NormDb<DB_${g.id}>`),
      ...list.map((it) => (it.ddl ? `__T.ApplyDdl<DB_${it.group.id}, ${JSON.stringify(it.text)}>` : `__T.CacheAnalysis<DB_${it.group.id}, ${JSON.stringify(it.text)}>`)),
    ];
    const t0 = performance.now();
    const results = await evaluateTypes(session, base, exprs, isCorePath);
    log(`types oracle: evaluated in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    gl.forEach((g, i) => {
      const r = results[i]!;
      if ("error" in r) g.dbError = r.error;
      else {
        try {
          g.db = readDb(parseTypeText(r.text));
        } catch (e) {
          g.dbError = (e as Error).message;
        }
      }
    });
    list.forEach((it, i) => (it.result = results[gl.length + i]!));

    const admin = new Connection(url);
    try {
      for (const g of gl) {
        const mine = list.filter((it) => it.group === g);
        if (!g.db) {
          notes.push(`schema ${g.id} not written: ${g.dbError}`);
          for (const _ of mine) skip("schema-unrepresentable");
          continue;
        }
        const dbName = `typesql_oracle_${g.id}`;
        await admin.exec(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.exec(`CREATE DATABASE ${dbName}`);
        const conn = new Connection(withDatabase(url, dbName));
        try {
          const failed: string[] = [];
          const created: Relation[] = [];
          for (const stmt of schemaDdl(g.db)) {
            const e = await conn.tryExec(stmt.sql);
            if (e) failed.push(`${preview(stmt.sql, 80)}: ${e.message}`);
            else if (stmt.relation) created.push(stmt.relation);
          }
          for (const r of created) for (const row of seedRows(g.db, r)) await conn.tryExec(row);
          const tables = tablesOf(created);
          if (failed.length) notes.push(`schema ${g.id}: ${failed.length} statement(s) failed: ${failed.slice(0, 3).join("; ")}`);
          const partial = failed.length > 0 || g.db.unsupported.length > 0;
          for (const it of mine) {
            const verdict = await outsideTheSchema(conn, it.ddl ? await checkDdl(conn, tables, it) : await checkStatement(conn, g.db, tables, it));
            const v = "skip" in verdict ? verdict : partial ? unrepresentable(verdict) : verdict;
            record(result, it.file, it.text, v, {}, it.result);
            const ours = it.ddl ? null : oursOf(it);
            if (options.views && ours && "analysis" in ours && viewable(it.text, ours.analysis)) {
              const vv = await viewCheck(conn, it.text, ours.analysis);
              if ("narrowed" in vv && vv.narrowed) count(views, "narrowed columns", vv.narrowed);
              record(views, it.file, it.text, vv, {}, it.result);
              if ("disagreements" in vv && vv.disagreements.some((d) => d.kind === "unsound-candidate")) candidates.push({ sql: it.text, source: it.file, db: g.db });
            }
          }
        } finally {
          await conn.close();
          await admin.exec(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        }
      }
    } finally {
      await admin.close();
    }
    log(`types oracle: done in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    return { types: result, views, candidates };
  } finally {
    await session.dispose();
  }
}

/** A statement over a schema the generator could only partly write: an unknown relation, type or function is not a finding. */
function unrepresentable(v: { readonly disagreements: readonly Disagreement[] }): Verdict {
  if (v.disagreements.some((d) => d.kind === "accepts" && /server: (42P01|42704|42883)/.test(d.detail))) return { skip: "schema-unrepresentable" };
  return v;
}

/** Server errors about what a `DB` type cannot say: a function the test declares, a role or tablespace, a named constraint. */
async function outsideTheSchema(conn: Connection, v: Verdict): Promise<Verdict> {
  if ("skip" in v || v.disagreements.length !== 1 || v.disagreements[0]!.kind !== "accepts") return v;
  const detail = v.disagreements[0]!.detail;
  if (/^server: 42704 (role|tablespace) /.test(detail)) return { skip: "schema-unrepresentable" };
  if (/^server: 42704 constraint /.test(detail)) return { skip: "schema-constraints" };
  // partitioning and materialized views: a `DB` type has neither
  if (/^server: (42P17 .* is not partitioned|42809 .* is not a materialized view)/.test(detail)) return { skip: "schema-unrepresentable" };
  const fn = /^server: 42883 function (?:[\w$]+\.)?([\w$]+)\(/.exec(detail);
  if (fn) {
    const rows = await conn.sql.unsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM pg_proc WHERE proname = $1", [fn[1]!]);
    if (rows[0]!.n === 0) return { skip: "schema-unrepresentable" };
  }
  return v;
}

export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export function oursOf(it: { readonly result?: Evaluated }): Ours {
  const r = it.result;
  if (!r) return { crash: "not evaluated" };
  if ("error" in r) return { crash: r.error };
  let a: ReturnType<typeof readAnalysis>;
  try {
    a = readAnalysis(r.text);
  } catch (e) {
    return { crash: `unreadable analysis: ${(e as Error).message}` };
  }
  return "error" in a ? { error: a.error } : { analysis: a };
}

async function checkStatement(conn: Connection, db: Db, tables: readonly string[], it: Item) {
  const ours = oursOf(it);
  return compareStatement(ours, await observe(conn, db, tables, it.text, ours));
}

export async function observe(conn: Connection, db: Db, tables: readonly string[], text: string, ours: Ours): Promise<Server> {
  const d = await conn.describe(text);
  if ("error" in d) return { error: d.error };
  const columns = await Promise.all(d.columns.map(async (c) => ({ name: c.name, type: await conn.typeName(c.type) })));
  const params = await Promise.all(d.params.map((p) => conn.typeName(p)));
  const rows: (readonly unknown[])[] = [];
  const runErrors: ServerError[] = [];
  let runs = 0;
  if (!("crash" in ours) && !NOT_RUN.test(text)) {
    const nullable = params.map((_, i) => ("analysis" in ours ? ours.analysis.params[i + 1]?.nullable ?? true : true));
    for (const ran of await runVariants(conn, db, tables, text, params, nullable)) {
      runs++;
      if ("rows" in ran) rows.push(...ran.rows);
      else runErrors.push(ran.error);
    }
  }
  const observed: Observed = { columns, params, rows, runs, runErrors };
  return { observed };
}

/** A parameter we type non-null is never bound to NULL: the caller cannot pass one. */
export async function runVariants(conn: Connection, db: Db, tables: readonly string[], text: string, params: readonly string[], nullable: readonly boolean[]): Promise<Ran[]> {
  const samples = params.map((p) => sampleTexts(p, db.enums));
  const bindings: (string | null)[][] = [];
  if (params.every((_, i) => nullable[i] || samples[i]!.length)) bindings.push(params.map((_, i) => (nullable[i] ? null : samples[i]![0]!)));
  if (params.length && samples.every((s) => s.length)) bindings.push(samples.map((s) => s[Math.min(1, s.length - 1)]!));
  const out: Ran[] = [];
  await conn.exec("BEGIN");
  try {
    const each = async (): Promise<void> => {
      for (const b of bindings) {
        await conn.exec("SAVEPOINT v");
        out.push(await conn.run(text, b));
        await conn.exec("ROLLBACK TO SAVEPOINT v");
      }
    };
    await each();
    if (tables.length) {
      await conn.exec(`TRUNCATE ${tables.join(", ")}`);
      await each();
    }
  } finally {
    await conn.exec("ROLLBACK");
  }
  return out;
}

/** Runs over the emptied tables: a schema change, not the seeded rows (a NULL in a column made NOT NULL), is what it is about. */
async function checkDdl(conn: Connection, tables: readonly string[], it: Item): Promise<Verdict> {
  const r = it.result;
  if (!r) return { disagreements: [{ kind: "crash", detail: "not evaluated" }] };
  if ("error" in r) return { disagreements: [{ kind: "crash", detail: r.error }] };
  const ourError = /^__T\.SqlError<"((?:[^"\\]|\\.)*)"/.exec(r.text);
  let error: ServerError | null = null;
  await conn.exec("BEGIN");
  try {
    if (tables.length) await conn.exec(`TRUNCATE ${tables.join(", ")}`);
    const ran = await conn.run(it.text);
    if ("error" in ran) error = ran.error;
  } finally {
    await conn.exec("ROLLBACK");
  }
  if (error && MISSING_CONSTRAINTS.has(error.code)) return { skip: "schema-constraints" };
  if (ourError && !error) return { disagreements: [{ kind: "rejects", detail: `ours: ${JSON.parse(`"${ourError[1]}"`) as string}` }] };
  if (!ourError && error) {
    if (!isRejection(error)) return { skip: "server-error" };
    return { disagreements: [{ kind: "accepts", detail: `server: ${error.code} ${error.message}` }] };
  }
  return { disagreements: [] };
}
