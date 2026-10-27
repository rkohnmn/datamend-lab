# DataMend Lab — Validation Rules, Quality Gates & Scorecard (`VALIDATION.md`)

## 1. Sixteen Validation Rule Families (`js/validation.js`)

1. `nonmissing`: Field must be present and non-empty.
2. `data_type`: Cell must parse cleanly under the column's semantic type without `INVALID_PARSE` or `AMBIGUOUS_DATE`.
3. `min_value`: Quantitative value $\ge \text{min}$.
4. `max_value`: Quantitative value $\le \text{max}$.
5. `inclusive_range`: Quantitative value $\in [\text{min}, \text{max}]$.
6. `allowed_categories`: Value must belong to an explicit enumerated set.
7. `uniqueness`: Single-column primary key uniqueness ($100\%$ distinct among present values).
8. `composite_uniqueness`: Multi-column tuple uniqueness.
9. `string_length`: Character length $\in [\text{minLength}, \text{maxLength}]$.
10. `pattern`: Matches a ReDoS-screened regular expression.
11. `date_range`: ISO 8601 date falls within `[minDate, maxDate]`.
12. `chronological_order`: Non-decreasing temporal sequence ($t_i \ge t_{i-1}$).
13. `cross_field`: Safe AST relational comparison across columns (e.g., `[end_date] >= [start_date]`).
14. `conditional_requirement`: Field required when another column satisfies `ifColumn == ifEquals`.
15. `referential_integrity`: Foreign key exists in a reference set or secondary dataset column.
16. `custom_formula`: Arbitrary deterministic boolean expression evaluated via `evaluateSafeExpression`.

## 2. Six-Dimension Transparent Quality Scorecard

| Dimension | Exact Mathematical Formula |
|---|---|
| **Completeness** | $(\text{Present Cells} / \text{Total Cells}) \times 100$ |
| **Type & Parsing Validity** | $(\text{Validly Parsed Non-Empty Cells} / \text{Total Non-Empty Cells}) \times 100$ |
| **Record Uniqueness** | $((\text{Total Rows} - \text{Exact Duplicate Rows}) / \text{Total Rows}) \times 100$ |
| **Lexical & Category Consistency** | $((\text{Total Cells} - \text{Whitespace/Case Variant Cells}) / \text{Total Cells}) \times 100$ |
| **Constraint Satisfaction** | $(\text{Passing Rule Evaluations} / \text{Total Tested Evaluations}) \times 100$ |
| **Structural Integrity** | $\max(0, \; 100 - (5 \times \text{Empty Columns} + 2 \times \text{Malformed Row Warnings}))$ |
