---
"@typesql/postgres": minor
---

`createBigIntSql(sql)` is replaced by `createSql(sql, { bigint: true })`, and `PostgresJsBigIntSql<DB, Keys>` by `PostgresJsSql<DB, Keys, PostgresJsBigIntTypeMap>`.
