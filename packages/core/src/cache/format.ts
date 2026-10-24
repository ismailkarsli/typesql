/// <reference types="node" />
/**
 * The `.typesqlcache` file: JSON written by the job (job.ts), turned by the content mapper
 * (mapper.ts) into a module augmentation of `@typesql/core/engine` (engine/cache.ts describes what the
 * checker does with it). Type texts are TypeScript as printed relative to the cache file's
 * directory; `__T` is `@typesql/core/engine`.
 */
import { createHash } from "node:crypto";

export const FORMAT = 1;

export interface CacheFile {
  readonly typesqlcache: typeof FORMAT;
  /** `CacheVersion` of the engine that computed the entries. */
  readonly engine: string;
  /** Query entries, grouped by the `DB` type they were computed for (key: hash of that type). */
  readonly groups: { readonly [group: string]: Group };
  /** Type map snapshots of call entries (key: hash of the snapshot). */
  readonly maps: { readonly [map: string]: string };
  /** DDL steps: script text → one entry per schema it was applied to. */
  readonly ddl: { readonly [key: string]: readonly DdlEntry[] };
  /**
   * Which projects use each entry: `"<group>\0<key>"` or `"ddl\0<key>"` → tsconfig paths
   * relative to the cache file. An entry no project uses any more is dropped.
   */
  readonly owners: { readonly [entry: string]: readonly string[] };
}

export interface Snapshot {
  /** `DB["$types"]`, `{}` when absent. */
  readonly t: string;
  /** Per word: `[DB[w], DB.pg_catalog[w], DB.$functions[w], FunctionCatalog[w]]`. */
  readonly w: { readonly [word: string]: readonly [string, string, string, string] };
  /** Per pair `a.b`: `DB[a][b]`. */
  readonly q: { readonly [pair: string]: string };
}

export interface Group extends Snapshot {
  /** `HintIndex<DB>`. */
  readonly h: string;
  readonly entries: { readonly [key: string]: Entry };
}

export interface Entry {
  /** Dependencies: words, pairs, `"*"`, `"!h"`. */
  readonly r: readonly string[];
  /** For a call whose literal is not its positional text (`:name`, `${sql.param()}`): the positional text, where its analysis is. */
  readonly t?: string;
  /** `CacheAnalysis<DB, key>`. */
  readonly a?: string;
  /** `CallTypes<DB, TM, Keys, key>`, one per type map and `rowKeys`. */
  readonly c?: readonly CallEntry[];
}

export interface CallEntry {
  /** Key in `CacheFile.maps`. */
  readonly m: string;
  /** `rowKeys` (`"preserve"` / `"camelCase"`). */
  readonly k: string;
  readonly g: string;
  readonly p: string;
  readonly q: string;
}

export interface DdlEntry {
  readonly d: Snapshot & { readonly all?: string };
  readonly r: readonly string[];
  /** Keys set and keys removed (`DdlEffect`), or `e`: the error. */
  readonly s?: string;
  readonly x?: string;
  readonly e?: string;
}

export const emptyCache = (engine: string): CacheFile => ({ typesqlcache: FORMAT, engine, groups: {}, maps: {}, ddl: {}, owners: {} });

/** The file's content, or `null` when it is not a cache file (`{}`, another format, invalid JSON). */
export function parseCache(text: string): CacheFile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const f = data as Partial<CacheFile>;
  if (f.typesqlcache !== FORMAT || typeof f.engine !== "string") return null;
  return { typesqlcache: FORMAT, engine: f.engine, groups: f.groups ?? {}, maps: f.maps ?? {}, ddl: f.ddl ?? {}, owners: f.owners ?? {} };
}

const sorted = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  return v;
};

/** Stable JSON: two writes of the same content are byte-identical, so the editor sees no change. */
export const stringifyCache = (file: CacheFile): string => JSON.stringify(sorted(file), null, 1) + "\n";

/** JSON with sorted keys, for comparing values built in different orders. */
export const canonical = (v: unknown): string => JSON.stringify(sorted(v));

export const hash = (text: string, length = 12): string => createHash("sha256").update(text).digest("hex").slice(0, length);

const lit = (s: string): string => JSON.stringify(s);
const union = (xs: readonly string[]): string => (xs.length ? xs.map(lit).join(" | ") : "never");
const words = (w: Snapshot["w"]): string => `{ ${Object.entries(w).map(([k, v]) => `${lit(k)}: readonly [${v.join(", ")}]`).join("; ")} }`;
const pairs = (q: Snapshot["q"]): string => `{ ${Object.entries(q).map(([k, v]) => `${lit(k)}: ${v}`).join("; ")} }`;

/**
 * The module augmentation the checker sees for a cache file. `id` keeps two cache files in one
 * program apart (engine/cache.ts). Entries of another engine version are left out: they could
 * never be used.
 */
export function render(file: CacheFile | null, id: string, engine: string): string {
  const head = `// Generated from a TypeSQL type cache; see https://typesql.karsli.net/guide/caching\nimport type * as __T from "@typesql/core/engine";\nexport {};\n`;
  if (!file || file.engine !== engine) return head;
  const out: string[] = [head];
  const keys = new Set<string>();
  const snapshots: string[] = [];
  const groups: string[] = [];
  for (const [g, group] of Object.entries(file.groups)) {
    const entries = Object.entries(group.entries);
    if (!entries.length) continue;
    out.push(`type D_${g} = { v: ${lit(file.engine)}; t: ${group.t}; w: ${words(group.w)}; q: ${pairs(group.q)}; h: ${group.h} };\n`);
    snapshots.push(`    ${lit(`${id}#${g}`)}: D_${g};`);
    const body = entries.map(([key, e]) => {
      keys.add(key);
      const calls = e.c?.length ? `; c: ${e.c.map((c) => `{ m: M_${c.m}; k: ${c.k}; g: ${c.g}; p: ${c.p}; q: ${c.q} }`).join(" | ")}` : "";
      return `      ${lit(key)}: { r: ${union(e.r)}${e.a ? `; a: ${e.a}` : ""}${calls} };`;
    });
    groups.push(`    ${lit(`${id}#${g}`)}: {\n${body.join("\n")}\n    };`);
  }
  for (const [m, text] of Object.entries(file.maps)) out.push(`type M_${m} = ${text};\n`);
  const ddl = Object.entries(file.ddl).filter(([, es]) => es.length);
  const ddlBody = ddl.map(([key, es]) => {
    const variants = es.map((e) => {
      const d = `{ v: ${lit(file.engine)}; t: ${e.d.t}; w: ${words(e.d.w)}; q: ${pairs(e.d.q)}${e.d.all ? `; all: ${e.d.all}` : ""} }`;
      return `{ d: ${d}; r: ${union(e.r)}; ${e.e ? `e: ${e.e}` : `s: ${e.s}; x: ${e.x}`} }`;
    });
    return `      ${lit(key)}: ${variants.join(" | ")};`;
  });
  out.push(`declare module "@typesql/core/engine" {\n`);
  if (keys.size) {
    out.push(`  interface QueryCacheKeys {\n${[...keys].map((k) => `    ${lit(k)}: true;`).join("\n")}\n  }\n`);
    out.push(`  interface CacheSnapshots {\n${snapshots.join("\n")}\n  }\n`);
    out.push(`  interface QueryCache {\n${groups.join("\n")}\n  }\n`);
  }
  if (ddl.length) {
    out.push(`  interface DdlCacheKeys {\n${ddl.map(([k]) => `    ${lit(k)}: true;`).join("\n")}\n  }\n`);
    out.push(`  interface DdlCache {\n    ${lit(id)}: {\n${ddlBody.join("\n")}\n    };\n  }\n`);
  }
  out.push(`}\n`);
  return out.join("");
}

/** Id of a cache file in the augmentation: a hash of its path. */
export const fileId = (fileName: string): string => hash(fileName, 8);
