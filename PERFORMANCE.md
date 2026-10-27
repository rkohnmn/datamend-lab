# DataMend Lab — Large-Data Performance & Resource Engineering (`PERFORMANCE.md`)

## 1. Algorithmic Complexity & Memory Design

- **Paginated / Virtualized Table Rendering**: The DOM table renders a configurable window (default 25–50 rows per page) rather than mounting tens of thousands of `<tr>` nodes simultaneously.
- **Two-Pass $O(n)$ Profiling**: Descriptive statistics accumulate in two linear passes over typed numeric arrays, avoiding intermediate object allocations.
- **Hash-Indexed Joins & Deduplication**: Multi-table joins (`executeDatasetJoin`) and exact deduplication (`DEDUPLICATE_EXACT`) build $O(n)$ string-keyed `Map` hash tables rather than $O(n^2)$ nested loops.
- **Bounded Fuzzy Matching**: Pairwise Levenshtein candidate scanning (`detectFuzzyDuplicateCandidates`) is bounded to a configurable sample cap (300 rows) to prevent UI thread blocking.
- **Canvas Matrix Sampling**: `renderMissingnessMatrix` downsamples row strips above 100 rows to maintain 60fps High-DPI rendering.
