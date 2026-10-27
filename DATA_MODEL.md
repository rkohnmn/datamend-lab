# DataMend Lab — Internal Data Model (`DATA_MODEL.md`)

## 1. Separation of Raw and Interpreted Values (Part 7.1)

Every cell at intersection `(row._rowId, col.id)` is represented by an immutable state record:

```json
{
  "raw": "00501",
  "parsed": "00501",
  "formatted": "00501",
  "missingState": "PRESENT",
  "validationState": "VALID",
  "formula": null,
  "isImputed": false
}
```

## 2. Missing-Value State Typology (Part 7.4)

DataMend Lab distinguishes eight cell presence states (`MISSING_STATES` in `js/data-model.js`):
1. `PRESENT`: Valid non-missing observation.
2. `EMPTY_STRING`: Literal `""` when configured as distinct from missing.
3. `MISSING`: Standard missing token (`NA`, `N/A`, `NULL`, `.`, `-999`, or empty cell).
4. `INVALID_PARSE`: Token failed parsing under the column's declared semantic type (preserved in `raw`, never silently coerced to `MISSING`).
5. `NOT_APPLICABLE`: Structural non-applicability (`N/A (Not Applicable)`, `NOT_APPLICABLE`).
6. `WITHHELD`: Explicitly redacted or refused observation (`WITHHELD`, `REDACTED`, `Prefer not to say`).
7. `NONFINITE`: IEEE 754 `NaN`, `+Infinity`, or `-Infinity`.
8. `USER_MISSING_MARKER`: Custom user-configured missing code.

## 3. Semantic Column Types & Roles (Part 7.2)

- **Semantic Types (`SEMANTIC_TYPES`)**: `text`, `integer`, `decimal`, `boolean`, `categorical`, `ordered_categorical`, `date`, `datetime`, `duration`, `identifier`.
- **Analytical Roles (`VARIABLE_ROLES`)**: `explanatory`, `response`, `grouping`, `weight`, `timestamp`, `metadata`, `identifier`.

## 4. Row Lineage & Non-Destructive Snapshots (Part 7.3 & 7.6)

- Every imported row receives a stable internal `_rowId` (`row_1`, `row_2`, …) and `_lineage` array independent of user business keys.
- `dataset.originalSnapshot` stores a deep immutable clone of the imported columns and rows, enabling instant full restoration (`restoreOriginalDataset`) and exact Before/After comparison.
