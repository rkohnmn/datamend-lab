# DataMend Lab — Application Security & Local-First Privacy (`SECURITY_AND_PRIVACY.md`)

## 1. Local-First Privacy Architecture (Part 34.1)

- **Zero Data Transmission**: All imported datasets, transformations, diagnostics, and exports execute 100% inside the client browser memory. Zero telemetry, zero external analytics, and zero backend servers are used.
- **Transparent Browser Storage**: Saved recipes in `localStorage` are wrapped in `try/catch` guards and can be wiped at any time via the **Clear Saved Recipes & Reset Browser Storage** button in `11. Methods & About`.

## 2. Untrusted Input & Injection Defenses (Parts 34.2–34.4)

- **No `eval()` or Dynamic Code Execution**: Calculated columns and row filters use a custom recursive-descent AST parser (`evaluateSafeExpression` in `js/transforms.js`). Imported recipes are validated strictly against `OPERATION_REGISTRY`.
- **Macro & Decompression Bomb Protection**: The pure-JS XLSX/ZIP parser enforces a strict 50 MB uncompressed byte ceiling (`MAX_SAFE_FILE_BYTES`) and never executes `vbaProject.bin` macros or live spreadsheet formulas.
- **ReDoS Protection**: User-supplied regular expressions are validated by `validateSafeRegex()` to reject nested quantifiers and excessive pattern lengths.
- **HTML & XSS Escaping**: All user data rendered into DOM templates is escaped via `escapeHtml()`.
- **CSV Formula Injection Mitigation**: When exporting to CSV/TSV, string values beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` (excluding valid negative numbers like `-42.5`) are prefixed with a protective single quote `'`.
