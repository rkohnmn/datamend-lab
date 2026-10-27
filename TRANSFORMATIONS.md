# DataMend Lab — Transformation Catalog (`TRANSFORMATIONS.md`)

Every operation in `OPERATION_REGISTRY` (`js/transforms.js` and `js/restructure.js`) is deterministic, versioned, previewable, and reversible via Undo/Redo.

| Operation ID | Category | Risk Level | Parameters | Semantics & Safeguards |
|---|---|---|---|---|
| `TRIM_WHITESPACE` | Text Cleaning | Low risk | `colId`, `mode` (`both`/`leading`/`trailing`), `normalizeInternal` | Trims outer spaces and collapses repeated internal spaces (`\s{2,}` → `' '`). |
| `NORMALIZE_UNICODE_CONTROL` | Text Cleaning | Low risk | `colId`, `unicodeForm` (`NFC`/`NFKC`), `stripControl` | Normalizes Unicode composition and removes ASCII control chars (`0x00–0x1F`) without stripping accents. |
| `STANDARDIZE_CASE` | Text Cleaning | Low risk | `colId`, `mode` (`canonical_most_frequent`/`title`/`lower`/`upper`) | Normalizes text casing or merges case-split variants into the most frequent spelling. |
| `FIND_REPLACE_TEXT` | Text Cleaning | Medium risk | `colId`, `find`, `replace`, `matchMode` (`exact`/`substring`/`regex`) | Replaces substrings or safe regex matches (screened by `validateSafeRegex` against ReDoS). |
| `PAD_OR_AFFIX_TEXT` | Text Cleaning | Low risk | `colId`, `targetLength`, `padChar`, `prefix`, `suffix` | Pads strings (e.g., 5-digit ZIP codes) or attaches prefixes/suffixes. |
| `CHANGE_COLUMN_TYPE` | Type & Date | Medium risk | `colId`, `targetType`, `decimalSeparator`, `dateFormat` | Updates column semantic type and re-evaluates all cells without dropping parse failures. |
| `CLEAN_NUMERIC_TEXT` | Type & Date | Medium risk | `colId`, `decimalSeparator` | Strips currency symbols (`$`, `€`, `£`, `¥`), thousands commas, and accounting parentheses. |
| `PARSE_DATES` | Type & Date | Medium risk | `colId`, `dateFormat` (`MDY` or `DMY`) | Resolves ambiguous slash/dash dates into canonical ISO 8601 `YYYY-MM-DD`. |
| `CONVERT_UNITS` | Type & Date | Medium risk | `colId`, `targetUnit` (`kg`, `cm`, `m`, `c`) | Converts values using `UNIT_CONVERSION_REGISTRY` and updates `column.unit`. |
| `ADD_MISSINGNESS_INDICATOR` | Missingness | Low risk | `colId`, `newColumnName` | Appends a non-destructive binary `0/1` missingness indicator column. |
| `IMPUTE_MISSING` | Missingness | High risk | `colId`, `method`, `constantValue`, `groupColumn`, `splitColumn`, `trainValue` | Imputes via `constant`, `mean`, `median`, `mode`, `group_mean`, `group_median`, `ffill`, `bfill`, or `linear_interp`. Marks cells `isImputed = true`. |
| `DROP_MISSING_ROWS` | Missingness | High risk | `colId` (optional) | Performs complete-case listwise deletion and reports exact row reduction. |
| `DEDUPLICATE_EXACT` | Duplicates | High risk | `strategy` (`keep_first`/`keep_last`/`keep_most_complete`), `columns` | Removes redundant duplicate tuples and logs survivor/discarded row lineage. |
| `MARK_DUPLICATE_KEYS` | Duplicates | Low risk | `colId` | Appends a `UNIQUE` / `REPEATED_KEY` diagnostic column without deleting rows. |
| `MAP_CATEGORIES` | Categories | Medium risk | `colId`, `mapping` | Maps source aliases/abbreviations into canonical labels (case-insensitive fallback). |
| `FLAG_OUTLIERS` | Outliers | Low risk | `colId`, `method` (`tukey_iqr`/`mad_z`/`z_score`) | Appends a non-destructive `IN_RANGE` / `LOW_OUTLIER` / `HIGH_OUTLIER` flag column. |
| `WINSORIZE_OUTLIERS` | Outliers | High risk | `colId`, `minBound`, `maxBound` | Caps extreme values at explicit bounds or Tukey $1.5 \times IQR$ fences. |
| `FILTER_ROWS` | Row/Column | High risk | `expression` or `colId`/`operator`/`value` | Filters rows using the safe AST expression evaluator and reports before/after counts. |
| `SORT_ROWS` | Row/Column | Low risk | `colId`, `direction` (`asc`/`desc`) | Sorts rows respecting numerical values and `ordered_categorical` factor levels. |
| `RENAME_COLUMN` | Row/Column | Low risk | `colId`, `newName` | Renames column display name while preserving `originalName`. |
| `DROP_COLUMN` | Row/Column | Medium risk | `colId` | Removes selected column from working schema. |
| `ADD_CALCULATED_COLUMN` | Row/Column | Low risk | `newColumnName`, `calcType`, `expression`, `sourceColumn` | Evaluates safe AST formulas or window functions (`zscore`, `rank`, `cumsum`, `lag`, `lead`, `bin`). |
| `UNPIVOT_WIDE_TO_LONG` | Restructuring | High risk | `idColumns`, `valueColumns`, `variableColumnName`, `valueColumnName` | Melts wide measurement columns into long `(ID × variable)` rows. |
| `PIVOT_LONG_TO_WIDE` | Restructuring | High risk | `idColumns`, `namesFromColumn`, `valuesFromColumn`, `conflictStrategy` | Pivots category levels into columns; blocks collisions unless aggregation rule is set. |
| `SPLIT_COLUMN` | Restructuring | Medium risk | `colId`, `delimiter`, `newColumnNames` | Splits text column into multiple columns by delimiter. |
| `COMBINE_COLUMNS` | Restructuring | Low risk | `columns`, `separator`, `newColumnName` | Concatenates multiple columns with null-aware separator handling. |
| `FILL_DOWN_HIERARCHICAL` | Restructuring | Medium risk | `colId` | Propagates top-cell labels downward into blank merged-cell rows. |
| `PROMOTE_ROW_TO_HEADER` | Restructuring | Medium risk | `rowIndex` | Promotes selected row to column headers and strips preamble rows above it. |
| `GROUP_AND_AGGREGATE` | Restructuring | High risk | `groupColumns`, `aggregations` | Collapses rows by group keys into summary statistics (`mean`, `median`, `sum`, `sd`, `iqr`, `count`). |
