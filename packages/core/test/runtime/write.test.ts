import { describe, expect, it } from "vitest";
import { createSql, type Col, type Generated, type Nullable } from "../../src/index.js";
import { pendingParams } from "../../src/runtime/inline.js";

interface DB {
  users: { id: Generated<"int4">; email: Col<"text">; display_name: Nullable<"text">; score: Generated<"int4"> };
}
const sql = createSql<DB>();

describe("sql.param with undefined", () => {
  it("sends a parameter, or DEFAULT for undefined without taking a number", () => {
    const score: number | undefined = undefined;
    const name: string | null | undefined = null;
    const q = sql(`INSERT INTO users (email, score, display_name) VALUES (${sql.param("a")}, ${sql.param(score)}, ${sql.param(name)}) RETURNING id`);
    expect(q).toEqual({ text: "INSERT INTO users (email, score, display_name) VALUES ($1, DEFAULT, $2) RETURNING id", values: ["a", null] });
    const q2 = sql(`UPDATE users SET score = ${sql.param(7 as number | undefined)} WHERE id = $1`, 3);
    expect(q2).toEqual({ text: "UPDATE users SET score = $2 WHERE id = $1", values: [3, 7] });
    expect(pendingParams()).toBe(0);
  });
  it("is resolved when a fragment is created, and fragments renumber after it", () => {
    // @ts-expect-error a fragment refuses a value that can be undefined; at runtime it is still DEFAULT
    const f = sql.fragment(`${sql.param(undefined)}, ${sql.param(1)}`);
    expect(f).toEqual({ text: "DEFAULT, $1", values: [1] });
    const q = sql.as(`INSERT INTO users (email, score, id) VALUES (${sql.param(undefined as string | undefined)}, {f})`, { f });
    expect(q).toEqual({ text: "INSERT INTO users (email, score, id) VALUES (DEFAULT, DEFAULT, $1)", values: [1] });
  });
});

describe("sql.set", () => {
  it("assigns the defined values in key order", () => {
    const set = sql.set("users", { email: "a", display_name: undefined, score: 0 });
    expect(set).toEqual({ text: '"email" = $1, "score" = $2', values: ["a", 0] });
    expect(sql.set("users", { display_name: null })).toEqual({ text: '"display_name" = $1', values: [null] });
    const q = sql("UPDATE users SET {set} WHERE id = $1", { set }, 9);
    expect(q).toEqual({ text: 'UPDATE users SET "email" = $2, "score" = $3 WHERE id = $1', values: [9, "a", 0] });
  });
  it("throws when nothing is defined", () => {
    expect(() => sql.set("users", {})).toThrow(/sql.set\(\) got no defined values/);
    expect(() => sql.set("users", { email: undefined })).toThrow(/nothing to update/);
  });
  it("quotes keys", () => {
    expect(sql.set("users", { ['we"ird' as "email"]: "x" })).toEqual({ text: '"we""ird" = $1', values: ["x"] });
  });
});

describe("sql.values", () => {
  it("collects the columns over all rows; missing and undefined values are DEFAULT", () => {
    const v = sql.values("users", [{ email: "a" }, { email: "b", score: 2, display_name: undefined }, { display_name: null, email: "c" }]);
    expect(v).toEqual({ text: '("email", "score", "display_name") VALUES ($1, DEFAULT, DEFAULT), ($2, $3, DEFAULT), ($4, DEFAULT, $5)', values: ["a", "b", 2, "c", null] });
    const q = sql("INSERT INTO users {v} RETURNING id", { v });
    expect(q.text).toBe('INSERT INTO users ("email", "score", "display_name") VALUES ($1, DEFAULT, DEFAULT), ($2, $3, DEFAULT), ($4, DEFAULT, $5) RETURNING id');
  });
  it("renumbers after the outer parameters", () => {
    const v = sql.values("users", [{ email: "a", score: 1 }]);
    const q = sql("INSERT INTO users {v} ON CONFLICT (email) DO UPDATE SET score = $1", { v }, 5);
    expect(q).toEqual({ text: 'INSERT INTO users ("email", "score") VALUES ($2, $3) ON CONFLICT (email) DO UPDATE SET score = $1', values: [5, "a", 1] });
  });
  it("one row without values is DEFAULT VALUES; empty input throws", () => {
    const one = sql.values("users", [{ email: "a" }].map(() => ({}) as { email: string }));
    expect(one).toEqual({ text: "DEFAULT VALUES", values: [] });
    expect(() => sql.values("users", [])).toThrow(/needs at least one row/);
    expect(() => sql.values("users", [{} as { email: string }, {} as { email: string }])).toThrow(/several all-default rows/);
  });
});
