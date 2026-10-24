---
"@typesql/pg": minor
"@typesql/postgres": minor
"@typesql/kysely": minor
"@typesql/drizzle": minor
"@typesql/prisma": minor
---

`NoResultError`, `Executor` and `TransactionalSql` are no longer re-exported (from `@typesql/drizzle` also `Sql`, `Query`, `RowType`, `ParamsType`, `DefaultTypeMap` and `TypeMap`); import them from `@typesql/core`.
