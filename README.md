# TypeSQL

[![PostgreSQL 18 regression suite: 49,999 of 49,999 checkable statements agree](https://img.shields.io/badge/PostgreSQL%2018%20regression%20suite-100%25%20agreement-336791?logo=postgresql&logoColor=white)](#tested-against-postgresqls-own-test-suite)

Type-level Postgres SQL for TypeScript. You write a SQL string literal; the compiler parses
it **inside the type system** and gives you the exact row type, the parameter types, and
(for DDL) the resulting schema. No codegen, no database connection, no build step. The parser
agrees with Postgres on [every checkable statement of PostgreSQL's own regression tests](#tested-against-postgresqls-own-test-suite).

![TypeSQL demo: highlighted SQL with table and column completions inside a query, hovering a query shows its inferred row type, and a misspelled column is a compile error](assets/demo.gif)

**[Try it in the TypeScript Playground](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZAXKACgewM4BcBzAJ1h1CWQBpRoBDInWAE1ACNIIYEBjIgS2h4A5GTxdQOSPlgBbAHSgAokz55QeABaxyKULQB2LDVgBusIuq3quOVACgQoIlgDuZAyzpFaM2HnNkAGZYADYhrtQeoDJ8+LQA1qR6JKDcWDLQfCHa5s4MoFj6ltr4-PoEcnZ8GVhEagDeqSS0-vAAjiHUYnCgAMKhXeIA4rD65i3Mgz0AcgCuYbSs2VPaGPQ+OFBwK6AASq5b2gC+oIHOMqAARAAC3aQdwGkklwDcdlX6-kSBtNzaACIAIVA9TsoFAs0YDHQoPB4L4THQIzG3n8TAAPJc+J8ACyXAB8L1Ajg0tHcoCYsB+8zw6Cwgj4hVoIQKRQAktN4IpduAwXDZLQsuh+iFMf4AB54AlvOEU2LQEK0SAAfX0Plg6DmCyWsDFsEl0r54N4sAmTGVLSRo3GaLF1VIeB8ggAXobwUcZTRcHhbCCjaAEVaUWbMdi8AAON1w2izTS1ZWBvqhUO4qPgvCqbLC5OXCVSwn+1hYJiQTXzRU6vUGgvut5Hd5pfT4CQdUAAXiaptaHXRQPxAAoAJRvBxgZCKABi4FAACkAPIc6IJJKabT8AgaNQ4BHafTlxbZIkAEgAjOpl2RVKJxGd0hC5AjKo3m212y2Qv2AAZc8e9aezB8mGoACBSyahoDkDM8Gyf1ZTg8EJ12OcAFkIShMhZlAccp1nBdpi9fAyGgUA53wiCYzjIgExYDsAIRWD4NlAB1AAJblFHvBE31PT9qAAdmHOw7j2Vw332FxDnRO4sECUA2gLRxwQAPQAfiE8Q1m8GQyA7TSNkk6TZPkt5FNAVT3kcABBAhiFgAgJncQxUlCWYZCKNVfCCUJwhcTBvVs300lmT5+wAKkHANL0+cNIgkPAygICFDHMUB9GLWAAFpoH8kgcCfQpmziH03xwDovx-RQ-z0WNjCohFqCCkLwuoGRaHFfsoOyCLLPgUBFX8ZtEJQgjiqGJCAFUMFAQEAE1qso6jP0E4T4EdYqO3EgyuBkuKWhwBSwGUtTR1ANl9BCbFtBMZlZiSegSlGNQyVAI8ii8dUvkclhuC0bhEhYWh7OxZsXC0FJVw4e60OYfKmzUUCWQ7S5aCYWhrn1J1sjkNIZFeOxnzUE0zRKsrPw5LkeVO6ZwDnaH8n7BGIoANUs5BxsUXr+yPepSpCOR3pkBnWqyQcjgi3ZFHAcbdmmDkhgDIDOzNC08CWt5hN6Zo0TEg4uCk7bZKJtEDrhcyTuQ2JHUSdwUhxzJslAXJajIQpih0ZA4oShQJz4cVihkexefKxRf2nfRfFAIbUMhAI1eJMAnaIdA0hCVyikucPYEuCksCSNL4fFS27CDsnOW5acORpkayA6zNYGZ1n2c509B14q4WNgMIsEuYd48dog8nQCjauoyLQGmOdp2mcbkA9qJSTINKKSpGMQjwOwgA)** <!-- playground:core -->: edit the SQL and hover the types,
with nothing to install. The Playground runs TypeScript 6, which TypeSQL does not support, so treat
it as a demo; TypeSQL requires TypeScript 7.1.

```ts
import { createSql, type Col, type Generated, type Nullable } from "@typesql/core";

interface DB {
  users: {
    id: Generated<"int4">;          // has a default → optional on INSERT
    email: Col<"text">;
    display_name: Nullable<"text">;
    created_at: Generated<"timestamptz">;
  };
  posts: {
    id: Generated<"int8">;
    author_id: Col<"int4">;
    title: Col<"text">;
    body: Nullable<"text">;
  };
}

const sql = createSql<DB>();

const q = sql(`SELECT u.id, u.email, p.title
               FROM users u LEFT JOIN posts p ON p.author_id = u.id
               WHERE u.id = $1`, 7);
//    ^? Query<{ id: number; email: string; title: string | null }, [number | null]>

// values inline, sent as $n parameters and type-checked against their context
sql(`SELECT id FROM users WHERE email = ${sql.param(email)} AND id > ${sql.param(10)}`);

sql("SELECT nme FROM users");
//   ~~~~~~~~~~~~~~~~~~~~~~  Argument of type '"SELECT nme FROM users"' is not assignable to
//                           parameter of type 'SqlError<"column \"nme\" does not exist", 1>'
```

The runtime is a thin object `{ text, values }`; `@typesql/pg` and `@typesql/postgres` run it.
Already using Kysely, Drizzle or Prisma? `@typesql/kysely`, `@typesql/drizzle` and
`@typesql/prisma` take the schema from it.

```ts
import { createSql } from "@typesql/pg";             // pg's type map, queries run on the pool
const sql = createSql<DB>(pool);

const posts = await sql("SELECT id, title FROM posts WHERE author_id = $1", 1).execute();
//    ^? { id: string; title: string }[]
const user = await sql("SELECT id, email FROM users WHERE id = $1", 7).executeTakeFirstOrThrow();

await sql.transaction(async (tx) => {                // tx: sql bound to one transaction
  await tx("UPDATE posts SET title = upper(title) WHERE author_id = $1", 1).execute();
});
```

## Editor completions

The TypeSQL extension for VS Code
([Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=typesql.typesql),
[Open VSX](https://open-vsx.org/extension/typesql/typesql)) suggests what can come next inside
`sql()` strings: tables, views and schemas after `FROM`, `JOIN`, `INTO` and `UPDATE`, and
columns with their Postgres types after `alias.` and in expressions. It is an optional
companion: TypeSQL checks statements and infers row types without it, so install it only if you
want completions.

```ts
sql("SELECT * FROM |");          // users, posts
sql("SELECT u.| FROM users u");  // id: int4, email: text, display_name: text | null
```

The names come from the `DB` type of the `sql` you call, unsaved edits included. Errors, hovers
and row types stay TypeScript's own. It needs `@typesql/core` 0.4.0 or later and a language
server on TypeScript 7.1; [Editor completions](packages/docs/guide/editor.md) covers the setup.
The extension also highlights the SQL in these strings, with no setup. The source is in
[`packages/vscode`](packages/vscode).

## Packages

| Package | Role | Peer dependency | Playground |
|---|---|---|---|
| [`@typesql/core`](packages/core) | type engine | none | [open](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZAXKACgewM4BcBzAJ1h1CWQBpRoBDInWAE1ACNIIYEBjIgS2h4A5GTxdQOSPlgBbAHSgAokz55QeABaxyKULQB2LDVgBusIuq3quOVACgQoIlgDuZAyzpFaM2HnNkAGZYADYhrtQeoDJ8+LQA1qR6JKDcWDLQfCHa5s4MoFj6ltr4-PoEcnZ8GVhEagDeqSS0-vAAjiHUYnCgAMKhXeIA4rD65i3Mgz0AcgCuYbSs2VPaGPQ+OFBwK6AASq5b2gC+oIHOMqAARAAC3aQdwGkklwDcdlX6-kSBtNzaACIAIVA9TsoFAs0YDHQoPB4L4THQIzG3n8TAAPJc+J8ACyXAB8L1Ajg0tHcoCYsB+8zw6Cwgj4hVoIQKRQAktN4IpduAwXDZLQsuh+iFMf4AB54AlvOEU2LQEK0SAAfX0Plg6DmCyWsDFsEl0r54N4sAmTGVLSRo3GaLF1VIeB8ggAXobwUcZTRcHhbCCjaAEVaUWbMdi8AAON1w2izTS1ZWBvqhUO4qPgvCqbLC5OXCVSwn+1hYJiQTXzRU6vUGgvut5Hd5pfT4CQdUAAXiaptaHXRQPxAAoAJRvBxgZCKABi4FAACkAPIc6IJJKabT8AgaNQ4BHafTlxbZIkAEgAjOpl2RVKJxGd0hC5AjKo3m212y2Qv2AAZc8e9aezB8mGoACBSyahoDkDM8Gyf1ZTg8EJ12OcAFkIShMhZlAccp1nBdpi9fAyGgUA53wiCYzjIgExYDsAIRWD4NlAB1AAJblFHvBE31PT9qAAdmHOw7j2Vw332FxDnRO4sECUA2gLRxwQAPQAfiE8Q1m8GQyA7TSNkk6TZPkt5FNAVT3kcABBAhiFgAgJncQxUlCWYZCKNVfCCUJwhcTBvVs300lmT5+wAKkHANL0+cNIgkPAygICFDHMUB9GLWAAFpoH8kgcCfQpmziH03xwDovx-RQ-z0WNjCohFqCCkLwuoGRaHFfsoOyCLLPgUBFX8ZtEJQgjiqGJCAFUMFAQEAE1qso6jP0E4T4EdYqO3EgyuBkuKWhwBSwGUtTR1ANl9BCbFtBMZlZiSegSlGNQyVAI8ii8dUvkclhuC0bhEhYWh7OxZsXC0FJVw4e60OYfKmzUUCWQ7S5aCYWhrn1J1sjkNIZFeOxnzUE0zRKsrPw5LkeVO6ZwDnaH8n7BGIoANUs5BxsUXr+yPepSpCOR3pkBnWqyQcjgi3ZFHAcbdmmDkhgDIDOzNC08CWt5hN6Zo0TEg4uCk7bZKJtEDrhcyTuQ2JHUSdwUhxzJslAXJajIQpih0ZA4oShQJz4cVihkexefKxRf2nfRfFAIbUMhAI1eJMAnaIdA0hCVyikucPYEuCksCSNL4fFS27CDsnOW5acORpkayA6zNYGZ1n2c509B14q4WNgMIsEuYd48dog8nQCjauoyLQGmOdp2mcbkA9qJSTINKKSpGMQjwOwgA) <!-- playground:core --> |
| [`@typesql/pg`](packages/pg) | driver | `pg` ≥ 8 | [open](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZUB3AlgFwBagHYD2AJrALTSEDOWA5gE6xWgAUAAljEwI4A2w0WgEoAdKEQBXWPQxNQ9CflCElkQhPqgACoUK8ANKACG+YvMJpmRxqE5wzAI0jocRrACgQoQQHJmpADMjCV4sb2sqaWZGLA18AC5QDHwsAA5jUwIJAFtpDABjY2YaGXxaKkMsDFyaI2zoK2YAETdYMQAJQgA3aVscWHkmEKwqEXdqynowgG9tXV5QAF9QAPpCbNAAIkFNgG5x+sIp0Fn8xlb4PiWVtY3Nji4qPgFaPYPJsLsB2YBhPUMAOKwfDSVrEQwAORCvCMDl4A2Wq3WWwecCe-HyR1gb08YAA6jIsANcBhmE5QK5TIYjqBaMDQUSkmEkRs1BpQMQ3LCjJFEgADL7opIpNZUOD5MJkMgaBaAMgJQFL1GEqPl+tkjCIRnzxilpEF8gMmgAhE7uUCgCSRehURLTM3mpLERJAkH0MEAHk2ySwABZNgA+fYO0CwdUYXiJP68T1EgAeWADQYdxFJ0BhkAA+vg6rBElDeDC4bAY7B44n7eaHEYYfgDZG9J78Dk8vly8GzrAwRm3M76W6icQY9UmFg6tAsAAvNtLJOUGg203BjBO0AuhmwQdelKpafm4K4I4Z5f16Nb3272zYeEnktlwMV7wSOGk-rEbtYPPQ2Hwoc1Uf1Sdp0WfZFncdxMXwGhvHmUAAF4CFgNA5j0FhThUEEJQwFR4CwUpaESbZqDoRgbRAXhCHyascCI4AjGgaBNiWIR9ggqChXgjsLj4d1jX9FhKD0ZiwNYsInAAQQkA9NHg9EWD5eAAFFkAUn5wG8ERl0MaBNSvWAtJEaAn14F8N3fQwJBEUMjHDB9gzs+yHQAMQAJQAeQAWWg+dvFAAApVyAEkIQtK1mAkUBXOCizlzg9T92o+gj2IWyHNS808XaBTnIUuLJISpLYoAEgARj5QwAHYhJEryRliow0Gs0TIAkqTLNjWB8kk2AWCErwHQAPQAfmElQoMtXp4PqxrQFk+SlJUtTNNAKsawNQxOIHd9QBcjyQqiUAMqynKrPDIrSsMTYjE5NhSzHeERExbJNlEUsOq68AjAAa1gRyMGtLBXPocAcDWNAev2PrzSGkbILCTFFFqyaGuwGa+DkxTlNU4w8sPJb4ZSFgACohFAMT4AIba3M8udaoBNyAFUtFAI0AE1sakpK+Re9rOqJcHcWDaGBawWMkmKK4HHUTIsEIZQQVsN1IKMTCVEjDz3ICtS0H6JRcAGAJFBVpQSL0HoKlANzkGQI0xJ+ABpFxgSZPpQdGcDRrCGmArMJHpvRTVFaoZWqhUFgeUgWtWBFknYP9RdQD66HzWq2YYuWX2UZFuSgsU5y1KC8BXL261WBOgxlurEwDRJgA1MTkHphTyZYErDEKgAmEnsvAennIhIKAUdMqtgYZXYBu2M7raR7NkMAAGbm3qJD7vt+-7AeB0H+eTj2arq5HPljbOIVz-OIULmrmDDnHEqWqosHhWv68b5vW9ADuu4Unu+4HofDCWzY7RYAFkIM9NqS9YArx+n9GgG8QYWG3oMWI9AlA0w0sQECQkBZaGsDmIkJdrADFVB1b6ZgjC0GsrDPosA-qgExLwHICR2b5RiqSYUvoxhTRRrNJo81wA5R2tTIizBDrZWYbjH279zpbHKmA16vNurMQTmAaQax6CJCMDNXCyRaBiwIIQMIJh2E+ncEAA) <!-- playground:pg --> |
| [`@typesql/postgres`](packages/postgres) | driver | `postgres` ≥ 3 | [open](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZUB3AlgFwBamgPYDOWA5gE6xEB0AVkaABQACWMVAjgDbCEkVUAlNVCIArrHIYqocmIB26bHiLdqCogEMAZrEZZYADywAaUADdNXCUUFnN8gCayCaIgCgQoTZVBs4zgBGkOg4mlj4xGSUNPT4PkRUAFygGPJYABypDJqgJFLypGYE5N6ggRikaRGYuKAAQpUAkunx5ERppKAE8tTuGAC2hOQR-rCgAN6g8NygAL6g2uQEA6AARHzRVGsA3P1DJRFTAMaU4bCNpC1YM1xmp7Dnt-OLy6trrOyqPJsCRLv7YajdiTUAAYQId1AAHFYPJJOdHGYAHJiLhcTSBLjjBZLFbrT5wb7AY4lWAA-rpSTaTTHcYAEXqk3coFAYkS7RSExZrNSjhSsPh5ERAB41tUACxrAB8e15oFgA00GC4KQhXDFBmMMrlvMcGCI0AxkAA+vJNANYClUejMdjNUYsDqeayHoiTeEBXCEQZHJrBlQsBboFgAF7O1lzXWbIhcl18r1C0Xi9IZCO8zRiXAlE0YfngyFiyXp1lYbDYtWFtZap2y+NB0ixgsa6uOgDaAF101H3HN3O5HLBjhjfKT5CRQI5AilbjtQF5fjFGBson8kiAuARjlYcFFgJpoNA1oJ3GOJ99QABeUBugy3EWM6WMKeCPannoTmNX7xoZURb6MAABvAACiyAgWC4B8mYZZYNiMGaI2oAAGIAEoAPIALKRCQDAAOoABIgahIGgAAJAAjN+ACCyIAJpMA2tiAWYazfMe1BGEOWZ6K+nhgLyAB6AD8-ZeOhii5GO8LHGWPRKHUgFjE2UwVFU6QpIuVDUJc1zzCxqSpt4Tg3gQChYIwABUgimZa5S0gA1t4DBqdUfSDsOPjjGeERTpcM7cCKqmVNUKSua0cx1j55SVN+t4XM06T3o+z6BJcfHRaS5kMNemi-tgMWkEBoHgZB3hZru5C5kipnmVZNnUfAoCKGhWE4VgDDQhhACqAAKDQMZm2ZVXmgHCFxxw8YwfFeEJon8XkahYMK460nJigGotXDUIEsDqXOWCGNQy0OFoskYPJm25Fo5iwIQbnuHlf5bcdK1netjCaEQkDyMcjGGDZl7SsyrJPQVh1AX19LUeApFfqBUGwdi35iIekj6OWsA2YRxGkUNlXVd+lEGQA7ONhjcQY026tFii5floyGEB9JgSBsMoRh2FfjjJE3j4+rmlw2CQPoiG2N+AAMY2cRTk0GBCdV8ays2siJvZ8e4AHAazZV5hzbXc0RvNMaAzDA8TrHsa+85gJIyzkCkJtm34mgOTIuQ1p27hAA) <!-- playground:postgres --> |
| [`@typesql/kysely`](packages/kysely) | ORM schema | `kysely` ≥ 0.27 | [open](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZUB3AlgFwBagNKQDOsANpKABQACWMsRAjqcANbFmQCUAdKAJoB7AK4AnAh3KgAIgCFQGAHZZYogGYBDAMawq7EuQC0WwQBNYAc1iLQIrNGFZbogFAhQODYtOG0o7CqKXApEoLi6RFo4sAC2GgA0oF6moKIaaKBIqKLCiqGCNpAi4oQGFEpEWF46fAASggBuqmHRqQzCpFhEPC4YMdCCok4A3hJliQAKgpUWogzSGBqksFpYiXRwoADCgqTCMYpQcOv0oADi1qoaKikAvqBqooIxoABE+pyvANy9-YMjoCmu1A90ezze0As31+AyGoFGWjm1wQzBBDyeL1etHoTBYH3I0LcYHxkGMZks1lsjgcazC-hiMVgphcG10AEllAAOUAAXm2u32h3oAB5Kv5FBZEgAjDAWJROAA+oEU+ylzSVYqUktAMrlylASpVMTV4g1WHFFgAfD9WRA+gwqv1efy9gcjrBhdJkYkvSoDaBNRKfcj-YGrTbTgBZQRmZ2vTzQaCQV7+15EDSmQny1SaHQyeTDFygUDCEiiIgALnhReLClMVYuiiuN2FRpN1prxdiGgwpCrYZ+tdAMRj9dA0djho6pEHtcRsGRpgA+tcG5c0i3wPbKhp+h3i7dZwNKpXq0OMGPG82mcKOVhOfvaxpHDhBkuL1W26pZ8WsNhlv25paj+oAOFKpAYEQ0SXuui7ClKMbLF4j6Hi4twuC4Jh5E4phSs6TYZKUnCerIlqUKMpiLMsqyfrAGRTDMcxEAsSwrFg5GgYhtH0YhlDBLc-FcD8WGVAGqJ8vOyLwMwJFkbhQkYe44CtIwwiqBQUrCL25jiGogzoJ4TjYKApiCAw6BkKQiRZA8+nhG0lSJFEKysEySQWD22EtBEu66FU4EMD0Ik4WkahdM66Q9jhUo8AYbEAGIYpQrzHl0ry8HFqyUAA2q8F6vIkrx-lgyyvAAurwaDRHMyVgRBUFMgVbw8k1mikCQvCwAAHisjiwHxPyYQUolITpCEaKIKR8rilAAAbwAAosgC1bOAJY8N2vaJMIPAjmYTkiMolDQDwF7BAAgvAnEnvEnZDvdD2PQ9aSKKwfGgAA8gAagtABKVAfb90h-aAsj8KAJi5OxJ1nTIC3wFsF1XdApDaLAd1PZjtbxb9H2RiWZahMIoDLfFa0AFIfWyABy13hdAn20ydz64G+F7Ojt7PndT0igTwdWQdBGNY5jADqtR-Qt617VNoAACQAIzCyLj1nLjACqEyg+DnOmLNhUJkm6XCcNTgva5suRcZo2qONk0bT1Wh9QNRJDgAegA-IpYAckQF66BoYycHSXjpqsGAFNKSgpIHuJhIIChOFgCcxBgXU6lppA6Uk3iZCgoCqaoGCBS4VvRTw5qh9of4FHxDu9SolAaEQkCKFoVDml1wQ8paZ5JGgUV0l1PDCNApjIuAGgBbV0xpRlsDsaMAsNWO5pqSClXVf1rws6+ojvpmhUtYkCudY7zsKcWZcQ0iKjSaQsmUJ3XBzcDy3gFLON43ToTi5LSQvjZrLRWoBua82ph9Nay9oL61AKfeuTtG4KQEoNGa80lorTWuzL++NSyqF-hLX6UsZbOkVrAneEpRDJiEqAdwqgniiE-IIJwgcGhLHXoINQ3lhyjlANYfYLggA) <!-- playground:kysely --> |
| [`@typesql/drizzle`](packages/drizzle) | ORM schema | `drizzle-orm` ≥ 0.45 | — |
| [`@typesql/prisma`](packages/prisma) | ORM schema | `@prisma/client` ≥ 7 | [open](https://www.typescriptlang.org/play/#code/PTAEBUE8AcFMGUCKAZUB3AlgFwBagAoBOGAzgLYCGoAFAAJYywkCOANsNMeRQJQB0EHLFAM4LVgFpOpSqADmsAHaxCFLAHtC6YliYihoACIAhUBkW7CAMwoBjYQCNYrdWgBQIUOsWhYANxVIUAADaW55JRU1WGCAGnRsPFxhABM1CgcKElgAchIvNB9FCjI9OkpoHnjirAwAkUZ8uhSHPgAqHlAKRRSPMBTYGwBXViwSAQAlCjRQJFRkn0IhxXzcQnUhuTxIDa0iGQoAYVYMJSwBAAl1AK1k0EImEbG+Pr7Qd4VlVQ1bxrZQADeb3e7041wwAy0AF5QAAiURMNhSLiUWHAkEbLDQIZYEEw2F8PjAEiEWzAFrABHiPhjNGed4AXzcGDI0E0uIBoFsD2i8DY8QRBBRFCmaGOpwsoAZoCs6zIcPof3YYVRAG5maz2Q04IDQId1Kx4gBxSLfWApeIAORGrAyrGE0tl6nlsMVYjYwFsmlgsPVbxJZIpVLYNJI8SyES+0V65ksNnsRlMQPewDabSFB1AZHUA1YIQAqtlCMEBG1gG53kMiyQAFyAisgiF1k1R3QpAA8sNjABZYQA+dUg3yUDCsOv61idvwUUk4Gf9wcg1Pp-bhKynVgpELFUol0BlhvvFKkaC2yAAfR3sDr1tYtoc9s7ugAHlgF4f7gbr6AW1E252Ji-d8h2XEJaCGaA0jbABBLBgjrbJcQcIJV1kcUzmqdRQCgjIslSQYKCeUtyyHCCoPNWDxwNJ8WSYLASmgYCpUXUDUKobNcxCfB1BIODiIbNleNreshybPVqNhIYhghJiUzTDM1w3LdgkI3BNAASRSPcDyHVScE0c8xInTse1kkRsHtKjJ3hWBXzMvxTjQYTfzNDsuwsAAOJiGUXAASKk62TEFAMsuFoMMABZdTLVhUAAB84XzeAAFEJl9BsfLcJk3AGWxbQeLlvF40AVQoOs2NFdCLFVUBPB2IY9mFKqsDcL0VlxcRQBhblYF5Nh2xMPtqFKngas8JYVi8HxfOYIZAlFfMVgoKxYHDVg0AoSB8kwXBQAccwt2gGcSlgSwSDcVqitxCgUjIcx8hhaYKGwUBxGoYIUuQZLDnAMwLWwk8z0vE74kkyDo1g2KADEJgAeQi0AqxUfIAHULlS5LP3tLrQF8gBGOIwsi6LYX4WzYFsHFYGoUb0VAAA9AB+C7PEApyugKhEtwjGa5sISBRXuU6Gsm5IyDrWMPLMfJ9rkWNqiGUpiFsaWjAplkKFYF42uK3i1AeroNpet6PuSr6fq6HF9MIQz-q9ZYsGoDpQGg+ASp4sZ4hIRXqAc2AnM6V3QD99mYfh92hJ-OH83wUBjAATUttSbYhYIyefCmqZp9V6XeJmLp13Fc1O80cae42QywVQltsWpvGoagsGfTooT7ERn3ewwzeS8BMbDhHBLGUA0YxpPrdtnH8cJvH08z3R9QdmnadzhnmbeQfxghVXaAGYZRmoKSISX8rhT1E4zhlUdWHyF7zHibjeLkB58hSdQ9EUdRzjcE3opSiZfuiuAWGEch7UD0gZCEAoLKwE6AANWgsgfMyU3bUHxvEXyAAmHg09QYXGcC4UmY0wAqHWIQCWW45z5A-thdImRsjYQIk8NwQA) <!-- playground:prisma --> |

Two more workspace packages are private and not published: `@typesql/docs` (the VitePress
documentation site) and `@typesql/bench` (compile-time budget and runtime benchmarks).

## What is inferred

| Feature | Status |
|---|---|
| SELECT: joins (nullability per join kind, USING/NATURAL), aliases, `*`/`t.*`, WHERE, GROUP BY/HAVING, ORDER BY, LIMIT/OFFSET/FETCH, DISTINCT [ON], FOR UPDATE | ✓ |
| Subqueries (scalar, EXISTS, IN, ANY/ALL), derived tables, LATERAL, CTEs incl. RECURSIVE (with SEARCH/CYCLE), UNION/INTERSECT/EXCEPT, VALUES, set-returning functions and ROWS FROM in FROM, TABLESAMPLE | ✓ |
| Expressions: operators with numeric/date/JSON/array rules, casts and typed literals (`timestamp with time zone '…'`), CASE, COALESCE/NULLIF/GREATEST/LEAST, IS [NORMALIZED], BETWEEN, IN, LIKE, `op ANY/ALL`, OVERLAPS, AT TIME ZONE / AT LOCAL, arrays, subscripts, EXTRACT and friends, named and VARIADIC arguments, window functions, SQL/XML (`XMLELEMENT`, `XMLSERIALIZE`, `XMLTABLE`, …) | ✓ |
| SQL/JSON: `JSON_OBJECT`, `JSON_ARRAY`, `JSON_OBJECTAGG`/`JSON_ARRAYAGG`, `JSON_VALUE`/`JSON_QUERY`/`JSON_EXISTS`, `IS JSON`, `JSON_TABLE` in FROM | ✓ |
| Function catalog (string, numeric, date/time, JSON, arrays, aggregates, window) with Postgres nullability; every other `pg_catalog` function known by return type; unknown functions are errors; app functions declared in `$functions` or via `FunctionCatalog` augmentation | ✓ |
| Parameters: `$n` typed from context (`WHERE id = $1` → `number`), `:name` sugar, inline `${sql.param(value)}` with value type checks | ✓ |
| Nullability narrowing: `WHERE c IS NOT NULL` / comparisons / inner-join conditions make `c` non-null | ✓ |
| Errors with token positions and "Perhaps you meant …" hints for unknown columns, relations and functions | ✓ |
| INSERT/UPDATE/DELETE/MERGE with RETURNING (incl. `old` / `new`), required-column checks, ON CONFLICT, `EXCLUDED`, array / field assignment targets | ✓ |
| Cursors: `DECLARE … CURSOR FOR query` is checked and its parameters typed; `FETCH` / `MOVE` / `CLOSE` parse (no row type: the query is another statement) | ✓ |
| Write helpers: `sql.param(x)` sends `DEFAULT` for `undefined`, typed `sql.set(table, partial)` and `sql.values(table, rows)` | ✓ |
| DDL → schema: `ApplyDdl<DB, "ALTER TABLE …">`, `migrations()` builder, views, enums, schemas | ✓ |
| Fragments: `{slot}` splicing with `$n` renumbering, `sql.fragment`, `sql.id`, `sql.join` (also over runtime arrays of typed elements), `sql.raw`; dynamic text falls back to `sql.as<Row>()` | ✓ |
| Postgres output column naming (`?column?`, `count`, `case`, `btrim`, casts → type name, last duplicate wins) | ✓ |

Unsupported syntax is a compile error with a Postgres-style message and a token position,
never a silent `any`.

## Tested against PostgreSQL's own test suite

The parser is checked against the regression tests PostgreSQL runs on itself
(`src/test/regress` of PostgreSQL 18.6, vendored as a submodule in `vendor/postgres` and never
edited): about 50,000 statements, from everyday queries to `MERGE`, SQL/JSON, `TABLESAMPLE`,
recursive CTEs with `SEARCH` / `CYCLE` and hundreds of deliberate syntax errors. For each one, the
expected output that ships with the tests says what Postgres did, and TypeSQL must do the same:
parse what Postgres parses, reject what it rejects.

| Statements | Agree with Postgres | Disagree | Not checkable statically |
|---|---|---|---|
| 50,235 | 49,999 | 0 | 236 (psql variables with unknown values, `standard_conforming_strings = off`) |

CI runs the whole suite on every change and fails on a single disagreement
(`pnpm pg-regress:setup && pnpm test:pg-regress`). What the comparison covers and what it does not
is in [Postgres compatibility](packages/docs/guide/postgres-compatibility.md).

## SQLite and MySQL

TypeSQL supports only PostgreSQL today. SQLite and MySQL support is planned: you will write
queries in each database's own dialect and get row and parameter types the same way, with no
codegen and no database connection. Each dialect brings its own grammar, column type names,
function catalog and nullability rules, so it gets its own parser rules and type map, along with
drivers for that database.

## Schema

Columns are declared with **Postgres type names** so expression typing can follow Postgres
rules; the adapter's type map converts to TS types at the boundary (`int8` is a `string`
under `pg`, a `bigint` under postgres.js with bigint parsing).

```ts
interface DB {
  users: { id: Generated<"int4">; email: Col<"text">; mood: Enum<"mood"> };
  user_stats: View<{ user_id: Col<"int4">; n: Col<"int8"> }>;
  auth: { sessions: { token: Col<"uuid"> } };    // nested schema: auth.sessions
  $types: { mood: "happy" | "sad" };              // enum registry
}
```

System catalogs (`pg_stat_activity`, `pg_tables`, `information_schema.columns`, …) are an
opt-in slice: `createSql<DB & PgCatalog>()`.

Generate it from a live database with `typesql introspect` (from `@typesql/pg`):

```sh
pnpm exec typesql introspect --url postgres://localhost/app --out src/db/schema.ts
```

Or derive the schema from migrations:

```ts
const m = migrations()
  .add("CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL)")
  .add("ALTER TABLE users ADD COLUMN display_name text");
type DB = SchemaOf<typeof m>;
```

## Performance

The SQL is parsed by the type checker, so the cost is paid at compile time, in your editor and
in `tsc`. At runtime nothing is parsed: `sql(…)` builds `{ text, values }` and the driver runs it.

### Compile time

`packages/bench` type-checks generated files of distinct, realistic queries (joins, aggregates,
parameters) with `tsc --extendedDiagnostics`, on a 4-core Xeon Platinum 8488C with TypeScript
7.1.0-beta. Compiled against the built package with `skipLibCheck`, as an application is:

| File | Instantiations | Check time | With the [type cache](packages/docs/guide/caching.md) |
|---|---|---|---|
| 1 query | 18K | 0.04 s | |
| 50 queries | 517K | 0.31 s | 20K, 0.02 s |
| 500 queries | 4.6M | 2.6 s | 123K, 0.13 s |

Each additional query costs about 9.2K instantiations, or about 5 ms of check time (about 190
queries per second). TypeScript keeps a result only for the life of one program, so the editor
computes it again after every edit and `tsc` on every run. The optional type cache keeps the
results in a file the checker reads instead: a cached query costs about 230 instantiations, and an
entry is used only while everything it was computed from is unchanged.

Against TypeSQL's own sources, which `skipLibCheck` does not skip, the bench also covers the other
call forms and long statements:

| File | Instantiations | Check time |
|---|---|---|
| 1 query (mostly checking TypeSQL's sources) | 149K | 0.22 s |
| 500 queries | 4.7M | 2.8 s |
| 50 queries with `:name` and inline parameters and a shared fragment | 422K | 0.43 s |
| one statement each of 0.5, 1, 2, 4 and 8 KB | 6.6M | 0.95 s |

TypeSQL is built for the native compiler and its recursion budgets. CI fails a change that takes
a bench file over its instantiation or check-time budget, or a cache hit over 250 instantiations
(`packages/bench/thresholds.json`).

### Runtime

Building a query (Node 26, same machine; `pnpm build && node packages/bench/runtime.ts`):

| Call | Time |
|---|---|
| `sql("… WHERE id = $1", 7)` | 1.1 µs |
| `:name` parameters | 1.3 µs |
| inline `${sql.param(…)}` values | 4.0 µs |
| a `{slot}` fragment | 1.6 µs |

The text goes to the driver as written, and `execute*` returns the driver's rows unchanged (or
with top-level keys renamed, with `rowKeys: "camelCase"`). `@typesql/core` has no dependencies
and is 10 KB minified, 4.0 KB gzipped.

To reproduce the compile-time numbers: `node packages/bench/gen.ts && pnpm --filter @typesql/core build && node packages/bench/run.ts`.

## Toolchain and limits

Requires TypeScript ≥ 7.1 (the native compiler; `7.1.0-beta` works) and Node ≥ 26.

Known ceilings: statements up to 4096 tokens; left-nested `||` or `+` chains of ~100 terms
(`AND`/`OR` chains are balanced by the parser and are fine at 200+ terms). Past a ceiling,
use `sql.as<Row>()`.

Hovers show row keys in alphabetical order: TypeScript 7 orders the keys of computed object
types. The runtime row objects keep the SELECT order.

The documentation site lives in `packages/docs` (VitePress): run `pnpm docs:dev` to browse it
locally. Its pages pull their code examples from type-checked files, so they read best on the
site; the Markdown sources are the [guide](packages/docs/guide/getting-started.md),
the [API reference](packages/docs/reference/api.md), [DDL support](packages/docs/reference/ddl.md),
[Postgres compatibility](packages/docs/guide/postgres-compatibility.md),
[adapters](packages/docs/adapters/index.md), [editor completions](packages/docs/guide/editor.md)
and the [type engine](packages/docs/internals/engine.md).

## Development

```sh
pnpm install
pnpm typecheck         # tsc per package
pnpm test              # vitest: runtime + type tests; conformance runs against docker postgres:18 when available
pnpm build && pnpm smoke:dist   # import the built packages with plain Node
pnpm pg-regress:setup && pnpm test:pg-regress   # the parser against PostgreSQL 18's regression tests
pnpm docs:dev                   # the documentation site (packages/docs)
node packages/bench/gen.ts && node packages/bench/run.ts   # compile-time budget (thresholds.json)
node packages/bench/runtime.ts                               # cost of building a query, after pnpm build
pnpm playground                 # regenerate the TypeScript Playground links (--check: CI's check)
TYPESQL_PG_URL=… node scripts/catalog-from-pg.ts              # review the function catalog against pg_proc
pnpm change                     # record a change intent with any change to a published package
pnpm check:intents              # fail if a published package changed without one (CI runs it too)
```

Versions and changelogs use pnpm's built-in release management (`pnpm change`,
`pnpm version -r`, `pnpm publish -r`); [Releasing](packages/docs/internals/releasing.md) has the
workflow.
