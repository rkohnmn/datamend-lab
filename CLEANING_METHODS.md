# DataMend Lab — Issue Detection & Statistical Cleaning Methods (`CLEANING_METHODS.md`)

## 1. Evidence-Based Issue Diagnosis (`js/diagnosis.js`)

DataMend Lab separates diagnostic findings into six explicit severity levels:
1. `Confirmed Parsing/Format Error`: Unparseable tokens, non-finite numbers, or malformed row widths.
2. `Violated User-Defined Constraint`: Failures of Validation Studio rules or Quality Gates.
3. `Highly Likely Superficial Inconsistency`: Leading/trailing whitespace, repeated internal spaces, or capitalization splits.
4. `Potential Semantic Inconsistency`: Ambiguous slash dates, category abbreviations (`NY` vs. `New York`), mixed embedded measurement units (`kg` vs. `lbs`), missing values, or exact duplicate rows.
5. `Suspicious Statistical Observation`: Extreme values outside Tukey $1.5 \times IQR$ fences.
6. `Informational Finding`: Protected leading-zero identifiers, repeated entity keys in longitudinal panels, constant columns, or empty columns.

## 2. Missingness & Data Leakage Prevention

- **Non-Neutrality of Imputation**: Mean and median imputation shrink sample variance and alter bivariate correlations. Every imputed value is flagged with `isImputed = true`.
- **Training-Only Fit/Transform (`splitColumn` & `trainValue`)**: When preparing datasets for prediction or forecasting (e.g., ForecastLab), imputation statistics ($\bar{x}_{\text{train}}, \tilde{x}_{\text{train}}$) are computed exclusively on the training subset and stored in `dataset.learnedParameters` so test-set values never leak into training preprocessing.

## 3. Outlier Screening & Statistical Integrity

- **Tukey Inner Fences**: $[Q_1 - 1.5 \cdot IQR, \; Q_3 + 1.5 \cdot IQR]$ where quartiles use Hyndman-Fan Type 7 interpolation.
- **Robust Median / MAD Z-Score**: $|x_i - \tilde{x}| / MAD_\sigma > 3.5$, where $MAD_\sigma = 1.482602218505602 \times \text{median}|x_i - \tilde{x}|$.
- **Policy**: Extreme observations (such as a legitimate `$500,000` salary) are never automatically deleted.
