import { describe, expect, it } from "vitest";
import { createSql } from "../../src/index.js";
import { param } from "../../src/runtime/inline.js";
import { pendingParams } from "../../src/runtime/inline.js";

interface DB {
  users: {
    id: { type: "int4"; nullable: false; hasDefault: true };
    email: { type: "text"; nullable: false; hasDefault: false };
    age: { type: "int4"; nullable: true; hasDefault: false };
  };
}
const sql = createSql<DB>();

describe("inline parameters", () => {
  it("become $n in order of appearance, values in the same order", () => {
    const q = sql(`SELECT id FROM users WHERE id = ${sql.param(7)} AND email = ${sql.param("a@b.c")}`);
    expect(q).toEqual({ text: "SELECT id FROM users WHERE id = $1 AND email = $2", values: [7, "a@b.c"] });
  });

  it("are numbered after positional and named parameters", () => {
    expect(sql(`SELECT id FROM users WHERE id = $1 AND email = ${sql.param("e")}`, 5)).toEqual({
      text: "SELECT id FROM users WHERE id = $1 AND email = $2",
      values: [5, "e"],
    });
    expect(sql(`SELECT id FROM users WHERE id = :id AND email = ${sql.param("e")}`, { id: 5 })).toEqual({
      text: "SELECT id FROM users WHERE id = $1 AND email = $2",
      values: [5, "e"],
    });
  });

  it("never put the value into the SQL text", () => {
    const evil = "x'; DROP TABLE users; --";
    const q = sql(`SELECT id FROM users WHERE email = ${sql.param(evil)}`);
    expect(q.text).toBe("SELECT id FROM users WHERE email = $1");
    expect(q.values).toEqual([evil]);
  });

  it("keep objects, arrays, dates and null as values", () => {
    const d = new Date(0);
    const q = sql.as<{ id: number }>(`SELECT id FROM users WHERE created_at > ${param(d)} AND id = ANY(${param([1, 2])}) AND meta = ${param({ a: 1 })} AND age IS NOT DISTINCT FROM ${param(null)}`);
    expect(q.values).toEqual([d, [1, 2], { a: 1 }, null]);
    expect(q.values[0]).toBe(d);
  });

  it("work in fragments, which resolve them at creation and can be reused", () => {
    const byAge = sql.fragment(`AND age > ${sql.param(18)}`);
    expect(byAge).toEqual({ text: "AND age > $1", values: [18] });
    const q1 = sql(`SELECT id FROM users WHERE email = ${sql.param("a")} {byAge}`, { byAge });
    expect(q1).toEqual({ text: "SELECT id FROM users WHERE email = $1 AND age > $2", values: ["a", 18] });
    const q2 = sql("SELECT id FROM users WHERE true {byAge}", { byAge });
    expect(q2).toEqual({ text: "SELECT id FROM users WHERE true AND age > $1", values: [18] });
  });

  it("are rejected inside quoted strings and comments", () => {
    expect(() => sql.as(`SELECT '${param(1)}'`)).toThrow(/inside a quoted string/);
    expect(() => sql.as(`SELECT 1 -- ${param(1)}\n`)).toThrow(/inside a comment/);
    expect(() => sql.as(`SELECT "${param(1)}"`)).toThrow(/inside a quoted identifier/);
  });

  it("are single-use: a token cannot be replayed in another statement", () => {
    const token = param(1);
    sql.as(`SELECT ${token}`);
    expect(() => sql.as(`SELECT ${token}`)).toThrow(/already used/);
  });

  it("a token repeated within one statement binds the value at each occurrence", () => {
    const token = param(3);
    expect(sql.as(`SELECT ${token}, ${token}`)).toEqual({ text: "SELECT $1, $2", values: [3, 3] });
  });

  it("cannot be forged: a NUL in the text that is not a token is an error", () => {
    expect(() => sql.as("SELECT '\u0000typesql0000\u0000'")).toThrow();
    expect(() => sql.as("SELECT \u0000typesqldeadbeefdeadbeef0\u0000")).toThrow(/NUL character/);
  });

  it("leave nothing pending after use", () => {
    const before = pendingParams();
    sql(`SELECT id FROM users WHERE id = ${sql.param(1)}`);
    sql.fragment(`AND id = ${sql.param(2)}`);
    expect(pendingParams()).toBe(before);
  });
});
