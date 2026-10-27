# DataMend Lab — Restructuring & Relational Operations (`RESTRUCTURING.md`)

## 1. Wide and Long Reshaping (`js/restructure.js`)

- **Wide-to-Long (`UNPIVOT_WIDE_TO_LONG`)**: Transforms $k$ measurement columns across $n$ entities into $n \times k$ rows indexed by `(idColumns, variableColumnName, valueColumnName)`.
- **Long-to-Wide (`PIVOT_LONG_TO_WIDE`)**: Spreads distinct levels of `namesFromColumn` into wide columns. If any `(idColumns, namesFromColumn)` combination contains $> 1$ observation and `conflictStrategy === "error"`, execution halts with a collision report rather than silently overwriting data.

## 2. Relational Joins & Cardinality (`executeDatasetJoin`)

Supports six relational algebra join operators over single or composite keys:
- **Inner Join**: Retains matching keys present in both Left and Right tables.
- **Left Join**: Retains all Left rows; unmatched Right attributes are populated with `MISSING`.
- **Right Join**: Retains all Right rows; unmatched Left attributes are populated with `MISSING`.
- **Full Outer Join**: Retains all rows from both tables.
- **Semi Join**: Filters Left table to rows whose key exists in Right table (without duplicating rows or appending Right columns).
- **Anti Join**: Filters Left table to rows whose key is absent from Right table.

### Cardinality & Null-Key Guarantees
- `inspectJoinDiagnostics()` classifies every join as `One-to-One (1:1)`, `One-to-Many (1:N)`, `Many-to-One (N:1)`, or `Many-to-Many (M:N)` and predicts exact output row counts before execution.
- Missing (`NULL`/empty) keys **never** match each other (`NULL != NULL`), preventing spurious cross-joins on incomplete keys.
