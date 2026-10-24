/**
 * Printing types into the cache file. Everything is printed relative to the probe file, which
 * sits next to the cache file, so the import paths TypeScript writes resolve from there, and
 * `__T.X` names `@typesql/core/engine` (the probe imports it as `__T`, like the rendered cache).
 *
 * Results (what an entry stores) may name any type the cache file can import: they only refer
 * to it. Snapshots (what an entry is checked against) must not name the project's own types:
 * a reference would follow every change to that type and never make the entry stale, so those
 * types are written out member by member (`snapshot`).
 */
import type { Checker, Symbol as TsSymbol, Type } from "typescript/async";
import type { Node } from "typescript/ast";

/** TypeFormatFlags.NoTruncation, without UseAliasDefinedOutsideCurrentScope: aliases the probe cannot name are expanded. */
const FLAGS = 1;
/** SymbolFlags.Type. */
const TYPE_MEANING = 788968;
/** SymbolFlags.Optional. */
const OPTIONAL = 16777216;

const KEYWORDS = new Set([
  "string", "number", "boolean", "bigint", "symbol", "null", "undefined", "unknown", "any", "never", "void", "object",
  "true", "false", "readonly", "keyof", "typeof", "unique", "infer", "extends", "is", "asserts", "this", "new", "in", "out",
]);

export class Printer {
  private readonly globals = new Map<string, Promise<boolean>>();
  private readonly checker: Checker;
  private readonly at: Node;
  /** Paths of `@typesql/core`'s own declarations (src or dist). */
  private readonly isCorePath: (path: string) => boolean;

  constructor(checker: Checker, at: Node, isCorePath: (path: string) => boolean) {
    this.checker = checker;
    this.at = at;
    this.isCorePath = isCorePath;
  }

  print(type: Type): Promise<string> {
    return this.checker.typeToString(type, this.at, FLAGS);
  }

  /**
   * The first name in `text` that a snapshot must not contain: an import of anything but core,
   * or a bare name that is not a primitive, a probe alias (`__T`) or a global of the default
   * library / `@types`. `null` when there is none.
   */
  async foreign(text: string): Promise<string | null> {
    for (const name of names(text)) {
      if (name.startsWith("import:")) return name;
      if (!(await this.isGlobal(name))) return name;
    }
    return null;
  }

  private isGlobal(name: string): Promise<boolean> {
    let known = this.globals.get(name);
    if (!known) {
      known = this.checker.resolveName(name, TYPE_MEANING, this.at, false).then((sym) => {
        const path = sym?.declarations?.[0]?.path ?? "";
        return /\/lib\.[\w.]+\.d\.ts$/.test(path) || /\/node_modules\/@types\//.test(path);
      });
      this.globals.set(name, known);
    }
    return known;
  }

  /**
   * `type` written with only core and global names: printed as is when that already holds,
   * otherwise rebuilt member by member. `null` when it cannot be (a function type, a class with
   * private members, more than `depth` levels of user types).
   */
  async snapshot(type: Type, depth = 8): Promise<string | null> {
    const text = await this.print(type);
    if ((await this.foreign(text)) === null) return text;
    if (depth === 0) return null;
    const c = this.checker;
    if (type.isUnionType() || type.isIntersectionType()) {
      const parts = await Promise.all(((await type.getTypes()) ?? []).map((t) => this.snapshot(t, depth - 1)));
      if (parts.some((p) => p === null)) return null;
      return parts.map((p) => `(${p})`).join(type.isUnionType() ? " | " : " & ");
    }
    const alias = await type.getAliasSymbol();
    if (alias && alias.declarations.some((d) => this.isCorePath(d.path))) {
      const args = await Promise.all((await type.getAliasTypeArguments()).map((t) => this.snapshot(t, depth - 1)));
      if (args.some((a) => a === null)) return null;
      return `__T.${alias.name}${args.length ? `<${args.join(", ")}>` : ""}`;
    }
    if (await c.isTupleType(type)) return null;
    if (await c.isArrayType(type)) {
      const [elem] = await c.getTypeArguments(type as never);
      const e = elem && (await this.snapshot(elem, depth - 1));
      return e === null || e === undefined ? null : `readonly (${e})[]`;
    }
    if (!type.isObjectType()) return null;
    if ((await c.getSignaturesOfType(type, 0)).length || (await c.getSignaturesOfType(type, 1)).length) return null;
    const members: string[] = [];
    for (const info of await c.getIndexInfosOfType(type)) {
      const k = await this.snapshot(info.keyType, depth - 1);
      const v = await this.snapshot(info.valueType, depth - 1);
      if (k === null || v === null) return null;
      members.push(`${info.isReadonly ? "readonly " : ""}[key: ${k}]: ${v}`);
    }
    for (const prop of await c.getPropertiesOfType(type)) {
      const member = await this.member(prop, depth);
      if (member === null) return null;
      members.push(member);
    }
    return `{ ${members.join("; ")} }`;
  }

  private async member(prop: TsSymbol, depth: number): Promise<string | null> {
    const c = this.checker;
    const optional = (prop.flags & OPTIONAL) !== 0;
    const t = optional ? await c.getNonMissingTypeOfSymbol(prop) : await c.getTypeOfSymbol(prop);
    const v = await this.snapshot(t, depth - 1);
    if (v === null) return null;
    return `${(await c.isReadonlySymbol(prop)) ? "readonly " : ""}${JSON.stringify(prop.name)}${optional ? "?" : ""}: ${v}`;
  }
}

/**
 * Type names in printed type text: `import:<path>` for an import type of anything but core,
 * bare identifiers in type position otherwise (not property names, not after `.`, not in
 * string literals, not `__T.` names).
 */
export function names(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < text.length && text[i] !== ch) i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (text.startsWith("import(", i)) {
      const m = /^import\("([^"]*)"\)/.exec(text.slice(i));
      out.push(`import:${m?.[1] ?? "?"}`);
      i += m ? m[0].length : 7;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[\w$]/.test(text[j]!)) j++;
      const id = text.slice(i, j);
      let k = j;
      while (text[k] === " ") k++;
      const isProperty = text[k] === ":" || (text[k] === "?" && text[k + 1] === ":") || text[i - 1] === ".";
      if (!isProperty && !KEYWORDS.has(id) && id !== "__T") out.push(id);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

/** The modules a printed type may spell core's types through: the engine entry (`__T`) and the root. */
export const CORE_SPECIFIERS: readonly string[] = ["@typesql/core/engine", "@typesql/core"];

/** Core types as `__T.X` however TypeScript chose to spell them. */
export const coreNames = (text: string, coreSpecifiers: readonly string[] = CORE_SPECIFIERS): string =>
  coreSpecifiers.reduce((t, spec) => t.replaceAll(`import(${JSON.stringify(spec)}).`, "__T."), text);
