# DataMend Lab

**Clean the data. Preserve the meaning.**

DataMend Lab is a 100% client-side, zero-dependency, browser-based data inspection, diagnosis, cleaning, restructuring, validation, and reproducible preparation laboratory in the **DataSense Studio** statistical software ecosystem (alongside QuartetLab, VisualGrammar, ResampleLab, and ForecastLab).

---

## 1. Core Philosophy & Guarantees

Data preparation is not blindly deleting missing values or stripping outliers. DataMend Lab enforces strict statistical and relational integrity:
- **Raw vs. Interpreted Cell Separation**: Every cell preserves its literal imported representation (`raw`), typed value (`parsed`), display formatting (`formatted`), `missingState`, and `validationState`.
- **Identifier & Leading-Zero Protection**: Codes such as `00501` or `02139` are classified as `identifier` strings, never truncated to `501`, and never averaged.
- **Ambiguous Date Guard**: Slash dates where both components are $\le 12$ (e.g., `03/04/2026`) are flagged as `AMBIGUOUS_DATE` and never coerced until the user specifies `MDY` or `DMY`.
- **Duplicate Row vs. Duplicate Key Distinction**: Distinguishes full-row duplicates from repeated entity keys (e.g., two different people named `Alex Rivera` or longitudinal clinical visits).
- **Leakage-Free Preprocessing**: Imputation rules support fitting parameters exclusively on training partitions (`split == "train"`) and storing learned parameters in recipes to prevent test-set data leakage.
- **Hybrid Automation & Preview-Before-Apply**: Operations are classified by risk (`Read-only`, `Low risk`, `Medium risk`, `High risk`). Every mutating action provides an exact impact preview and full Undo/Redo support.

---

## 2. Eleven Integrated Application Workspaces

1. **Home & Import (`1. Home & Import`)**: Drag-and-drop multi-file uploader (CSV, TSV, multi-sheet XLSX, JSON, NDJSON, DataSense JSON), manual data entry, parser override preview, and 8 synthetic scenario datasets.
2. **Data Inspector (`2. Data Inspector`)**: Variable semantic type/role/unit configuration, two-pass descriptive statistics ($\bar{x}, s$, Hyndman-Fan Type 7 $Q_1, \tilde{x}, Q_3, IQR, MAD_\sigma$), missingness matrix, and relationship hypotheses.
3. **Quality Audit (`3. Quality Audit`)**: 6-dimension transparent quality scorecard with explicit formulas plus explainable diagnostic findings across Simple, Standard, and Technical modes.
4. **Cleaning Studio (`4. Cleaning Studio`)**: 3-panel workbench with deterministic command assistant, operation catalog, parameter forms, fuzzy near-duplicate scanner, and impact previews.
5. **Restructure & Joins (`5. Restructure & Joins`)**: Wide-to-Long unpivot, Long-to-Wide pivot (with duplicate collision guard), Group & Aggregate, spreadsheet preamble/fill-down repair, and Multi-Table Relational Joins (Inner, Left, Right, Full, Semi, Anti) with cardinality diagnostics (`1:1`, `1:N`, `N:1`, `M:N`).
6. **Recipe Builder (`6. Recipe Builder`)**: Ordered transformation history, versioned Recipe JSON export/import, and Schema-Drift validator with interactive column remapping.
7. **Validation Studio (`7. Validation Studio`)**: 16 constraint rule families and user-defined Quality Gates that block unverified exports when violated.
8. **Before & After (`8. Before & After`)**: Side-by-side scorecard comparison, structural delta summary, and cell-level diff table.
9. **Export & Reproduce (`9. Export & Reproduce`)**: One-click exports for RFC 4180 CSV (with formula-injection sanitization), TSV, pure-JS XLSX, JSON, NDJSON, `DataSenseDataset` v1.0.0 JSON, Markdown Quality Audit Report, and verified R (`tidyverse`) & Python (`pandas`) scripts.
10. **Knowledge Atlas & Labs (`10. Knowledge Atlas & Labs`)**: 14 interactive Guided Investigations and 19 searchable Knowledge Atlas entries (each with 10 structured sections).
11. **Methods & About (`11. Methods & About`)**: Mathematical specifications, local-first privacy architecture, and one-click browser storage reset.

---

## 3. Quick Start & Local Development

DataMend Lab requires **zero runtime npm dependencies** and **no backend server**.

```bash
# 1. Run automated unit, property, and acceptance scenario tests (Node.js 18+)
node --test tests/*.test.js

# 2. Run static build, subpath, and security verifier (Python 3)
python3 tests/verify-build.py

# 3. Serve locally on any static HTTP server
python3 -m http.server 8080
# Open http://localhost:8080/index.html
```

---

## 4. Documentation Index

Detailed architectural and methodology specifications are documented across the repository:

| Specification | Description |
|:---|:---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Architectural topology, state management, pure data pipeline, and zero-telemetry boundary |
| [DESIGN.md](./DESIGN.md) | Comprehensive typography, bento-grid layouts, tokens, and CVD-safe color palettes |
| [DATA_MODEL.md](./DATA_MODEL.md) | Dual-representation cell model (`raw`, `parsed`, `formatted`, `missingState`, `validationState`) |
| [TRANSFORMATIONS.md](./TRANSFORMATIONS.md) | Deterministic transformation catalog, risk classification, and preview contracts |
| [CLEANING_METHODS.md](./CLEANING_METHODS.md) | Imputation mechanics (MCAR/MAR/MNAR), outlier detection (Tukey, Z-score, MAD), and text normalization |
| [RESTRUCTURING.md](./RESTRUCTURING.md) | Reshaping algorithms (Pivot, Unpivot, Split, Combine, Fill Down) and Relational Joins |
| [VALIDATION.md](./VALIDATION.md) | 16 constraint rule types, multi-row anomaly detection, and export quality gates |
| [RECIPE_FORMAT.md](./RECIPE_FORMAT.md) | Versioned reproducible JSON recipe schema and schema drift remediation |
| [DATA_FORMATS.md](./DATA_FORMATS.md) | Supported ingest and egress formats (RFC 4180 CSV, pure-JS XLSX, NDJSON, DataSense JSON) |
| [SECURITY_AND_PRIVACY.md](./SECURITY_AND_PRIVACY.md) | Client-side memory model, CSV injection sanitization, and air-gapped security guarantees |
| [TESTING.md](./TESTING.md) | Unit, property-based, and scenario-driven test methodology |
| [PERFORMANCE.md](./PERFORMANCE.md) | DOM virtualization, memory management, two-pass statistics, and bundle budgeting |
| [COVERAGE_MATRIX.md](./COVERAGE_MATRIX.md) | Requirement traceability across test suites and scenario implementations |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Local development guidelines and static verification rules |

---

## 5. GitHub Pages Deployment

All asset links in `index.html` use explicit relative paths (`./css/...`, `./js/...`) so the application deploys cleanly under any repository subpath (`https://<username>.github.io/<repo-name>/`) via `.github/workflows/ci.yml`.

---

## 6. License

MIT License. Designed and maintained as part of the **DataSense Studio** open-source statistical laboratory ecosystem.

