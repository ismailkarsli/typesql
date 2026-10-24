---
"@typesql/core": minor
---

`sql.valueOrDefault` is removed: `sql.param(value)` sends `DEFAULT` when the value is `undefined`, and a value that can be `undefined` is a compile error where `DEFAULT` is not allowed and inside `sql.fragment`.
