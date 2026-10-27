# DataMend Lab — Software Architecture (`ARCHITECTURE.md`)

## 1. Architectural Overview

DataMend Lab follows the canonical DataSense Studio zero-framework, local-first modular architecture specified in `APPLICATION_GUIDELINES.md`:
- **100% Client-Side Execution**: All file parsing, profiling, relational joins, pivoting, validation, and XLSX/CSV serialization run in the browser.
- **Zero External Runtime Dependencies**: Pure ES2022+ JavaScript modules (`js/*.js`) and standard CSS custom properties (`css/*.css`).
- **Strict Separation of Concerns**: Pure computation engines (`data-model.js`, `parsers.js`, `profiler.js`, `diagnosis.js`, `transforms.js`, `restructure.js`, `validation.js`, `exporters.js`) have zero DOM dependencies and are directly tested under `node --test`.

## 2. Module Boundaries

| Module | Responsibility |
|---|---|
| `js/data-model.js` | Cell-state separation (`raw`, `parsed`, `formatted`, `missingState`, `validationState`, `isImputed`), stable `_rowId` & column metadata, FNV-1a fingerprinting, and immutable snapshots (`originalSnapshot`). |
| `js/parsers.js` | RFC 4180 CSV/TSV parser, Pure-JS ZIP/DEFLATE (`inflateRaw`) + OpenXML XLSX multi-sheet workbook parser, JSON/NDJSON nested record path extractor, and `DataSenseDataset` loader. |
| `js/profiler.js` | Two-pass numerically stable moments ($\bar{x}, s^2, s$), Hyndman-Fan Type 7 quantiles, $MAD_\sigma$, missingness co-occurrence patterns, candidate keys, and functional dependency hypotheses. |
| `js/diagnosis.js` | Deterministic issue detection across 14+ detector rules and 25 issue categories with severity, confidence, evidence, consequences, and risk classification (`Read-only`, `Low`, `Medium`, `High`). |
| `js/transforms.js` | Authoritative `OPERATION_REGISTRY`, safe regex validator (anti-ReDoS), safe AST expression evaluator (zero `eval()`), unit conversion registry, fuzzy duplicate detector, preview engine, and transactional Undo/Redo stack. |
| `js/restructure.js` | Wide-to-long unpivot, long-to-wide pivot with collision guard, column split/combine, spreadsheet header promotion & fill-down, multi-table hash joins (`inner`, `left`, `right`, `full`, `semi`, `anti`) with cardinality analysis, and dataset appending. |
| `js/validation.js` | 16 constraint rule families, export Quality Gates, 6-dimension Quality Scorecard, and Before/After cell & structural diff engine. |
| `js/exporters.js` | Versioned `DataMendRecipe` serialization, schema-drift validator, RFC 4180 CSV/TSV exporter with formula-injection protection, pure-JS XLSX builder, `DataSenseDataset` exporter, Markdown audit report generator, and R/Python script generators. |
| `js/renderer.js` | High-DPI Canvas 2D visualizers (`renderMissingnessMatrix`, `renderColumnDistribution`, `renderBeforeAfterScorecardChart`) compliant with `VISUALIZATION_STANDARDS.md`. |
| `js/presets.js` | 8 synthetic pedagogical datasets, 14 interactive Guided Investigations, and 19 structured Knowledge Atlas entries. |
| `js/storage.js` | Safe `try/catch` `localStorage` recipe persistence and Base64 URL hash state encoder. |
| `js/app.js` | 11-workspace DOM coordinator, modal preview reviewer, keyboard shortcut manager, and accessibility controller. |
