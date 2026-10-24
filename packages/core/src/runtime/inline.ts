import type { InlineMarker } from "../engine/inline.js";

/**
 * Runtime side of inline parameters.
 *
 * `param(value)` returns a token string (NUL-delimited, with a per-process random prefix, so it
 * cannot be forged by user input and never collides with SQL text) and remembers the value.
 * `resolveInline(text, start)` replaces the tokens with `$start+1`, `$start+2`, … and returns
 * the values in that order; a token whose value is `undefined` becomes `DEFAULT` and takes no
 * number. Each token is consumed by the statement that uses it; a fragment resolves its tokens
 * when it is created, so fragments can be reused.
 *
 * The declared return type is the type-level marker (`InlineMarker<T>`), which encodes the
 * value's TS type for the compile-time checks; the runtime string differs on purpose.
 */
const PREFIX = randomHex(8);
const TOKEN = new RegExp(`\\u0000typesql${PREFIX}([0-9a-z]+)\\u0000`, "g");
const pending = new Map<string, unknown>();
let counter = 0;

/** Bind `value` as a parameter at this position of a template literal (`DEFAULT` when it is `undefined`). */
export function param<const T>(value: T): InlineMarker<T> {
  const token = `\u0000typesql${PREFIX}${(counter++).toString(36)}\u0000`;
  pending.set(token, value);
  return token as InlineMarker<T>;
}

const EXACT = new RegExp(`^\\u0000typesql${PREFIX}[0-9a-z]+\\u0000$`);

/**
 * A value passed as a value rather than in the SQL text (a `sql.set` / `sql.values` value, a
 * positional or named argument): a `sql.json()` or `sql.param()` token is replaced by the value
 * it holds (a `JsonParam` for `sql.json()`), and consumed. Anything else is returned as it is.
 */
export function takeValue(value: unknown): unknown {
  if (typeof value !== "string" || value.charCodeAt(0) !== 0 || !EXACT.test(value)) return value;
  if (!pending.has(value)) throw new Error("typesql: this sql.json() / sql.param() value was already used by another statement; call it once per statement");
  const v = pending.get(value);
  pending.delete(value);
  return v;
}

/** Number of tokens created but not yet used (for leak diagnostics in tests). */
export function pendingParams(): number {
  return pending.size;
}

export function hasInline(text: string): boolean {
  return text.includes("\u0000");
}

/**
 * Replace inline tokens with `$k` (k = start + 1, …) outside quotes and comments (a token whose
 * value is `undefined` with `DEFAULT`, taking no number); tokens inside a quoted string, quoted
 * identifier or comment are an error (the type checker rejects them too).
 */
export function resolveInline(text: string, start: number): { text: string; values: unknown[] } {
  const opaque = opaqueRanges(text);
  const values: unknown[] = [];
  const used: string[] = [];
  let k = start;
  const out = text.replace(TOKEN, (token: string, _id: string, offset: number) => {
    const inside = opaque.find(([a, b]) => offset >= a && offset < b);
    if (inside) throw new Error(`typesql: sql.param() cannot be used inside ${inside[2]}; remove the surrounding quotes or comment`);
    if (!pending.has(token)) throw new Error("typesql: this sql.param() value was already used by another statement; call sql.param() once per statement");
    const value = pending.get(token);
    used.push(token);
    if (value === undefined) return "DEFAULT";
    values.push(value);
    return `$${++k}`;
  });
  for (const t of used) pending.delete(t);
  if (out.includes("\u0000")) throw new Error("typesql: the SQL text contains a NUL character that is not a sql.param() token");
  return { text: out, values };
}

/** `[start, end, description]` of quoted strings, quoted identifiers and comments. */
function opaqueRanges(text: string): [number, number, string][] {
  const ranges: [number, number, string][] = [];
  const len = text.length;
  let i = 0;
  while (i < len) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < len) {
        if (text[j] === c) {
          if (text[j + 1] === c) { j += 2; continue; }
          break;
        }
        j++;
      }
      ranges.push([i, j + 1, c === "'" ? "a quoted string" : "a quoted identifier"]);
      i = j + 1;
    } else if (c === "-" && text[i + 1] === "-") {
      const j = text.indexOf("\n", i);
      const end = j === -1 ? len : j;
      ranges.push([i, end, "a comment"]);
      i = end;
    } else if (c === "/" && text[i + 1] === "*") {
      const j = text.indexOf("*/", i + 2);
      const end = j === -1 ? len : j + 2;
      ranges.push([i, end, "a comment"]);
      i = end;
    } else {
      i++;
    }
  }
  return ranges;
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  const crypto = (globalThis as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (crypto) crypto.getRandomValues(a);
  else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
