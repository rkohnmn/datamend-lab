# DataMend Lab — Capability Coverage Matrix (`COVERAGE_MATRIX.md`)

Every capability required by the specification is audited and classified below without placeholder tools:

| Capability Area | Specific Feature | Classification | Implementing Module |
|---|---|---|---|
| **Data Import** | CSV, TSV, Multi-Sheet XLSX, JSON, NDJSON, Manual Entry, `DataSenseDataset` | **Fully operational** | `js/parsers.js`, `js/app.js` |
| **Internal Data Model** | Raw vs. Parsed vs. Formatted separation, 8 missing states, immutable snapshots | **Fully operational** | `js/data-model.js` |
| **Profiling Engine** | Two-pass mean/SD, Type 7 quantiles, MAD, missingness patterns, key/FD hypotheses | **Fully operational** | `js/profiler.js` |
| **Diagnosis Engine** | 25 issue categories, severity/confidence/risk badges, Simple/Standard/Technical modes | **Fully operational** | `js/diagnosis.js` |
| **Text Cleaning** | Trim, Unicode NFC/NFKC, control chars, case normalization, safe regex replace, pad/affix | **Fully operational** | `js/transforms.js` |
| **Type, Date & Units** | Semantic type conversion, currency cleaning, explicit MDY/DMY date parsing, unit registry | **Fully operational** | `js/transforms.js` |
| **Missingness & Leakage** | Missingness indicator, constant/mean/median/mode/groupwise/ffill/bfill/interp, train-only fit | **Fully operational** | `js/transforms.js` |
| **Duplicate Resolution** | Exact deduplication (first/last/most complete), non-destructive key flags, fuzzy scanner | **Fully operational** | `js/transforms.js` |
| **Outlier Handling** | Non-destructive Tukey IQR, MAD Z-score, and Z-score flags; explicit Winsorize capping | **Fully operational** | `js/transforms.js` |
| **Row & Column Ops** | Safe AST expression filter & calculated columns, window functions (lag/lead/cumsum/rank/bin) | **Fully operational** | `js/transforms.js` |
| **Restructuring** | Wide-to-Long unpivot, Long-to-Wide pivot with collision guard, split/combine, header repair | **Fully operational** | `js/restructure.js` |
| **Joins & Appending** | Inner, Left, Right, Full, Semi, Anti joins with cardinality check; multi-dataset append | **Fully operational** | `js/restructure.js` |
| **Validation & Scorecard** | 16 rule families, export Quality Gates, 6-dimension transparent scorecard, Before/After diffs | **Fully operational** | `js/validation.js` |
| **Reproducibility & Export** | Undo/Redo, Recipe JSON, schema-drift validator, CSV/TSV/XLSX/JSON/DataSense/R/Python/Report | **Fully operational** | `js/exporters.js` |
| **Education & Labs** | 14 Guided Investigations + 19 Knowledge Atlas entries + 8 Synthetic Datasets | **Fully operational** | `js/presets.js` |
| **External Cloud AI** | External LLM API calls that transmit private data outside the browser | **Not implemented (By design for privacy)** | Local deterministic parser in `js/app.js` |
