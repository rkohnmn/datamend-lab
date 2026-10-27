# DataMend Lab — Automated Verification & Testing Guide (`TESTING.md`)

## 1. Running the Automated Test Suite

```bash
# Execute unit, property-based, and acceptance scenario tests via Node.js built-in test runner
node --test tests/*.test.js

# Execute static build, subpath, security, and documentation completeness verifier
python3 tests/verify-build.py
```

## 2. What Is Verified (`tests/datamend.test.js`)

1. **Parser Edge Cases (Part 37.1)**: RFC 4180 quoted strings, escaped double quotes (`""`), embedded newlines, UTF-8 BOM stripping, malformed row preservation, pure-JS XLSX round-trip, and nested JSON record paths.
2. **Type & Identifier Integrity (Part 37.2)**: Leading-zero ZIP codes (`00501`) remain `identifier` strings across parsing, profiling, and XLSX export; ambiguous slash dates (`03/04/2026`) are flagged as `AMBIGUOUS_DATE` until `MDY` or `DMY` is specified.
3. **Leakage-Free Imputation (Part 37.4 & Scenario 19)**: Training-only fit (`split == "train"`) computes $\bar{x}_{\text{train}} = 106.9$ without peeking at test-set regime shifts.
4. **Duplicates, Categories & Outliers (Parts 37.3–37.5)**: Exact duplicate removal vs. repeated entity preservation (`Alex Rivera`), case-insensitive category alias mapping, and non-destructive Tukey $1.5 \times IQR$ outlier flagging.
5. **Restructuring & Joins (Parts 37.6–37.7)**: Wide-to-long unpivot, long-to-wide pivot collision blocking & aggregation resolution, and `Many-to-Many (M:N)` join cardinality detection.
6. **Validation, Undo/Redo, Recipes & Schema Drift (Parts 37.8–37.10)**: Quality gate enforcement, multi-step Undo/Redo state restoration, recipe schema-drift detection, and CSV formula-injection sanitization.
