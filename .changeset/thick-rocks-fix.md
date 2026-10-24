---
"@typesql/core": minor
---

`sql.list` is merged into `sql.join`: joining a runtime array of fragments whose texts are known is checked as `sql.list` did, and `sql.join` throws when there are no items.
