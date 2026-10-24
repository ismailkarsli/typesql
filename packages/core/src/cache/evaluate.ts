import { createRequire } from "node:module";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { API as AsyncAPI, Checker, Program, Snapshot, Type } from "typescript/async";
import type { Node, SourceFile, VariableStatement } from "typescript/ast";
import type { Kinds } from "./discover.js";
import { coreNames, Printer } from "./print.js";

/** The project's `typescript` package: its async API, fs helpers and syntax kinds. */
export interface TypeScript {
  readonly API: typeof AsyncAPI;
  readonly createFileSystemLayer: (files: readonly (readonly [string, string])[]) => unknown;
  readonly kinds: Kinds & { readonly VariableStatement: number };
}

export async function loadTypeScript(configFile: string): Promise<TypeScript> {
  const req = createRequire(configFile);
  const load = (spec: string): Promise<Record<string, unknown>> => import(pathToFileURL(req.resolve(spec)).href) as Promise<Record<string, unknown>>;
  const [api, fs, ast] = await Promise.all([load("typescript/async"), load("typescript/fs"), load("typescript/ast")]);
  const SyntaxKind = ast.SyntaxKind as Record<string, number>;
  return {
    API: api.API as typeof AsyncAPI,
    createFileSystemLayer: fs.createFileSystemLayer as TypeScript["createFileSystemLayer"],
    kinds: {
      CallExpression: SyntaxKind.CallExpression!,
      PropertyAccessExpression: SyntaxKind.PropertyAccessExpression!,
      TypeReference: SyntaxKind.TypeReference!,
      LiteralType: SyntaxKind.LiteralType!,
      StringLiteral: SyntaxKind.StringLiteral!,
      TypeAliasDeclaration: SyntaxKind.TypeAliasDeclaration!,
      VariableStatement: SyntaxKind.VariableStatement!,
    },
  };
}

export const PROBE_HEAD = `import type * as __T from "@typesql/core/engine";\nexport declare const __v: __T.CacheVersion;\nexport declare const __fc: __T.FunctionCatalog;\n`;

export interface ProbeProgram {
  readonly program: Program;
  readonly checker: Checker;
  readonly sf: SourceFile;
}

export class ProbeSession {
  private ts: TypeScript | undefined;
  private api: AsyncAPI | undefined;
  private snapshot: Snapshot | undefined;
  private changed = new Set<string>();
  private disposed = false;
  private readonly configFile: string;
  readonly probe: string;

  constructor(configFile: string, probe: string) {
    this.configFile = configFile;
    this.probe = probe;
  }

  async typescript(): Promise<TypeScript> {
    return (this.ts ??= await loadTypeScript(this.configFile));
  }

  markChanged(files: Iterable<string>): void {
    for (const f of files) this.changed.add(f);
  }

  async close(): Promise<void> {
    const api = this.api;
    this.api = undefined;
    this.snapshot = undefined;
    await api?.close();
  }

  /** Close for good: a request in progress fails at its next program instead of reopening. */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.close();
  }

  async withProbe(text: string): Promise<ProbeProgram> {
    if (this.disposed) throw new Error("typesql: the job was stopped");
    const ts = await this.typescript();
    const fileSystem = ts.createFileSystemLayer([[this.probe, text]]) as never;
    // Stryker disable next-line LogicalOperator: api and snapshot are set and cleared together
    if (!this.api || !this.snapshot) {
      // Stryker disable next-line ObjectLiteral: every path given to the API is absolute
      this.api = new ts.API({ cwd: dirname(this.configFile) });
      this.snapshot = await this.api.createSnapshot({ openProjects: [this.configFile], fileSystem });
      // Stryker disable next-line CallExpression: telling a new session that files changed is harmless
      this.changed.clear();
    } else {
      const changed = [...this.changed, this.probe];
      // Stryker disable next-line CallExpression: telling the session again that files changed is harmless
      this.changed.clear();
      const previous = this.snapshot;
      this.snapshot = await previous.update({ fileSystem, fileNotifications: { changed }, ensurePrograms: true });
      void previous.dispose();
    }
    const project = this.snapshot.getConfiguredProject(this.configFile);
    if (!project) throw new Error(`typesql: project ${this.configFile} did not load`);
    const sf = await project.program.getSourceFile(this.probe);
    if (!sf) throw new Error(`typesql: ${relative(dirname(this.configFile), this.probe)} is not in a directory the project includes .ts files from`);
    return { program: project.program, checker: project.checker, sf };
  }
}

export type Evaluated = { readonly text: string } | { readonly error: string };

export async function evaluateTypes(session: ProbeSession, base: string, exprs: readonly string[], isCorePath: (path: string) => boolean): Promise<Evaluated[]> {
  let probe = base;
  exprs.forEach((e, i) => (probe += `export declare const __x_${i}: ${e};\n`));
  const { program, checker, sf } = await session.withProbe(probe);
  const kinds = (await session.typescript()).kinds;
  const printer = new Printer(checker, sf, isCorePath);
  const types = await declTypes(checker, sf, kinds);
  const bad = await badDeclarations(program, sf);
  return Promise.all(exprs.map(async (_, i): Promise<Evaluated> => {
    const name = `__x_${i}`;
    const error = bad.get(name);
    if (error !== undefined) return { error };
    const t = types.get(name);
    if (!t) return { error: "no declaration" };
    // Stryker disable next-line ArrayDeclaration,StringLiteral: the printer names core's types through the probe's `__T` import; this only catches a spelled-out import("@typesql/core/engine")
    return { text: coreNames(await printer.print(t)) };
  }));
}

export function evaluateAnalyses(session: ProbeSession, base: string, items: readonly { readonly db: string; readonly text: string }[], isCorePath: (path: string) => boolean): Promise<Evaluated[]> {
  return evaluateTypes(session, base, items.map((a) => `__T.CacheAnalysis<${a.db}, ${JSON.stringify(a.text)}>`), isCorePath);
}

/** `export declare const name: …` declarations of the probe, by name. */
export function declarations(sf: SourceFile, kinds: TypeScript["kinds"]): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const st of sf.statements) {
    if (st.kind !== kinds.VariableStatement) continue;
    const d = (st as VariableStatement).declarationList.declarations[0];
    // Stryker disable next-line ConditionalExpression,LogicalOperator: a parsed declaration statement has a declaration; a name without text (a binding pattern) would only add an entry nobody reads
    if (d && "text" in d.name) out.set((d.name as { text: string }).text, d.name);
  }
  return out;
}

export async function declTypes(checker: Checker, sf: SourceFile, kinds: TypeScript["kinds"]): Promise<Map<string, Type>> {
  const decls = declarations(sf, kinds);
  const names = [...decls.keys()];
  // Stryker disable next-line ArrayDeclaration: PROBE_HEAD declares __v and __fc, so names is never empty
  const types = names.length ? await checker.getTypeAtLocation(names.map((n) => decls.get(n)!)) : [];
  return new Map(names.map((n, i) => [n, types[i]!]));
}

/** Probe declarations whose line has a compile error (an alias the probe could not resolve, …), with the first message. */
export async function badDeclarations(program: Program, sf: SourceFile): Promise<Map<string, string>> {
  // Stryker disable next-line ConditionalExpression,MethodExpression: a probe's semantic diagnostics are all errors (category 1); the filter only guards against others
  const errors = (await program.getSemanticDiagnostics(sf.fileName)).filter((d) => d.category === 1);
  const badLines = new Map<number, string>();
  for (const d of errors) {
    // Stryker disable next-line LogicalOperator,OptionalChaining: the API gives startPosition, and lineOf gives the same line
    const line = d.startPosition?.line ?? lineOf(sf.text, d.pos);
    if (!badLines.has(line)) badLines.set(line, `TS${d.code}: ${d.text}`);
  }
  // an alias line (`type X = …`) poisons the declarations that use it: drop by alias name
  const lines = sf.text.split("\n");
  const badAliases = new Map<string, string>();
  lines.forEach((l, i) => {
    const m = /^type (\w+) =/.exec(l);
    if (m && badLines.has(i)) badAliases.set(m[1]!, badLines.get(i)!);
  });
  const out = new Map<string, string>();
  lines.forEach((l, i) => {
    const m = /^export declare const (\w+):/.exec(l);
    if (!m) return;
    const own = badLines.get(i);
    if (own !== undefined) return void out.set(m[1]!, own);
    for (const [a, message] of badAliases) if (new RegExp(`\\b${a}\\b`).test(l)) return void out.set(m[1]!, message);
  });
  return out;
}

export const lineOf = (text: string, offset: number): number => {
  let line = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

export type TypeValue =
  | string | number | boolean | null
  | readonly TypeValue[]
  | TypeRecord
  | { readonly union: readonly TypeValue[] }
  | { readonly and: readonly TypeValue[] }
  | { readonly ref: string };

export type TypeRecord = { readonly [key: string]: TypeValue };

export function parseTypeText(text: string): TypeValue {
  const p = new TypeTextParser(text);
  const v = p.type(); // ends after any whitespace (its last eat("|") skips it)
  if (p.i !== text.length) throw new Error(`unexpected ${JSON.stringify(text.slice(p.i, p.i + 20))} at ${p.i} in printed type`);
  return v;
}

class TypeTextParser {
  i = 0;
  readonly s: string;
  constructor(s: string) {
    this.s = s;
  }
  ws(): void {
    while (/\s/.test(this.s.charAt(this.i))) this.i++;
  }
  private peek(t: string): boolean {
    this.ws();
    return this.s.startsWith(t, this.i);
  }
  private eat(t: string): boolean {
    if (!this.peek(t)) return false;
    this.i += t.length;
    return true;
  }
  private expect(t: string): void {
    if (!this.eat(t)) throw new Error(`expected ${JSON.stringify(t)} at ${this.i}: ${JSON.stringify(this.s.slice(this.i, this.i + 30))}`);
  }
  type(): TypeValue {
    this.eat("|");
    const parts = [this.intersection()];
    while (this.eat("|")) parts.push(this.intersection());
    return parts.length === 1 ? parts[0]! : { union: parts };
  }
  private intersection(): TypeValue {
    const parts = [this.postfix()];
    while (this.peek("&") && !this.peek("&&")) (this.i++, parts.push(this.postfix()));
    return parts.length === 1 ? parts[0]! : { and: parts };
  }
  private postfix(): TypeValue {
    const start = this.i;
    let v = this.primary();
    while (this.peek("[]")) {
      this.i += 2;
      v = { ref: this.s.slice(start, this.i).trim() };
    }
    return v;
  }
  private primary(): TypeValue {
    this.ws();
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.string();
    if (c === "{") return this.object();
    if (c === "[") return this.tuple();
    if (c === "(") {
      const start = this.i;
      this.skipBalanced("(", ")");
      if (this.eat("=>")) {
        this.type();
        return { ref: this.s.slice(start, this.i).trim() };
      }
      this.i = start + 1;
      const v = this.type();
      this.expect(")");
      return v;
    }
    if (this.s.startsWith("readonly ", this.i)) {
      const start = this.i;
      this.i += 9;
      const v = this.postfix();
      return Array.isArray(v) ? v : { ref: this.s.slice(start, this.i).trim() };
    }
    const num = /^-?\d+(\.\d+)?(e[+-]?\d+)?n?/.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      return num[0].endsWith("n") ? { ref: num[0] } : Number(num[0]);
    }
    const word = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*/.exec(this.s.slice(this.i));
    if (word) {
      const start = this.i;
      this.i += word[0].length;
      if (word[0] === "true") return true;
      if (word[0] === "false") return false;
      if (word[0] === "null") return null;
      if (word[0] === "import" && this.s[this.i] === "(") {
        this.skipBalanced("(", ")");
        if (this.eat(".")) this.primary();
        else this.skipArgs();
        return { ref: this.s.slice(start, this.i).trim() };
      }
      if (word[0] === "typeof" || word[0] === "keyof" || word[0] === "unique") {
        this.primary();
        return { ref: this.s.slice(start, this.i).trim() };
      }
      this.skipArgs();
      return { ref: this.s.slice(start, this.i) };
    }
    if (c === "`") {
      const start = this.i;
      this.i++;
      while (this.i < this.s.length && this.s[this.i] !== "`") this.i += this.s[this.i] === "\\" ? 2 : 1;
      this.i++;
      return { ref: this.s.slice(start, this.i) };
    }
    throw new Error(`cannot read printed type at ${this.i}: ${JSON.stringify(this.s.slice(this.i, this.i + 30))}`);
  }
  private skipArgs(): void {
    if (this.s[this.i] === "<") this.skipBalanced("<", ">");
  }
  private skipBalanced(open: string, close: string): void {
    let depth = 0;
    do {
      const c = this.s[this.i]!;
      if (c === '"' || c === "'") {
        this.string();
        continue;
      }
      if (c === open) depth++;
      // the `>` of `=>` (a function type in type arguments) does not close; in a printed type no other closing bracket follows `=`
      else if (c === close && this.s[this.i - 1] !== "=") depth--;
      this.i++;
    } while (depth > 0 && this.i < this.s.length);
  }
  private string(): string {
    const q = this.s[this.i]!;
    const start = this.i;
    this.i++;
    while (this.i < this.s.length && this.s[this.i] !== q) this.i += this.s[this.i] === "\\" ? 2 : 1;
    this.i++;
    const raw = this.s.slice(start, this.i);
    return q === '"' ? (JSON.parse(raw) as string) : (JSON.parse(`"${raw.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string);
  }
  private key(): string {
    // object() peeked past any whitespace
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.string();
    if (c === "[") {
      const start = this.i;
      this.skipBalanced("[", "]");
      return this.s.slice(start, this.i);
    }
    const m = /^[^\s:?;(<]+/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`expected a property name at ${this.i}`);
    this.i += m[0].length;
    return m[0];
  }
  private object(): TypeValue {
    const start = this.i;
    this.expect("{");
    const out: Record<string, TypeValue> = {};
    while (!this.eat("}")) {
      if (this.peek("readonly ")) this.i += "readonly ".length;
      if (this.peek("(") || this.peek("new ") || this.peek("<")) {
        this.i = start;
        this.skipBalanced("{", "}");
        return { ref: this.s.slice(start, this.i) };
      }
      const k = this.key();
      this.eat("?");
      if (this.peek("(") || this.peek("<")) {
        this.i = start;
        this.skipBalanced("{", "}");
        return { ref: this.s.slice(start, this.i) };
      }
      this.expect(":");
      out[k] = this.type();
      if (!this.eat(";")) this.eat(",");
    }
    return out;
  }
  private tuple(): TypeValue {
    this.expect("[");
    const out: TypeValue[] = [];
    while (!this.eat("]")) {
      out.push(this.type());
      this.eat(",");
    }
    return out;
  }
}

export interface AnalysisType {
  readonly type: string;
  readonly nullable: boolean;
  readonly printed?: string;
}

export interface Analysis {
  readonly kind: string;
  /** Columns of a `*` expansion are marked `star`: their order is the object type's, not the statement's. */
  readonly cols: readonly ({ readonly name: string; readonly star?: true } & AnalysisType)[];
  /** By parameter number (1-based). */
  readonly params: { readonly [n: number]: AnalysisType };
  readonly max: number;
  readonly names: readonly string[];
}

export interface AnalysisError {
  readonly error: string;
  readonly pos: number | null;
}

export function readAnalysis(text: string): Analysis | AnalysisError {
  const err = /^__T\.SqlError<(.*), (\d+|null|number)>$/s.exec(text);
  if (err) {
    let error = err[1]!;
    try {
      error = JSON.parse(error) as string;
    } catch {
      // not a plain literal
    }
    return { error, pos: err[2] === "null" || err[2] === "number" ? null : Number(err[2]) };
  }
  const v = asRecord(parseTypeText(text));
  if (!v) throw new Error(`not an analysis: ${text.slice(0, 200)}`);
  const cols = Array.isArray(v.cols) ? (v.cols as readonly TypeValue[]) : [];
  const params: Record<number, AnalysisType> = {};
  const ps = asRecord(v.params);
  if (ps) for (const [k, p] of Object.entries(ps)) params[Number(k)] = typeOf(p);
  return {
    kind: String(v.kind),
    cols: cols.flatMap((c) => {
      const r = asRecord(c);
      if (!r) return [{ name: "?", type: "?", nullable: true }];
      const star = asRecord(r.star);
      if (star) return Object.entries(star).map(([name, t]) => ({ name, star: true as const, ...typeOf(t) }));
      return [{ name: String(r.n), ...typeOf(r.t) }];
    }),
    params,
    max: typeof v.max === "number" ? v.max : 0,
    names: Array.isArray(v.names) ? (v.names as readonly TypeValue[]).map(String) : [],
  };
}

export const asRecord = (v: TypeValue | undefined): TypeRecord | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !("union" in v) && !("and" in v) && !("ref" in v) ? (v as TypeRecord) : null;

function typeOf(v: TypeValue | undefined): AnalysisType {
  // a parameter used in several places is a union; a use that gives no type (`$1 IS NULL`) is `unknown`
  if (typeof v === "object" && v !== null && "union" in v) {
    const all = (v.union as readonly TypeValue[]).map(typeOf);
    const typed = all.filter((x) => x.type !== "unknown");
    const types = new Set((typed.length ? typed : all).map((x) => x.type));
    const nullable = all.some((x) => x.nullable);
    if (types.size === 1) return { type: [...types][0]!, nullable };
    return { type: "?", nullable, printed: [...types].join(" | ") };
  }
  const t = asRecord(v);
  if (!t) return { type: "?", nullable: true };
  const nullable = t.nullable === true;
  const ty = t.type;
  if (typeof ty === "string") return { type: ty, nullable };
  if (ty === null) return { type: "null", nullable };
  // an array of a shaped type prints as a template literal: `${Shaped<"json", …>}[]`
  // Stryker disable next-line ConditionalExpression: without a ref there is nothing for the pattern to match
  if (typeof ty === "object" && "ref" in ty) {
    const m = /^`\$\{.*?\bShaped<"(\w+)",.*\}((?:\[\])+)`$/s.exec(ty.ref as string);
    if (m) return { type: `${m[1]}${m[2]}`, nullable, printed: ty.ref as string };
  }
  if (typeof ty === "object" && "and" in ty) {
    const base = (ty.and as readonly TypeValue[]).find((x): x is string => typeof x === "string");
    if (base !== undefined) return { type: base, nullable, printed: JSON.stringify(ty) };
  }
  return { type: "?", nullable, printed: JSON.stringify(ty) };
}
