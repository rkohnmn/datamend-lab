/**
 * DataMend Lab — Presets, Synthetic Example Datasets, Knowledge Atlas, and Guided Investigations
 * Implements Parts 30, 31, and 32:
 * - Synthetic, clearly labeled pedagogical datasets covering all acceptance scenarios
 * - 14 Interactive Guided Investigations with live operations and statistical explanations
 * - Comprehensive Data Preparation Atlas entries with 10 structured fields each
 */

export const SYNTHETIC_PRESETS = [
  {
    id: 'preset_messy_customers',
    title: '1. Regional Customer & Compensation Audit (Synthetic)',
    category: 'Comprehensive Cleaning & Anomalies',
    isSynthetic: true,
    learningObjectives: [
      'Trim whitespace and standardize category capitalization without altering identifiers.',
      'Protect leading-zero ZIP codes (00501, 07030) and resolve ambiguous slash dates (03/04/2026).',
      'Distinguish exact duplicate rows from distinct customers sharing the name "Alex Rivera" and flag the $500,000 executive salary non-destructively.'
    ],
    expectedDiagnostics: [
      'Exact duplicate row (CUST-101 repeated verbatim)',
      'Whitespace, capitalization, and state alias variants (NY, N.Y., New York)',
      'Ambiguous slash dates (03/04/2026, 05/06/2026) and protected leading-zero postal codes (00501, 02139, 07030)',
      'Missing salary tokens (NA, WITHHELD, blank) and 1 high-income observation ($500,000)'
    ],
    columnNames: ['customer_id', 'full_name', 'postal_code', 'state', 'department', 'signup_date', 'annual_salary_usd', 'satisfaction_level'],
    rawRows: [
      ['CUST-101', '  Elena Rostova ', '02139', 'New York ', 'Engineering', '03/04/2026', '118500', 'Agree'],
      ['CUST-101', '  Elena Rostova ', '02139', 'New York ', 'Engineering', '03/04/2026', '118500', 'Agree'],
      ['CUST-102', 'Marcus Vance', '07030', 'NY', 'engineering', '2026-03-15', '112000', 'Strongly agree'],
      ['CUST-103', 'Alex Rivera', '00501', 'N.Y.', '  Marketing  ', '05/06/2026', '94000', 'Neutral'],
      ['CUST-104', 'Alex Rivera', '94107', 'California', 'Finance', '2026-06-19', '131000', 'Agree'],
      ['CUST-105', 'Priya Nair', '94107', 'CA', 'FINANCE', '2026-07-01', 'NA', 'Disagree'],
      ['CUST-106', 'Devon Brooks', '78701', 'Texas', 'Marketing', '08/09/2026', '89500', 'Agree'],
      ['CUST-107', 'Hannah Abbott', '02139', 'new york', 'Human Resources', '2026-08-22', '500000', 'Strongly agree'],
      ['CUST-108', 'Liam O\'Connor', '78701', 'TX', 'HR', '2026-09-10', 'WITHHELD', 'Strongly disagree'],
      ['CUST-109', 'Sofia Rossi', '07030', 'New York', 'Engineering', '2026-09-25', '124000', 'Agree'],
      ['CUST-110', 'Kenji Takahashi', '94107', 'California', 'Marketing', '10/11/2026', '', 'Neutral'],
      ['CUST-111', 'Mei Lin', '00501', 'New York', 'Finance', '2026-10-18', '106500', 'Agree']
    ]
  },
  {
    id: 'preset_wide_monthly_revenue',
    title: '2. Wide Quarterly/Monthly Revenue Matrix (Synthetic)',
    category: 'Wide-to-Long Reshaping',
    isSynthetic: true,
    learningObjectives: [
      'Recognize when column headers store values of a temporal variable (month) rather than distinct attributes.',
      'Use Unpivot (Wide-to-Long) to convert month columns into tidy (store_id × month) observations.'
    ],
    expectedDiagnostics: [
      '4 wide measurement columns (2026_Jan, 2026_Feb, 2026_Mar, 2026_Apr) ready for wide-to-long unpivoting'
    ],
    columnNames: ['store_id', 'region', '2026_Jan', '2026_Feb', '2026_Mar', '2026_Apr'],
    rawRows: [
      ['STR-01', 'Northeast', '42100', '43800', '46200', '48900'],
      ['STR-02', 'Midwest', '31500', '30900', '33400', '35100'],
      ['STR-03', 'Pacific', '58400', '61200', '59800', '64500'],
      ['STR-04', 'Southeast', '27900', '29100', '31000', '32800']
    ]
  },
  {
    id: 'preset_long_panel_collisions',
    title: '3. Long Clinical Panel with Pivot Collisions (Synthetic)',
    category: 'Long-to-Wide & Duplicate Keys',
    isSynthetic: true,
    learningObjectives: [
      'Understand why repeated patient_id values in longitudinal panel data are valid observations, not duplicate entities.',
      'See how duplicate (patient_id × visit_stage) combinations trigger a Pivot Collision requiring explicit aggregation.'
    ],
    expectedDiagnostics: [
      'Repeated patient_id identifier across visits',
      'Duplicate (PAT-01 × Baseline) combination requiring explicit conflict rule when pivoting wider'
    ],
    columnNames: ['patient_id', 'visit_stage', 'systolic_bp', 'heart_rate'],
    rawRows: [
      ['PAT-01', 'Baseline', '134', '76'],
      ['PAT-01', 'Baseline', '130', '74'],
      ['PAT-01', 'Month_3', '124', '71'],
      ['PAT-02', 'Baseline', '142', '82'],
      ['PAT-02', 'Month_3', '128', '75'],
      ['PAT-03', 'Baseline', '118', '68'],
      ['PAT-03', 'Month_3', '116', '66']
    ]
  },
  {
    id: 'preset_mixed_units_biometrics',
    title: '4. Cross-Clinic Biometrics with Mixed Units (Synthetic)',
    category: 'Unit Conversion & Type Parsing',
    isSynthetic: true,
    learningObjectives: [
      'Detect embedded mixed units (kg vs lbs, cm vs in) before converting to numeric.',
      'Apply validated unit conversion so 154 lbs is converted to 69.8532 kg rather than parsed as 154 kg.'
    ],
    expectedDiagnostics: [
      'Mixed mass units (kg, lbs) in weight_raw and mixed length units (cm, in) in height_raw'
    ],
    columnNames: ['subject_id', 'clinic_site', 'weight_raw', 'height_raw', 'resting_glucose'],
    rawRows: [
      ['SUB-001', 'Boston', '70 kg', '175 cm', '92'],
      ['SUB-002', 'Chicago', '154 lbs', '68 in', '98'],
      ['SUB-003', 'Boston', '82.5 kg', '182 cm', '104'],
      ['SUB-004', 'Chicago', '198 lbs', '71 in', '89'],
      ['SUB-005', 'Boston', '64 kg', '165 cm', '95']
    ]
  },
  {
    id: 'preset_join_orders_left',
    title: '5A. Relational Join Workbench — Orders Table (Synthetic)',
    category: 'Multi-Table Joins & Cardinality',
    isSynthetic: true,
    learningObjectives: [
      'Join with Dataset 5B (Customer Directory) to inspect 1:N and M:N join cardinality and unmatched keys.'
    ],
    expectedDiagnostics: [
      'Repeated account_id values representing multiple orders per customer plus 1 unmatched account (ACCT-999)'
    ],
    columnNames: ['order_id', 'account_id', 'order_date', 'order_total_usd'],
    rawRows: [
      ['ORD-5001', 'ACCT-01', '2026-09-01', '240.00'],
      ['ORD-5002', 'ACCT-01', '2026-09-14', '180.50'],
      ['ORD-5003', 'ACCT-02', '2026-09-18', '95.00'],
      ['ORD-5004', 'ACCT-03', '2026-09-20', '610.00'],
      ['ORD-5005', 'ACCT-999', '2026-09-25', '125.00']
    ]
  },
  {
    id: 'preset_join_customers_right',
    title: '5B. Relational Join Workbench — Customer Directory (Synthetic)',
    category: 'Multi-Table Joins & Cardinality',
    isSynthetic: true,
    learningObjectives: [
      'Notice how ACCT-01 appears twice in this directory table, creating a Many-to-Many (M:N) Cartesian row expansion if joined without deduplication.'
    ],
    expectedDiagnostics: [
      'Duplicate key ACCT-01 in lookup table triggers M:N row multiplication warning during join'
    ],
    columnNames: ['account_id', 'account_tier', 'territory', 'rep_name'],
    rawRows: [
      ['ACCT-01', 'Enterprise', 'Northeast', 'Jordan Blake'],
      ['ACCT-01', 'Enterprise (Legacy)', 'Northeast', 'Jordan Blake'],
      ['ACCT-02', 'Growth', 'Midwest', 'Taylor Reed'],
      ['ACCT-03', 'Enterprise', 'West', 'Morgan Chen'],
      ['ACCT-04', 'Starter', 'South', 'Casey Kim']
    ]
  },
  {
    id: 'preset_messy_spreadsheet_export',
    title: '6. Hierarchical ERP Report with Preamble Rows (Synthetic)',
    category: 'Spreadsheet Structure Repair',
    isSynthetic: true,
    learningObjectives: [
      'Promote the true header row (Row 2) and strip decorative report preamble rows.',
      'Fill down hierarchical region labels left blank by merged spreadsheet cells.'
    ],
    expectedDiagnostics: [
      'Decorative preamble row in Row 1 and blank hierarchical division cells'
    ],
    columnNames: ['ERP_EXPORT_V4', 'GENERATED_2026_10_26', 'CONFIDENTIAL', 'PAGE_1_OF_1'],
    rawRows: [
      ['Division', 'Cost_Center', 'Quarter', 'Spend_USD'],
      ['North America', 'CC-100', '2026-Q1', '45000'],
      ['', 'CC-100', '2026-Q2', '47200'],
      ['', 'CC-200', '2026-Q1', '31800'],
      ['Europe', 'CC-300', '2026-Q1', '52400'],
      ['', 'CC-300', '2026-Q2', '54100']
    ]
  },
  {
    id: 'preset_forecast_leakage_series',
    title: '7. Macroeconomic Time-Series with Train/Test Split (Synthetic)',
    category: 'ForecastLab & Leakage Prevention',
    isSynthetic: true,
    learningObjectives: [
      'Preserve chronological ordering and fit imputation on split == "train" only so future test shocks do not leak into training data.'
    ],
    expectedDiagnostics: [
      'Missing values in demand_index across both train and test partitions'
    ],
    columnNames: ['period_date', 'series_id', 'split', 'demand_index', 'promo_active'],
    rawRows: [
      ['2026-01-01', 'SER-A', 'train', '102.4', '0'],
      ['2026-02-01', 'SER-A', 'train', '105.1', '0'],
      ['2026-03-01', 'SER-A', 'train', 'NA', '1'],
      ['2026-04-01', 'SER-A', 'train', '108.9', '0'],
      ['2026-05-01', 'SER-A', 'train', '111.2', '0'],
      ['2026-06-01', 'SER-A', 'test', '185.0', '1'],
      ['2026-07-01', 'SER-A', 'test', 'NA', '0'],
      ['2026-08-01', 'SER-A', 'test', '192.4', '1']
    ]
  },
  {
    id: 'preset_schema_drift_batch2',
    title: '8. Next-Month Customer Batch with Schema Drift (Synthetic)',
    category: 'Recipe Replay & Schema Drift',
    isSynthetic: true,
    learningObjectives: [
      'Test reapplying a saved cleaning recipe when a column has been renamed (annual_salary_usd → compensation_usd).'
    ],
    expectedDiagnostics: [
      'Schema drift relative to Dataset 1: "annual_salary_usd" renamed to "compensation_usd"'
    ],
    columnNames: ['customer_id', 'full_name', 'postal_code', 'state', 'department', 'signup_date', 'compensation_usd', 'satisfaction_level'],
    rawRows: [
      ['CUST-201', '  Nora Lindqvist ', '02139', 'NY', 'engineering', '04/05/2026', '121000', 'Agree'],
      ['CUST-202', 'Tariq Al-Mansoor', '07030', 'New York ', 'Finance', '2026-05-12', '115000', 'Strongly agree'],
      ['CUST-202', 'Tariq Al-Mansoor', '07030', 'New York ', 'Finance', '2026-05-12', '115000', 'Strongly agree']
    ]
  }
];

/**
 * Part 31 — 14 Interactive Guided Investigations
 */
export const GUIDED_INVESTIGATIONS = [
  {
    id: 'inv_01_duplicate_names',
    number: 1,
    title: 'Why are duplicate names not necessarily duplicate people?',
    presetId: 'preset_messy_customers',
    question: 'In Dataset 1, "Alex Rivera" appears in two rows (CUST-103 and CUST-104), while "Elena Rostova" (CUST-101) also appears in two rows. Which pair is a true duplicate record?',
    concept: 'Entity Resolution vs. Exact Tuple Duplication',
    explanation: 'CUST-101 appears twice with identical attributes across every column—an exact duplicate row. The two "Alex Rivera" records have distinct primary keys (CUST-103 vs CUST-104), different ZIP codes (00501 vs 94107), and different departments. Deduplicating on full_name alone would erase a real person.',
    recommendedOperation: { type: 'DEDUPLICATE_EXACT', params: { strategy: 'keep_first' } }
  },
  {
    id: 'inv_02_missing_deletion_bias',
    number: 2,
    title: 'How can missing-value deletion change statistical conclusions?',
    presetId: 'preset_messy_customers',
    question: 'CUST-108 ("Strongly disagree") has annual_salary_usd = "WITHHELD", and CUST-105 ("Disagree") has "NA". What happens if you drop rows with missing salaries?',
    concept: 'Missing Not at Random (MNAR) & Selection Bias',
    explanation: 'Dissatisfied respondents withheld their salaries at a higher rate. Dropping rows with missing salaries selectively removes "Disagree" and "Strongly disagree" cases, biasing the sample toward satisfied employees.',
    recommendedOperation: { type: 'ADD_MISSINGNESS_INDICATOR', params: { columnName: 'annual_salary_usd' } }
  },
  {
    id: 'inv_03_numeric_identifiers',
    number: 3,
    title: 'Why are numeric identifiers not numerical measurements?',
    presetId: 'preset_messy_customers',
    question: 'Column "postal_code" contains values 00501, 02139, and 07030. What goes wrong if postal_code is parsed as an Integer?',
    concept: 'Nominal Identifiers vs. Quantitative Variables',
    explanation: 'Converting "00501" to an integer strips the leading zeros to produce 501 and enables meaningless averages. DataMend Lab locks leading-zero codes as IDENTIFIER strings.',
    recommendedOperation: { type: 'PAD_OR_AFFIX_TEXT', params: { columnName: 'postal_code', targetLength: 5, padChar: '0', treatAsIdentifier: true } }
  },
  {
    id: 'inv_04_category_distortion',
    number: 4,
    title: 'How can category inconsistencies distort counts?',
    presetId: 'preset_messy_customers',
    question: 'Before cleaning, how many distinct state labels appear in Dataset 1 for New York?',
    concept: 'Lexical & Alias Category Fragmentation',
    explanation: '"New York " (trailing space), "New York", "new york", "NY", and "N.Y." split 7 New York observations across 5 separate factor levels, distorting frequency bars and contingency tables.',
    recommendedOperation: { type: 'TRIM_WHITESPACE', params: { columnName: 'state', normalizeInternal: true } }
  },
  {
    id: 'inv_05_many_to_many_join',
    number: 5,
    title: 'Why does a many-to-many join multiply rows?',
    presetId: 'preset_join_orders_left',
    question: 'ACCT-01 has 2 orders in Dataset 5A and 2 directory rows in Dataset 5B. How many rows for ACCT-01 are produced by an inner join on account_id?',
    concept: 'Relational Join Cardinality (M:N Cartesian Product)',
    explanation: 'When a join key is non-unique in both tables (2 × 2), a join produces every pairwise combination (4 rows), doubling apparent order revenue for ACCT-01 ($420.50 to $841.00).',
    recommendedOperation: null
  },
  {
    id: 'inv_06_wide_to_long_pivot',
    number: 6,
    title: 'What changes when data are pivoted from wide to long?',
    presetId: 'preset_wide_monthly_revenue',
    question: 'Dataset 2 has 4 rows (stores) and 4 monthly columns (2026_Jan..2026_Apr). What is the observational unit before and after unpivoting?',
    concept: 'Observational Unit Granularity in Tidy Reshaping',
    explanation: 'Before unpivoting, 1 row = 1 Store (4 rows). After unpivoting, 1 row = 1 Store-Month (4 × 4 = 16 rows). Total revenue sum is preserved, while time-series plotting becomes directly possible.',
    recommendedOperation: {
      type: 'UNPIVOT_WIDE_TO_LONG',
      params: {
        idColumns: ['store_id', 'region'],
        valueColumns: ['2026_Jan', '2026_Feb', '2026_Mar', '2026_Apr'],
        variableColumnName: 'month',
        valueColumnName: 'revenue_usd'
      }
    }
  },
  {
    id: 'inv_07_aggregation_variation',
    number: 7,
    title: 'Why can averaging grouped data conceal important variation?',
    presetId: 'preset_messy_customers',
    question: 'If you group Dataset 1 by department and compute only mean salary, what happens to within-department spread and sample size?',
    concept: 'Information Loss & Ecological Fallacy in Aggregation',
    explanation: 'Grouping collapses individual employee observations into department summaries. Always include group count (n), standard deviation (s), or median/IQR alongside the group mean.',
    recommendedOperation: null
  },
  {
    id: 'inv_08_outlier_deletion_regression',
    number: 8,
    title: 'How can outlier deletion change a statistical conclusion?',
    presetId: 'preset_messy_customers',
    question: 'Row CUST-107 has annual_salary_usd = $500,000, which exceeds Tukey 1.5 × IQR fences. Should it be automatically deleted?',
    concept: 'Legitimate Extreme Observations vs. Measurement Error',
    explanation: 'An executive salary of $500,000 is a legitimate realization of a right-skewed income distribution. Deleting it artificially truncates the tail; instead, flag it and compare mean ($155,444) against robust median ($115,250).',
    recommendedOperation: { type: 'FLAG_OUTLIERS', params: { columnName: 'annual_salary_usd', method: 'tukey_iqr' } }
  },
  {
    id: 'inv_09_ambiguous_dates',
    number: 9,
    title: 'Why must date formats be interpreted carefully?',
    presetId: 'preset_messy_customers',
    question: 'CUST-101 signed up on "03/04/2026". Is that March 4 or April 3?',
    concept: 'Locale Date Ambiguity (MM/DD/YYYY vs. DD/MM/YYYY)',
    explanation: 'Whenever both first and second components are ≤ 12, slash dates are ambiguous without format metadata. Silent guessing can shift monthly cohorts by months.',
    recommendedOperation: { type: 'PARSE_DATES', params: { columnName: 'signup_date', dateFormat: 'MDY' } }
  },
  {
    id: 'inv_10_primary_key_guarantees',
    number: 10,
    title: 'What does a primary key actually guarantee?',
    presetId: 'preset_long_panel_collisions',
    question: 'In Dataset 3, is "patient_id" a primary key for the table?',
    concept: 'Entity Keys vs. Composite Observational Keys',
    explanation: 'In a clinical longitudinal table, "patient_id" identifies the person, not the row. The composite key is (patient_id, visit_stage)—which has a collision on (PAT-01, Baseline) that must be resolved before pivoting.',
    recommendedOperation: { type: 'MARK_DUPLICATE_KEYS', params: { columnName: 'patient_id' } }
  },
  {
    id: 'inv_11_schema_drift_failure',
    number: 11,
    title: 'Why can a cleaning recipe fail on next month\'s data?',
    presetId: 'preset_schema_drift_batch2',
    question: 'Dataset 8 renames "annual_salary_usd" to "compensation_usd". What happens if a recipe blindly skips missing columns?',
    concept: 'Schema Drift Detection & Fail-Safe Recipe Replay',
    explanation: 'Silently skipping steps referencing renamed columns leaves downstream data uncleaned. DataMend Lab halts and prompts you to map "annual_salary_usd" to "compensation_usd".',
    recommendedOperation: null
  },
  {
    id: 'inv_12_data_leakage_prep',
    number: 12,
    title: 'How does data leakage occur during preparation?',
    presetId: 'preset_forecast_leakage_series',
    question: 'In Dataset 7, training rows hover around 106, while test rows jump to 188. What happens if you impute the March training NA using the overall dataset mean?',
    concept: 'Train/Test Contamination (Preprocessing Data Leakage)',
    explanation: 'Computing the mean across all rows mixes the future June–August regime shift (188) into the March training observation (producing 134.2 instead of the training mean 106.9).',
    recommendedOperation: {
      type: 'IMPUTE_MISSING',
      params: { columnName: 'demand_index', method: 'mean', splitColumn: 'split', trainValue: 'train' }
    }
  },
  {
    id: 'inv_13_reproducible_transformations',
    number: 13,
    title: 'Why should transformations be reproducible?',
    presetId: 'preset_messy_customers',
    question: 'Why is manual point-and-click cell editing in a spreadsheet risky for scientific research?',
    concept: 'Audit Trails, Provenance, and Deterministic Recipes',
    explanation: 'Manual cell edits overwrite raw values without recording what changed, why, or in what order. Saved recipes and R/Python scripts make every step auditable and repeatable.',
    recommendedOperation: null
  },
  {
    id: 'inv_14_validation_vs_truth',
    number: 14,
    title: 'How can a dataset pass validation yet still be wrong?',
    presetId: 'preset_mixed_units_biometrics',
    question: 'If you strip "kg" and "lbs" from weight_raw in Dataset 4 and validate that all numbers lie in [40, 250], does the dataset pass validation?',
    concept: 'Validity (Constraint Satisfaction) vs. Empirical Accuracy',
    explanation: 'Yes—both 70 (kg) and 154 (lbs) fall inside [40, 250], so a range check passes 100%, yet the values are on incompatible physical scales. Convert units first.',
    recommendedOperation: { type: 'CONVERT_UNITS', params: { columnName: 'weight_raw', targetUnit: 'kg' } }
  }
];

/**
 * Part 30 — Data Preparation Knowledge Atlas (19 Comprehensive Entries)
 * Uses clean Unicode/HTML mathematical notation (no raw unparsed LaTeX backslashes).
 */
export const KNOWLEDGE_ATLAS_ENTRIES = [
  {
    id: 'atlas_observational_unit',
    title: 'Observational Units & Granularity',
    domain: 'Data Fundamentals',
    capabilityStatus: 'Fully operational',
    definition: 'The specific entity, event, subject, or time-slice represented by a single row (tuple) in a rectangular dataset.',
    plainExplanation: 'Before cleaning any table, ask: "What is one row?" Is one row a customer, a single purchase, or a monthly summary?',
    whyItMatters: 'Misidentifying the observational unit leads to deleting valid longitudinal measurements as "duplicates" or double-counting entities after a join.',
    appropriateUse: 'Verify observational unit granularity during initial inspection and after every pivot, join, or group-by aggregation.',
    examples: 'Customer table (1 row = 1 person) vs. Transaction log (1 row = 1 checkout event) vs. Panel data (1 row = 1 person at 1 visit).',
    risks: 'Aggregating or pivoting changes the observational unit and often discards within-unit variation irreversibly.',
    statisticalImplications: 'Standard errors and degrees of freedom (df = n − p) assume independent observational units; clustered or repeated rows per subject violate i.i.d. assumptions.',
    toolConnections: 'Data Inspector (Relationship Profiler), Restructure Studio (Pivot/Unpivot & Group By).',
    relatedConcepts: ['Tidy Data Principles', 'Primary & Composite Keys', 'Relational Cardinality'],
    technicalExplanation: 'Let D be a relation of cardinality n. Each tuple t_i in D maps bijectively to an element of the sample space Ω only when the primary key matches the sampling unit.'
  },
  {
    id: 'atlas_tidy_data',
    title: 'Tidy Data Principles (Codd 3NF & Wickham)',
    domain: 'Restructuring',
    capabilityStatus: 'Fully operational',
    definition: 'A standard mapping of dataset meaning to structure: (1) each variable forms a column, (2) each observation forms a row, and (3) each type of observational unit forms a table.',
    plainExplanation: 'Put each measurement type in its own column and each individual case in its own row, rather than spreading months or categories across column headers.',
    whyItMatters: 'Statistical models, grouped summaries, and grammar-of-graphics visualizations require tidy variables to map columns to mathematical roles and visual channels.',
    appropriateUse: 'Use Wide-to-Long (Unpivot) when column headers represent values (such as years 2024, 2025, 2026) rather than variable names.',
    examples: 'Converting [store_id, Jan_Sales, Feb_Sales] into [store_id, month, sales].',
    risks: 'Over-normalizing data needed for matrix operations or wide cross-tab reporting.',
    statisticalImplications: 'Enables model formulas like y ~ x + group in ANOVA and regression without manual column looping.',
    toolConnections: 'Restructure Studio (Unpivot Wide to Long, Pivot Long to Wide).',
    relatedConcepts: ['Observational Units & Granularity', 'Wide vs. Long Reshaping', 'Pivot Collisions'],
    technicalExplanation: 'Corresponds to Codd\'s Third Normal Form (3NF) adapted for statistical matrix algebra where variables X_1, …, X_p are column vectors in R^n.'
  },
  {
    id: 'atlas_raw_vs_parsed',
    title: 'Raw vs. Interpreted Cell States',
    domain: 'Data Fundamentals',
    capabilityStatus: 'Fully operational',
    definition: 'Architectural separation between the literal source text imported from a file and its parsed typed value, display format, missingness state, and validation status.',
    plainExplanation: 'DataMend Lab never overwrites what your file originally said when interpreting numbers or dates, so a mistake in type detection can always be reversed.',
    whyItMatters: 'Irreversibly coercing "00123" to 123 or "03/04/2026" to a single date timestamp destroys source information.',
    appropriateUse: 'Maintain throughout the entire preparation lifecycle; inspect raw vs. formatted states in the Data Inspector and Before & After view.',
    examples: 'Raw "$1,250.50" → Parsed 1250.5 (float64) → Formatted "1250.5". Raw "00501" → Identifier "00501".',
    risks: 'Exporting to plain CSV flattens cell metadata unless accompanied by a DataSense JSON schema or provenance report.',
    statisticalImplications: 'Prevents silent truncation of unparseable observations into null missing values.',
    toolConnections: 'Data Inspector, Cleaning Studio (Convert Column Data Type).',
    relatedConcepts: ['Identifier Integrity & Leading Zeros', 'Missingness Typology', 'Non-Destructive Snapshots'],
    technicalExplanation: 'Each cell is a struct { raw, parsed, formatted, missingState, validationState, formula, isImputed } evaluated deterministically against column metadata.'
  },
  {
    id: 'atlas_identifier_integrity',
    title: 'Identifier Integrity & Leading Zeros',
    domain: 'Cleaning',
    capabilityStatus: 'Fully operational',
    definition: 'Preservation of exact lexical representations for nominal codes, postal ZIPs, account numbers, and SKUs composed of digits.',
    plainExplanation: 'Just because a ZIP code or ID is made of digits does not make it a number you can add or average. Leading zeros like in "00501" are part of the code.',
    whyItMatters: 'Spreadsheet tools routinely strip leading zeros on import, breaking joins against geographic or administrative databases.',
    appropriateUse: 'Classify all ID, ZIP, phone, and account columns as identifier semantic type.',
    examples: 'US ZIP codes in New England (02139), patient codes (00042), or product SKUs (098112).',
    risks: 'Treating numeric IDs as quantitative variables allows nonsensical regression or mean/SD calculations.',
    statisticalImplications: 'DataMend Lab blocks mean, median, variance, and IQR calculations on identifier columns.',
    toolConnections: 'Data Inspector, Cleaning Studio (Pad Identifier / Add Prefix or Suffix).',
    relatedConcepts: ['Raw vs. Interpreted Cell States', 'Scale of Measurement', 'Primary & Composite Keys'],
    technicalExplanation: 'Regex detector /^0\\d+$/ and column-name heuristics lock storageType to UTF-8 string and emit <c t="inlineStr"> in XLSX exports.'
  },
  {
    id: 'atlas_missingness_mechanisms',
    title: 'Missing-Data Mechanisms (MCAR, MAR, MNAR)',
    domain: 'Statistical Preparation',
    capabilityStatus: 'Fully operational',
    definition: 'Rubin\'s (1976) classification of why observations are missing: Missing Completely at Random (MCAR), Missing at Random conditional on observed covariates (MAR), and Missing Not at Random where missingness depends on the unobserved value itself (MNAR).',
    plainExplanation: 'Why is a cell blank? Did a sensor randomly drop out (MCAR), did younger respondents skip a question more often (MAR), or did high earners refuse to state their income (MNAR)?',
    whyItMatters: 'Listwise deletion is unbiased only under MCAR (though it reduces statistical power). Under MAR or MNAR, naive deletion or mean imputation biases parameter estimates.',
    appropriateUse: 'Inspect missingness co-occurrence patterns and groupwise rates before choosing between indicator flags, groupwise imputation, or complete-case filtering.',
    examples: 'High-income survey respondents marking salary as "WITHHELD" (MNAR).',
    risks: 'Replacing missing values with the column mean shrinks sample variance by (n_obs − 1)/(n − 1) and attenuates correlations.',
    statisticalImplications: 'Always disclose the effective complete-case sample size n_eff and mark imputed values with is_imputed: true.',
    toolConnections: 'Data Inspector (Missingness Matrix), Cleaning Studio (Add Missingness Indicator, Impute Missing Values).',
    relatedConcepts: ['Imputation Bias & Variance Attenuation', 'Missing-Value State Typology', 'Data Leakage in Preprocessing'],
    technicalExplanation: 'Let R_i in {0, 1} indicate observation presence. MCAR: P(R | Y_obs, Y_mis) = P(R). MAR: P(R | Y_obs, Y_mis) = P(R | Y_obs).'
  },
  {
    id: 'atlas_missing_states',
    title: 'Missing-Value State Typology',
    domain: 'Data Quality',
    capabilityStatus: 'Fully operational',
    definition: 'Distinguishing between unrecorded missing values (MISSING), empty strings (EMPTY_STRING), structural non-applicability (NOT_APPLICABLE), explicitly withheld responses (WITHHELD), parse errors (INVALID_PARSE), and non-finite arithmetic results (NONFINITE).',
    plainExplanation: '"Not Applicable" and "Refused to Answer" do not mean the same thing as an accidentally blank cell.',
    whyItMatters: 'Collapsing all non-present states into a single NULL loses domain meaning and leads to invalid imputations.',
    appropriateUse: 'Configure missingness, N/A, and withheld token sets during import and column inspection.',
    examples: 'NA vs. N/A (Not Applicable) vs. WITHHELD vs. NaN.',
    risks: 'Imputing over NOT_APPLICABLE fabricates impossible domain attributes.',
    statisticalImplications: 'Separates structural zeroes/inapplicability from stochastic missingness.',
    toolConnections: 'Data Inspector, Validation Studio.',
    relatedConcepts: ['Missing-Data Mechanisms (MCAR, MAR, MNAR)', 'Raw vs. Interpreted Cell States'],
    technicalExplanation: 'Tracked per cell via the MISSING_STATES enumeration in js/data-model.js.'
  },
  {
    id: 'atlas_imputation_bias',
    title: 'Imputation Bias & Variance Attenuation',
    domain: 'Statistical Preparation',
    capabilityStatus: 'Fully operational',
    definition: 'The distortion of empirical distributions, variances, and covariances caused by substituting single point estimates (such as the sample mean or median) for missing observations.',
    plainExplanation: 'Filling 20% of a column with the average value makes the data look artificially tightly clustered around the middle, causing confidence intervals to be too narrow and p-values too small.',
    whyItMatters: 'Single mean imputation is never statistically neutral: it underestimates standard deviation s_x and biases OLS regression slopes toward zero when predictors are imputed.',
    appropriateUse: 'Prefer non-destructive missingness indicators or groupwise/conditional methods with explicit disclosure; never hide imputed cells.',
    examples: 'Imputing missing blood pressure readings with the overall clinic mean.',
    risks: 'Inflated Type I error rates (α) in downstream hypothesis tests.',
    statisticalImplications: 'Every cell modified by IMPUTE_MISSING in DataMend Lab carries isImputed = true and is highlighted in the Before & After workspace.',
    toolConnections: 'Cleaning Studio (Impute Missing Values), Before & After Comparison.',
    relatedConcepts: ['Missing-Data Mechanisms (MCAR, MAR, MNAR)', 'Data Leakage in Preprocessing'],
    technicalExplanation: 'If m values are replaced by x̄_obs, the sum of squares SS_xx remains unchanged while degrees of freedom increase from n_obs − 1 to n − 1, scaling s² by (n_obs − 1)/(n − 1).'
  },
  {
    id: 'atlas_data_leakage',
    title: 'Data Leakage in Preprocessing & Forecasting',
    domain: 'Statistical Preparation',
    capabilityStatus: 'Fully operational',
    definition: 'Contamination of training data by information from future holdout or test observations during imputation, scaling, outlier capping, or feature engineering.',
    plainExplanation: 'If you use next month\'s test data to calculate the average used to fill in last month\'s training data, your model is peeking into the future.',
    whyItMatters: 'Leakage produces overly optimistic cross-validation and backtest accuracy that collapses when deployed in production.',
    appropriateUse: 'Always specify a training partition (split == "train") or temporal cutoff when fitting imputation parameters for prediction or forecasting recipes.',
    examples: 'Dataset 7 (preset_forecast_leakage_series) where test demand jumps from ~106 to ~188.',
    risks: 'Backward fill (bfill) or full-sample mean imputation on time series leaks future shocks backward in time.',
    statisticalImplications: 'Violates causal temporal ordering required by ForecastLab and cross-validation standards in STATISTICAL_STANDARDS.md Section J.2.',
    toolConnections: 'Cleaning Studio (Impute Missing Values with Training Split Filter), Recipe Builder.',
    relatedConcepts: ['Temporal Ordering & Time-Series Gaps', 'Reusable Cleaning Recipes'],
    technicalExplanation: 'Preprocessing estimator θ̂_prep must be a function purely of D_train, stored in dataset.learnedParameters, and applied out-of-sample to D_test.'
  },
  {
    id: 'atlas_exact_vs_key_duplicates',
    title: 'Exact Duplicate Rows vs. Duplicate Keys',
    domain: 'Cleaning',
    capabilityStatus: 'Fully operational',
    definition: 'Distinction between tuples that are identical across every attribute (t_i = t_j) versus tuples that share a candidate identifier or name while differing in other columns.',
    plainExplanation: 'Two identical rows are usually a copy-paste or export error. Two rows with the same ID but different dates or amounts may be two separate purchases or visits.',
    whyItMatters: 'Blindly deduplicating on an ID column without checking conflicting values silently destroys history or merges different people who share a name.',
    appropriateUse: 'Use Quality Audit to inspect both Exact Duplicate Rows and Repeated Entity Identifiers separately.',
    examples: 'Dataset 1 (CUST-101 exact duplicate vs. Alex Rivera shared name) and Dataset 3 (PAT-01 longitudinal visits).',
    risks: 'Silent loss of longitudinal records or conflicting measurements.',
    statisticalImplications: 'Removing true duplicate artifacts restores intended sample size n; removing valid repeated measures destroys panel structure.',
    toolConnections: 'Quality Audit, Cleaning Studio (Deduplicate Records, Flag Duplicate Keys).',
    relatedConcepts: ['Observational Units & Granularity', 'Fuzzy Matching & Record Linkage'],
    technicalExplanation: 'Full-tuple equivalence (for all k: t_i[k] = t_j[k]) vs. key-projection equivalence (π_K(t_i) = π_K(t_j) and π_¬K(t_i) ≠ π_¬K(t_j)).'
  },
  {
    id: 'atlas_fuzzy_record_linkage',
    title: 'Fuzzy Matching & Record Linkage',
    domain: 'Cleaning',
    capabilityStatus: 'Fully operational',
    definition: 'Probabilistic or edit-distance candidate detection for identifying records or category strings that may refer to the same real-world entity despite typographical variations.',
    plainExplanation: 'Finds strings that are spelled almost the same (like "Engineering" and "Enginering") so a human can review whether they belong together.',
    whyItMatters: 'Human data entry introduces typos and punctuation differences that exact string matching misses.',
    appropriateUse: 'Use Levenshtein edit distance and normalized token comparisons to generate candidate pairs for human review—never merge identities automatically without approval.',
    examples: 'Category alias suggestions in Cleaning Studio and Fuzzy Duplicate Candidate scanner.',
    risks: 'False positive merges (e.g., merging "John Smith" and "Joan Smith" at edit distance 1).',
    statisticalImplications: 'Unreviewed automated entity merging introduces measurement error across joined attributes.',
    toolConnections: 'Cleaning Studio (Fuzzy Candidate Scanner & Category Mapping).',
    relatedConcepts: ['Exact Duplicate Rows vs. Duplicate Keys', 'Category Standardization & Alias Mapping'],
    technicalExplanation: 'Computes dynamic-programming Levenshtein distance d_L(s_1, s_2) and normalized similarity 1 − d_L / max(|s_1|, |s_2|).'
  },
  {
    id: 'atlas_category_standardization',
    title: 'Category Standardization & Alias Mapping',
    domain: 'Cleaning',
    capabilityStatus: 'Fully operational',
    definition: 'Consolidating superficial lexical variants (whitespace, capitalization, punctuation) and domain aliases into a canonical set of factor levels.',
    plainExplanation: 'Merging "NY", "N.Y.", "new york", and "New York " into "New York" so all observations in the same state are counted together.',
    whyItMatters: 'Unstandardized categories split sample counts across spurious factor levels, invalidating bar charts, contingency tables, and ANOVA degrees of freedom.',
    appropriateUse: 'Trim whitespace and normalize case first (low risk), then review and approve explicit alias mappings (medium risk).',
    examples: 'Dataset 1 state and department standardization.',
    risks: 'Collapsing distinct domain categories if an abbreviation is ambiguous.',
    statisticalImplications: 'Restores true cell frequencies O_ij in χ² tests and factor indicator matrices in regression.',
    toolConnections: 'Cleaning Studio (Trim Whitespace, Standardize Case, Apply Canonical Category Mapping).',
    relatedConcepts: ['Ordinal Factor Preservation', 'Fuzzy Matching & Record Linkage'],
    technicalExplanation: 'Applies surjective mapping f: Σ_raw → Σ_canonical recorded in transformation provenance.'
  },
  {
    id: 'atlas_ordinal_factors',
    title: 'Ordinal Factor Preservation',
    domain: 'Statistical Preparation',
    capabilityStatus: 'Fully operational',
    definition: 'Maintaining the intrinsic semantic ordering of qualitative response scales rather than sorting levels alphabetically.',
    plainExplanation: 'Survey answers like "Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree" have a natural order. Sorting them A-to-Z scrambles that meaning.',
    whyItMatters: 'Alphabetical sorting places "Agree" first and "Neutral" after "Disagree", distorting ordinal bar charts and cumulative logits.',
    appropriateUse: 'Use ordered_categorical semantic type with explicit allowedCategories order.',
    examples: 'Likert satisfaction scale in Dataset 1; severity levels ["low", "medium", "high"].',
    risks: 'Converting ordinal levels to arbitrary integers 1..5 assumes equal interval spacing unless justified.',
    statisticalImplications: 'Preserves monotonic rank relationships for Spearman ρ_s and ordered visualizations in VisualGrammar.',
    toolConnections: 'Data Inspector, Cleaning Studio (Sort Rows & Type Conversion).',
    relatedConcepts: ['Category Standardization & Alias Mapping', 'DataSense Ecosystem Interoperability'],
    technicalExplanation: 'Complies with DATA_CONVENTIONS.md Section B.2 and VISUALIZATION_STANDARDS.md Section A.1.'
  },
  {
    id: 'atlas_date_ambiguity',
    title: 'Date Parsing & Locale Ambiguity',
    domain: 'Cleaning',
    capabilityStatus: 'Fully operational',
    definition: 'Explicit resolution of ambiguous calendar representations (such as 03/04/2026) into canonical ISO 8601 (YYYY-MM-DD) format.',
    plainExplanation: 'In the US, 03/04/2026 is March 4. In Europe and most of the world, it is April 3. Software should never guess silently.',
    whyItMatters: 'Silent locale guessing scrambles monthly cohorts, time-to-event survival durations, and seasonal time-series decompositions.',
    appropriateUse: 'Flag any slash/dash date where both first and second components are ≤ 12 and unequal; require explicit MDY or DMY selection.',
    examples: 'Dataset 1 signup_date (03/04/2026, 05/06/2026).',
    risks: 'Excel 1900 vs. 1904 serial date system mismatches (including the Lotus 1-2-3 Feb 29, 1900 leap-year bug).',
    statisticalImplications: 'Ensures monotonic temporal coordinates t_1 ≤ t_2 ≤ … ≤ t_T for ForecastLab.',
    toolConnections: 'Quality Audit, Cleaning Studio (Resolve Date Convention to ISO 8601).',
    relatedConcepts: ['Raw vs. Interpreted Cell States', 'Temporal Ordering & Time-Series Gaps'],
    technicalExplanation: 'Regex & bounds parser detectDateAmbiguity() in js/data-model.js and excelSerialToIsoDate() in js/parsers.js.'
  },
  {
    id: 'atlas_unit_standardization',
    title: 'Measurement Units & Dimensional Integrity',
    domain: 'Cleaning',
    capabilityStatus: 'Fully operational',
    definition: 'Explicitly converting numerical quantities recorded in heterogeneous physical units (e.g., kilograms vs. pounds, centimeters vs. inches, Celsius vs. Fahrenheit) into a single canonical unit.',
    plainExplanation: 'If one clinic records weight in kilograms (70 kg) and another in pounds (154 lbs), just deleting the letters gives you 70 and 154—making two identical patients look twice as heavy.',
    whyItMatters: 'Mixing units creates artificial bimodal distributions, extreme fake outliers, and invalid regression slopes.',
    appropriateUse: 'Use the validated Unit Conversion Registry in Cleaning Studio before converting text-with-units to decimal.',
    examples: 'Dataset 4 (preset_mixed_units_biometrics).',
    risks: 'Guessing units when column metadata is absent.',
    statisticalImplications: 'Linear unit scaling X* = a + bX shifts mean by a + b·x̄ and scales SD by |b|·s_x; mixing unscaled units destroys both.',
    toolConnections: 'Quality Audit, Cleaning Studio (Standardize Measurement Units).',
    relatedConcepts: ['Validity vs. Real-World Accuracy', 'Outlier Diagnostics (Tukey IQR, Z-Score, MAD)'],
    technicalExplanation: 'Deterministic factor table UNIT_CONVERSION_REGISTRY in js/transforms.js updates both cell values and column.unit metadata.'
  },
  {
    id: 'atlas_outlier_diagnostics',
    title: 'Outlier Diagnostics (Tukey IQR, Z-Score, MAD)',
    domain: 'Statistical Preparation',
    capabilityStatus: 'Fully operational',
    definition: 'Quantitative screening rules that flag extreme observations relative to parametric (x̄, s) or robust (x̃, IQR, MAD_σ) location and dispersion estimators.',
    plainExplanation: 'Outlier rules highlight unusually high or low numbers so you can check whether they are data-entry typos or genuine extreme events.',
    whyItMatters: 'A single high-leverage outlier can dominate OLS regression slopes and inflate sample variance, yet automatically deleting real extreme values biases scientific conclusions.',
    appropriateUse: 'Use Tukey 1.5 × IQR fences or robust MAD Z-scores to flag observations (FLAG_OUTLIERS) rather than automatically deleting them.',
    examples: 'Dataset 1 ($500,000 executive salary flagged as HIGH_OUTLIER but preserved as legitimate).',
    risks: 'Classical Z-scores (|z_i| > 3) suffer from masking in small samples because x̄ and s are themselves pulled by the outlier; Tukey IQR and MAD have a 50% breakdown point.',
    statisticalImplications: 'Adheres to STATISTICAL_STANDARDS.md Section B.6 and Part 16.',
    toolConnections: 'Quality Audit, Cleaning Studio (Flag Statistical Outliers, Winsorize / Cap Extreme Values).',
    relatedConcepts: ['Robust Statistics (Median, IQR, MAD)', 'Observational Units & Granularity'],
    technicalExplanation: 'Tukey inner fences: [Q_1 − 1.5·IQR, Q_3 + 1.5·IQR] using Hyndman-Fan Type 7 quartiles; normal-consistent MAD_σ = 1.4826 · median|x_i − x̃|.'
  },
  {
    id: 'atlas_join_cardinality',
    title: 'Relational Joins & Cardinality (1:1, 1:N, M:N)',
    domain: 'Restructuring',
    capabilityStatus: 'Fully operational',
    definition: 'Combining columns from two relations L and R based on matching key predicates, classified by key multiplicity on each side.',
    plainExplanation: 'When combining two tables, check whether the matching ID is unique in both tables (1:1), unique in one table (1:N), or repeated in both tables (M:N).',
    whyItMatters: 'An unexpected Many-to-Many (M:N) join multiplies rows into a Cartesian product, silently inflating totals and sample sizes.',
    appropriateUse: 'Always run Join Diagnostics in Restructure Studio to inspect key uniqueness, unmatched left/right rows, and predicted row counts before applying a join.',
    examples: 'Joining Dataset 5A (Orders) with Dataset 5B (Customer Directory where ACCT-01 is duplicated).',
    risks: 'Allowing NULL == NULL key matches creates false-positive cross-joins on missing keys; DataMend Lab strictly prevents null-key matching by default.',
    statisticalImplications: 'Preserves referential provenance and prevents artificial sample size inflation.',
    toolConnections: 'Restructure Studio (Multi-Table Join Workbench).',
    relatedConcepts: ['Exact Duplicate Rows vs. Duplicate Keys', 'Observational Units & Granularity'],
    technicalExplanation: 'Supports Inner, Left, Right, Full Outer, Semi, and Anti joins over single or composite keys via hash indexing in js/restructure.js.'
  },
  {
    id: 'atlas_pivot_collisions',
    title: 'Long-to-Wide Pivot Collisions',
    domain: 'Restructuring',
    capabilityStatus: 'Fully operational',
    definition: 'A conflict that arises during a Long-to-Wide pivot when multiple source rows share the same identifier and target column category.',
    plainExplanation: 'If patient PAT-01 has two "Baseline" blood pressure readings (134 and 130), a wide table with one row per patient and one "Baseline" column cannot hold both numbers unless you specify how to combine them.',
    whyItMatters: 'Software that silently picks the first or last value during a pivot hides duplicate measurements and discards data without warning.',
    appropriateUse: 'When a collision is detected, choose an explicit resolution strategy (mean, sum, first, last, count) or deduplicate first.',
    examples: 'Dataset 3 (preset_long_panel_collisions).',
    risks: 'Silent data loss if conflict strategy is not disclosed.',
    statisticalImplications: 'Averaging replicate measurements reduces within-cell measurement error variance by 1/k.',
    toolConnections: 'Restructure Studio (Pivot Long to Wide).',
    relatedConcepts: ['Tidy Data Principles (Codd 3NF & Wickham)', 'Grouping & Aggregation Granularity'],
    technicalExplanation: 'Implemented in pivotLongToWide() (js/restructure.js), which throws a descriptive collision warning when conflictStrategy === "error" and cell multiplicity > 1.'
  },
  {
    id: 'atlas_grouping_aggregation',
    title: 'Grouping & Aggregation Granularity',
    domain: 'Restructuring',
    capabilityStatus: 'Fully operational',
    definition: 'Partitioning observations into equivalence classes defined by grouping variables and reducing each partition to summary statistics.',
    plainExplanation: 'Summarizing a detailed table into one row per group (such as total sales and average price per region).',
    whyItMatters: 'Aggregation irreversibly reduces granularity: you cannot reconstruct individual customer rows from regional averages alone.',
    appropriateUse: 'Include group counts (count) and dispersion (sd, iqr) alongside location summaries (mean, median).',
    examples: 'Grouping Dataset 1 by department to compute count, mean salary, and median salary.',
    risks: 'Ecological fallacy: correlations between group means do not equal individual-level correlations.',
    statisticalImplications: 'Distinguishes unweighted group means from weighted means; explicitly discloses how missing group keys are handled.',
    toolConnections: 'Restructure Studio (Group & Aggregate).',
    relatedConcepts: ['Observational Units & Granularity', 'Robust Statistics (Median, IQR, MAD)'],
    technicalExplanation: 'Computes grouped moments using two-pass centered variance and Hyndman-Fan Type 7 quantiles in groupAndAggregate().'
  },
  {
    id: 'atlas_schema_drift',
    title: 'Schema Drift & Reusable Cleaning Recipes',
    domain: 'Reproducibility',
    capabilityStatus: 'Fully operational',
    definition: 'Changes in column names, data types, units, or category sets between successive batches of an evolving data source.',
    plainExplanation: 'When next month\'s spreadsheet arrives, someone may have renamed a column or changed its format. A safe recipe checks for these changes before running.',
    whyItMatters: 'Blindly running an automated script on a drifted schema can corrupt columns or silently skip critical cleaning steps.',
    appropriateUse: 'Export a versioned JSON Recipe in Recipe Builder and use the Schema-Drift Validator when applying it to new batches.',
    examples: 'Applying a recipe from Dataset 1 onto Dataset 8 (annual_salary_usd → compensation_usd).',
    risks: 'Silent step skipping in unvalidated scripts.',
    statisticalImplications: 'Guarantees deterministic, auditable data preparation across longitudinal updates.',
    toolConnections: 'Recipe Builder, Export & Reproduce.',
    relatedConcepts: ['Data Leakage in Preprocessing & Forecasting', 'Audit Trails & Non-Destructive History'],
    technicalExplanation: 'validateRecipeCompatibility() compares recipe.requiredInputSchema against target dataset columns and supports interactive column remapping.'
  },
  {
    id: 'atlas_validation_vs_accuracy',
    title: 'Validation Constraints vs. Real-World Accuracy',
    domain: 'Data Quality',
    capabilityStatus: 'Fully operational',
    definition: 'The distinction between internal formal validity (satisfying schema types, ranges, uniqueness, and regex patterns) and external empirical accuracy (matching ground-truth reality).',
    plainExplanation: 'A validation rule can verify that an age is between 0 and 120, but it cannot tell you whether a 35-year-old was accidentally typed as 53.',
    whyItMatters: 'Passing 100% of validation rules or quality gates does not prove a dataset is free of measurement error or sampling bias.',
    appropriateUse: 'Combine formal Validation Studio rules and Quality Gates with exploratory distributions and provenance audits.',
    examples: 'Dataset 4 (mixed units passing a wide numeric range check) and Guided Investigation 14.',
    risks: 'Overconfidence in automated "cleanliness" percentages.',
    statisticalImplications: 'DataMend Lab reports 6 transparent scorecard dimensions with explicit formulas rather than an opaque "100% Clean" claim.',
    toolConnections: 'Validation Studio, Quality Audit Scorecard.',
    relatedConcepts: ['Measurement Units & Dimensional Integrity', 'Outlier Diagnostics (Tukey IQR, Z-Score, MAD)'],
    technicalExplanation: 'Evaluated across 16 rule families in js/validation.js with pass, fail, and inapplicable counts.'
  },
  {
    id: 'atlas_csv_injection_security',
    title: 'Spreadsheet Formula Injection & Untrusted File Safety',
    domain: 'Reproducibility',
    capabilityStatus: 'Fully operational',
    definition: 'Security vulnerabilities where untrusted text fields starting with =, +, -, or @ execute as active formulas or DDE commands when opened in spreadsheet software.',
    plainExplanation: 'A malicious CSV cell like =HYPERLINK(...) can run commands when opened in Excel. DataMend Lab neutralizes formula triggers on export while keeping your internal data intact.',
    whyItMatters: 'Analysts frequently clean untrusted external survey or web exports and open the results in desktop spreadsheets.',
    appropriateUse: 'Keep CSV Formula-Injection Sanitization enabled in Export & Reproduce when exporting CSV/TSV files for spreadsheet users.',
    examples: 'Prepending a protective single quote \' to strings starting with =, +, @ during CSV export.',
    risks: 'Executing Excel VBA macros or using dynamic-eval on user expressions.',
    statisticalImplications: 'Protects negative numbers (e.g., -42.5 is never escaped) so numerical round-trips remain exact.',
    toolConnections: 'Export & Reproduce, Data Import Engine.',
    relatedConcepts: ['Raw vs. Interpreted Cell States', 'DataSense Ecosystem Interoperability'],
    technicalExplanation: 'Complies with DATA_CONVENTIONS.md Section D.2 and Part 27.4 / Part 34.'
  },
  {
    id: 'atlas_datasense_interoperability',
    title: 'DataSense Ecosystem Interoperability',
    domain: 'Data Fundamentals',
    capabilityStatus: 'Fully operational',
    definition: 'Standardized exchange of cleaned, schema-typed datasets and provenance metadata across DataMend Lab, QuartetLab, VisualGrammar, ResampleLab, and ForecastLab.',
    plainExplanation: 'Once your dataset is cleaned in DataMend Lab, you can export it in the shared DataSense format with variable roles, units, ordered categories, and imputation flags preserved.',
    whyItMatters: 'Prevents losing variable types, grouping structures, or time-series ordering when moving from data cleaning to regression, visualization, resampling, or forecasting.',
    appropriateUse: 'Export DataSenseDataset (v1.0.0) JSON or RFC 4180 CSV from Export & Reproduce.',
    examples: 'Preparing bivariate numerical data for QuartetLab or chronological series for ForecastLab.',
    risks: 'Dropping pairing or clustering identifiers before resampling in ResampleLab.',
    statisticalImplications: 'Preserves observational units, variable roles (explanatory, response, grouping, timestamp), and is_imputed flags.',
    toolConnections: 'Export & Reproduce, Home Ecosystem Navigation.',
    relatedConcepts: ['Observational Units & Granularity', 'Ordinal Factor Preservation', 'Data Leakage in Preprocessing & Forecasting'],
    technicalExplanation: 'Implements DataSenseDataset v1.0.0 schema specified in DATA_CONVENTIONS.md Section E.1.'
  }
];
