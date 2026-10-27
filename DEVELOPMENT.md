# DataMend Lab — Contributor & Future-Agent Maintenance Guide (`DEVELOPMENT.md`)

## 1. Architectural Invariants (Must Never Be Violated)

1. **Zero External Runtime Dependencies**: Do not add runtime npm packages or external CDN `<script>`/`<link>` tags to `index.html`.
2. **Relative Paths Only**: All asset paths in `index.html` must start with `./` so GitHub Pages subpath hosting (`/<repo>/`) works without modification.
3. **Never Silently Coerce or Delete Data**:
   - Leading-zero codes must remain `identifier` strings.
   - Ambiguous dates must remain `AMBIGUOUS_DATE` until `MDY` or `DMY` is chosen.
   - Pivot collisions must throw a descriptive error unless an aggregation strategy is chosen.
4. **Register Every Mutating Operation in `OPERATION_REGISTRY`**: All data transformations must go through `applyTransformation()` so Undo/Redo, Before/After diffs, and Recipe serialization remain 100% synchronized.
5. **Run Verification Before Every Commit**:
   - `node --test tests/*.test.js`
   - `python3 tests/verify-build.py`
