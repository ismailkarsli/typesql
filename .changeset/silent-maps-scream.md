---
"@typesql/core": minor
---

The root export is the user-facing API only: the standalone `param`, `valueOrDefault` and `json` are gone (use `sql.param`, `sql.json`), and so are the splice and query-building helpers (`splice`, `renumberParams`, `maxParam`, `quoteIdent`, `joinFragments`, `hasSlots`, `rewriteNamed`, `makeQuery`, `makeFragment`).
