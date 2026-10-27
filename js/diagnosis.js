/**
 * DataMend Lab — Explainable Data-Quality Diagnosis Engine (Part 9 & Part 10)
 *
 * Detects 25 issue categories with deterministic, evidence-based explanations:
 * - Never confuses a suspicious observation with a known error.
 * - Distinguishes severity levels:
 *   1. CONFIRMED_PARSE_ERROR
 *   2. CONSTRAINT_VIOLATION
 *   3. SUPERFICIAL_INCONSISTENCY
 *   4. POTENTIAL_SEMANTIC_INCONSISTENCY
 *   5. SUSPICIOUS_STATISTICAL_OBSERVATION
 *   6. INFORMATIONAL_FINDING
 * - Assigns Risk Classifications (READ_ONLY, LOW, MEDIUM, HIGH) per Part 10.
 */

import { MISSING_STATES, SEMANTIC_TYPES } from './data-model.js';

export const ISSUE_SEVERITIES = Object.freeze({
  CONFIRMED_PARSE_ERROR: 'Confirmed Parsing/Format Error',
  CONSTRAINT_VIOLATION: 'Violated User-Defined Constraint',
  SUPERFICIAL_INCONSISTENCY: 'Highly Likely Superficial Inconsistency',
  POTENTIAL_SEMANTIC_INCONSISTENCY: 'Potential Semantic Inconsistency',
  SUSPICIOUS_STATISTICAL_OBSERVATION: 'Suspicious Statistical Observation',
  INFORMATIONAL_FINDING: 'Informational Finding'
});

export const RISK_LEVELS = Object.freeze({
  READ_ONLY: 'Read-only',
  LOW: 'Low risk',
  MEDIUM: 'Medium risk',
  HIGH: 'High risk'
});

/**
 * Computes Levenshtein edit distance between two short category strings.
 */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * Runs a full diagnostic audit on a profiled dataset and returns structured Issue objects.
 */
export function diagnoseDataset(dataset, profile) {
  const issues = [];
  let seq = 1;
  const nextId = (prefix) => `iss_${prefix}_${seq++}`;

  // 1. Import / Structural Parsing Warnings (Malformed rows, duplicate headers, merged cells, formulas)
  if (dataset.sourceMetadata?.parsingWarnings?.length > 0) {
    const warnings = dataset.sourceMetadata.parsingWarnings;
    const byCode = new Map();
    for (const w of warnings) {
      if (!byCode.has(w.code)) byCode.set(w.code, []);
      byCode.get(w.code).push(w);
    }
    for (const [code, list] of byCode.entries()) {
      issues.push({
        id: nextId('struct'),
        category: code === 'DUPLICATE_HEADER' ? 'Duplicate headers' : 'Structural irregularities',
        severity: code.includes('MALFORMED') || code.includes('UNAVAILABLE')
          ? ISSUE_SEVERITIES.CONFIRMED_PARSE_ERROR
          : ISSUE_SEVERITIES.INFORMATIONAL_FINDING,
        confidence: 'High (Deterministic parser log)',
        affectedColumns: [],
        affectedRowIds: [],
        affectedCount: list.length,
        finding: `${code}: ${list[0].message}`,
        evidence: `${list.length} occurrence(s) recorded during file ingestion.`,
        explanation: {
          simple: `The source file had structural quirks (${code}) that were preserved so no data was lost.`,
          standard: `Parser reported ${list.length} structural warning(s) of type ${code}. Original values were retained without silent truncation.`,
          technical: `Ingestion parser emitted ${list.length} event(s) with code=${code}. Review Restructure Studio or Column metadata to resolve.`
        },
        suggestedRemedy: null,
        consequences: 'If unaddressed, structural header or row shifts can misalign variables.',
        riskClassification: RISK_LEVELS.READ_ONLY,
        previewAvailable: false,
        resolutionState: 'OPEN'
      });
    }
  }

  // 2. Exact Duplicate Rows
  if (profile.exactDuplicateRowCount > 0) {
    const affectedRowIds = [];
    for (const grp of profile.relationships.duplicateRowGroups) {
      affectedRowIds.push(...grp.rowIds.slice(1));
    }
    const examples = profile.relationships.duplicateRowGroups
      .slice(0, 3)
      .map(g => `Rows [${g.rowIds.join(', ')}]`)
      .join('; ');

    issues.push({
      id: nextId('dup_exact'),
      category: 'Duplicate rows',
      severity: ISSUE_SEVERITIES.POTENTIAL_SEMANTIC_INCONSISTENCY,
      confidence: 'High for exact cell equality; Medium for whether records represent repeated events',
      affectedColumns: dataset.columns.map(c => c.displayName),
      affectedRowIds,
      affectedCount: profile.exactDuplicateRowCount,
      finding: `${profile.exactDuplicateRowCount} exact duplicate row(s) detected across ${profile.relationships.duplicateRowGroups.length} group(s).`,
      evidence: `Identical values across all ${dataset.columns.length} columns: ${examples}.`,
      explanation: {
        simple: `There are ${profile.exactDuplicateRowCount} rows that are 100% identical to earlier rows.`,
        standard: `Exact row duplication across all variables often indicates double data entry or repeated export ingestion, though in un-keyed event logs two identical measurements can occur legitimately.`,
        technical: `Full-tuple equality (including missingState equivalence) identified ${profile.exactDuplicateRowCount} redundant tuples across ${profile.relationships.duplicateRowGroups.length} equivalence classes.`
      },
      suggestedRemedy: {
        operationType: 'DEDUPLICATE_EXACT',
        label: 'Remove exact duplicate rows (keep first)',
        params: { strategy: 'keep_first', columns: dataset.columns.map(c => c.id) }
      },
      consequences: 'Removing duplicates reduces sample size n and alters frequencies/means.',
      riskClassification: RISK_LEVELS.HIGH,
      previewAvailable: true,
      resolutionState: 'OPEN'
    });
  }

  // 3. Repeated Entity Identifiers (Distinguished from Exact Duplicates!)
  for (const rep of profile.relationships.repeatedIdentifierFindings) {
    issues.push({
      id: nextId('dup_key'),
      category: 'Duplicate keys',
      severity: rep.hasConflictingAttributes
        ? ISSUE_SEVERITIES.POTENTIAL_SEMANTIC_INCONSISTENCY
        : ISSUE_SEVERITIES.INFORMATIONAL_FINDING,
      confidence: 'Ambiguous (Could be duplicate entity or legitimate longitudinal/one-to-many structure)',
      affectedColumns: [rep.columnName],
      affectedRowIds: [],
      affectedCount: rep.totalAffectedRows,
      finding: `Identifier column "${rep.columnName}" has ${rep.repeatedKeyCount} repeated key value(s) spanning ${rep.totalAffectedRows} rows.`,
      evidence: `Examples: ${rep.examples.map(e => `"${e.key}" (${e.count}x)`).join(', ')}. ${rep.hasConflictingAttributes ? 'Rows with the same key contain differing attribute values.' : 'Rows share identical attributes.'}`,
      explanation: {
        simple: `The ID or name in "${rep.columnName}" appears more than once. Two rows with the same name or ID might be different transactions, repeat visits, or two different people with the same name.`,
        standard: `Repeated keys in "${rep.columnName}" violate primary-key uniqueness if one row should represent one entity, but are completely valid if the dataset is longitudinal (panel data) or represents multiple events per entity.`,
        technical: `Key multiplicity > 1 on "${rep.columnName}" (${rep.repeatedKeyCount} non-unique keys). Conflicting non-key attributes=${rep.hasConflictingAttributes}. Do not deduplicate without verifying observational unit granularity.`
      },
      suggestedRemedy: {
        operationType: 'MARK_DUPLICATE_KEYS',
        label: `Flag duplicate keys on "${rep.columnName}" without deleting records`,
        params: { colId: rep.colId, columnName: rep.columnName }
      },
      consequences: 'Deleting repeated keys without inspection risks destroying longitudinal measurements or distinct individuals.',
      riskClassification: RISK_LEVELS.LOW,
      previewAvailable: true,
      resolutionState: 'OPEN'
    });
  }

  // Per-Column Diagnostics
  for (let cIdx = 0; cIdx < dataset.columns.length; cIdx++) {
    const col = dataset.columns[cIdx];
    const cp = profile.columnProfiles[cIdx];

    // 4. Empty Column
    if (cp.isEmptyColumn && cp.totalRows > 0) {
      issues.push({
        id: nextId('empty_col'),
        category: 'Empty columns',
        severity: ISSUE_SEVERITIES.INFORMATIONAL_FINDING,
        confidence: 'High',
        affectedColumns: [col.displayName],
        affectedRowIds: [],
        affectedCount: cp.totalRows,
        finding: `Column "${col.displayName}" contains 0 non-missing values across all ${cp.totalRows} rows.`,
        evidence: `100% missingness (${cp.totalRows}/${cp.totalRows} empty).`,
        explanation: {
          simple: `Column "${col.displayName}" is completely blank.`,
          standard: `All observations in "${col.displayName}" are missing. Empty columns often originate from stray spreadsheet delimiters.`,
          technical: `Zero-cardinality null vector on column ${col.id} ("${col.displayName}").`
        },
        suggestedRemedy: {
          operationType: 'DROP_COLUMN',
          label: `Remove empty column "${col.displayName}"`,
          params: { colId: col.id, columnName: col.displayName }
        },
        consequences: 'Removes column from working schema.',
        riskClassification: RISK_LEVELS.MEDIUM,
        previewAvailable: true,
        resolutionState: 'OPEN'
      });
      continue;
    }

    // 5. Constant Column
    if (cp.isConstant && cp.totalRows >= 3) {
      issues.push({
        id: nextId('const_col'),
        category: 'Constant columns',
        severity: ISSUE_SEVERITIES.INFORMATIONAL_FINDING,
        confidence: 'High',
        affectedColumns: [col.displayName],
        affectedRowIds: [],
        affectedCount: cp.nonMissingCount,
        finding: `Column "${col.displayName}" has zero variance (every non-missing row equals "${cp.topValues[0]?.value}").`,
        evidence: `1 unique value across ${cp.nonMissingCount} non-missing observations.`,
        explanation: {
          simple: `Every row in "${col.displayName}" has the exact same value.`,
          standard: `Zero-variance predictors carry no statistical information for regression or correlation and cause singular matrices if used as explanatory variables.`,
          technical: `Degenerate distribution (uniqueCount=1, s^2=0) on "${col.displayName}".`
        },
        suggestedRemedy: null,
        consequences: 'Retain if needed for provenance when appending multiple files; exclude from regression predictors.',
        riskClassification: RISK_LEVELS.READ_ONLY,
        previewAvailable: false,
        resolutionState: 'OPEN'
      });
    }

    // 6. Leading / Trailing / Repeated Whitespace
    const wsTotal =
      cp.whitespacePatterns.leading +
      cp.whitespacePatterns.trailing +
      cp.whitespacePatterns.repeatedInternal;
    if (wsTotal > 0) {
      const affectedRowIds = [];
      const examples = [];
      for (const row of dataset.rows) {
        const raw = row.cells[col.id]?.raw;
        if (typeof raw === 'string' && (/^\s+|\s+$|\S\s{2,}\S/.test(raw))) {
          affectedRowIds.push(row._rowId);
          if (examples.length < 4) examples.push(`"${raw}" → "${raw.trim().replace(/\s{2,}/g, ' ')}"`);
        }
      }
      issues.push({
        id: nextId('ws'),
        category: 'Leading and trailing whitespace',
        severity: ISSUE_SEVERITIES.SUPERFICIAL_INCONSISTENCY,
        confidence: 'High',
        affectedColumns: [col.displayName],
        affectedRowIds,
        affectedCount: affectedRowIds.length,
        finding: `Column "${col.displayName}" contains ${affectedRowIds.length} value(s) with leading, trailing, or repeated internal whitespace.`,
        evidence: `Leading=${cp.whitespacePatterns.leading}, Trailing=${cp.whitespacePatterns.trailing}, Repeated internal=${cp.whitespacePatterns.repeatedInternal}. Examples: ${examples.join(', ')}.`,
        explanation: {
          simple: `Extra spaces in "${col.displayName}" make identical text look different to the computer.`,
          standard: `Superficial whitespace splits categories and causes join key mismatches across tables.`,
          technical: `Non-canonical whitespace tokens detected in ${affectedRowIds.length} cells of ${col.id}. Risk: Low for ordinary text/categories, though fixed-width codes could intentionally include padding.`
        },
        suggestedRemedy: {
          operationType: 'TRIM_WHITESPACE',
          label: `Trim & normalize spaces in "${col.displayName}"`,
          params: { colId: col.id, columnName: col.displayName, normalizeInternal: true }
        },
        consequences: 'Standardizes string boundaries and merges categories separated only by spaces.',
        riskClassification: RISK_LEVELS.LOW,
        previewAvailable: true,
        resolutionState: 'OPEN'
      });
    }

    // 7. Inconsistent Capitalization / Case Variants
    if (
      cp.superficialClusters.length > 0 &&
      (cp.semanticType === SEMANTIC_TYPES.CATEGORICAL || cp.semanticType === SEMANTIC_TYPES.TEXT)
    ) {
      const clusterDesc = cp.superficialClusters
        .slice(0, 3)
        .map(c => c.variants.map(v => `"${v.value}" (${v.count})`).join(' vs '))
        .join('; ');
      let affectedCount = 0;
      const affectedRowIds = [];
      const normSet = new Set(cp.superficialClusters.map(c => c.normalized));
      for (const row of dataset.rows) {
        const raw = row.cells[col.id]?.raw;
        if (typeof raw === 'string' && normSet.has(raw.trim().toLowerCase())) {
          affectedCount++;
          affectedRowIds.push(row._rowId);
        }
      }

      issues.push({
        id: nextId('case'),
        category: 'Inconsistent capitalization',
        severity: ISSUE_SEVERITIES.SUPERFICIAL_INCONSISTENCY,
        confidence: 'High',
        affectedColumns: [col.displayName],
        affectedRowIds,
        affectedCount,
        finding: `Column "${col.displayName}" has ${cp.superficialClusters.length} category group(s) differing only by capitalization or spacing.`,
        evidence: `Variant counts: ${clusterDesc}.`,
        explanation: {
          simple: `Categories in "${col.displayName}" are spelled with different upper/lower case letters, splitting their counts.`,
          standard: `Case inconsistency inflates distinct category counts and distorts grouped frequencies and chi-squared/ANOVA factor levels.`,
          technical: `Case-folded equivalence classes on "${col.displayName}" show ${cp.superficialClusters.length} split factor levels.`
        },
        suggestedRemedy: {
          operationType: 'STANDARDIZE_CASE',
          label: `Normalize "${col.displayName}" to canonical Title/Trimmed case`,
          params: { colId: col.id, columnName: col.displayName, mode: 'canonical_most_frequent' }
        },
        consequences: 'Merges case variants into the most frequent canonical spelling.',
        riskClassification: RISK_LEVELS.LOW,
        previewAvailable: true,
        resolutionState: 'OPEN'
      });
    }

    // 8. Near-Duplicate / Alias Categories (e.g., NY, N.Y., New York)
    if (cp.semanticType === SEMANTIC_TYPES.CATEGORICAL && cp.allFrequencies.length >= 2 && cp.allFrequencies.length <= 40) {
      const aliasSuggestions = detectCategoryAliases(cp.allFrequencies);
      if (aliasSuggestions.length > 0) {
        const mapping = {};
        for (const s of aliasSuggestions) {
          mapping[s.variant] = s.canonical;
        }
        const affectedRowIds = [];
        for (const row of dataset.rows) {
          const val = String(row.cells[col.id]?.parsed ?? '').trim();
          if (mapping[val]) affectedRowIds.push(row._rowId);
        }
        issues.push({
          id: nextId('cat_alias'),
          category: 'Near-duplicate categories',
          severity: ISSUE_SEVERITIES.POTENTIAL_SEMANTIC_INCONSISTENCY,
          confidence: 'Medium (Requires domain confirmation)',
          affectedColumns: [col.displayName],
          affectedRowIds,
          affectedCount: affectedRowIds.length,
          finding: `Column "${col.displayName}" contains ${aliasSuggestions.length} candidate category abbreviation(s) or near-duplicates.`,
          evidence: aliasSuggestions.map(s => `"${s.variant}" (${s.variantCount}) ↔ "${s.canonical}" (${s.canonicalCount}) [${s.reason}]`).join('; '),
          explanation: {
            simple: `Some categories in "${col.displayName}" look like abbreviations or typos for the same thing.`,
            standard: `Abbreviations (such as "NY" vs "New York") or minor edit-distance variants may represent the same category, but require explicit review before merging.`,
            technical: `Candidate lexical/alias equivalence detected on "${col.displayName}". Automatic merging without approval is prohibited; review mapping table.`
          },
          suggestedRemedy: {
            operationType: 'MAP_CATEGORIES',
            label: `Apply reviewed category mapping on "${col.displayName}"`,
            params: { colId: col.id, columnName: col.displayName, mapping }
          },
          consequences: 'Consolidates mapped source variants into canonical category labels.',
          riskClassification: RISK_LEVELS.MEDIUM,
          previewAvailable: true,
          resolutionState: 'OPEN'
        });
      }
    }

    // 9. Leading-Zero Identifier Protection Notice
    if (cp.leadingZeroCount > 0) {
      issues.push({
        id: nextId('id_zero'),
        category: 'Suspicious identifiers',
        severity: ISSUE_SEVERITIES.INFORMATIONAL_FINDING,
        confidence: 'High',
        affectedColumns: [col.displayName],
        affectedRowIds: [],
        affectedCount: cp.leadingZeroCount,
        finding: `Column "${col.displayName}" contains ${cp.leadingZeroCount} leading-zero value(s) (e.g., "${cp.topValues[0]?.value}") protected as Identifier text.`,
        evidence: `${cp.leadingZeroCount} values match /^0\\d+$/. Classified as "${cp.semanticType}" so leading zeros are never stripped and meaningless arithmetic means are blocked.`,
        explanation: {
          simple: `Codes starting with zero (like postal code 00123) in "${col.displayName}" are safely kept as text so the zeros aren't erased.`,
          standard: `Numeric-looking identifiers (postal codes, account IDs) are not quantitative measurements. DataMend Lab preserves leading zeros and prevents calculating meaningless averages.`,
          technical: `Leading-zero lexical pattern /^0\\d+$/ matched ${cp.leadingZeroCount} cells in ${col.id}. Semantic type locked to IDENTIFIER.`
        },
        suggestedRemedy: null,
        consequences: 'Preserves identifier integrity across cleaning and export.',
        riskClassification: RISK_LEVELS.READ_ONLY,
        previewAvailable: false,
        resolutionState: 'OPEN'
      });
    }

    // 10. Ambiguous Dates (e.g. 03/04/2026)
    if (cp.ambiguousDateCount > 0) {
      const affectedRowIds = [];
      const examples = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (cell?.validationState === 'AMBIGUOUS_DATE') {
          affectedRowIds.push(row._rowId);
          if (examples.length < 3) examples.push(cell.raw);
        }
      }
      issues.push({
        id: nextId('date_ambig'),
        category: 'Ambiguous dates',
        severity: ISSUE_SEVERITIES.POTENTIAL_SEMANTIC_INCONSISTENCY,
        confidence: 'High (Requires explicit format convention)',
        affectedColumns: [col.displayName],
        affectedRowIds,
        affectedCount: cp.ambiguousDateCount,
        finding: `Column "${col.displayName}" has ${cp.ambiguousDateCount} ambiguous date string(s) (e.g., ${examples.join(', ')}) where both month and day are ≤ 12.`,
        evidence: `${cp.ambiguousDateCount} cells match slash/dash dates with both first and second components in [1..12]. Could be MM/DD/YYYY or DD/MM/YYYY.`,
        explanation: {
          simple: `A date like ${examples[0] || '03/04/2026'} could mean March 4 or April 3. DataMend Lab will not guess until you pick US (MM/DD/YYYY) or International (DD/MM/YYYY) format.`,
          standard: `Dates with day and month ≤ 12 are ambiguous without an explicit locale convention. Silent coercion can shift timestamps by months and corrupt time-series analyses.`,
          technical: `Date format ambiguity in ${col.id} (${cp.ambiguousDateCount} cells). Select explicit format convention (MDY vs DMY) to normalize to ISO 8601 YYYY-MM-DD.`
        },
        suggestedRemedy: {
          operationType: 'PARSE_DATES',
          label: `Parse "${col.displayName}" as US (MM/DD/YYYY) → ISO 8601`,
          params: { colId: col.id, columnName: col.displayName, dateFormat: 'MDY' }
        },
        consequences: 'Converts slash/dash dates into unambiguous ISO 8601 (YYYY-MM-DD) strings.',
        riskClassification: RISK_LEVELS.MEDIUM,
        previewAvailable: true,
        resolutionState: 'OPEN'
      });
    }

    // 11. Invalid Parse / Mixed Types
    if (cp.invalidParseCount > 0) {
      const affectedRowIds = [];
      const examples = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (cell && (cell.missingState === MISSING_STATES.INVALID_PARSE || cell.missingState === MISSING_STATES.NONFINITE)) {
          affectedRowIds.push(row._rowId);
          if (examples.length < 4) examples.push(`"${cell.raw}" (${cell.validationState})`);
        }
      }
      issues.push({
        id: nextId('parse_err'),
        category: 'Invalid types',
        severity: ISSUE_SEVERITIES.CONFIRMED_PARSE_ERROR,
        confidence: 'High',
        affectedColumns: [col.displayName],
        affectedRowIds,
        affectedCount: cp.invalidParseCount,
        finding: `Column "${col.displayName}" (${cp.semanticType}) has ${cp.invalidParseCount} unparseable or non-finite value(s).`,
        evidence: `Examples: ${examples.join(', ')}. Original values are preserved rather than silently coerced to null.`,
        explanation: {
          simple: `Some cells in "${col.displayName}" contain text or symbols that don't match its data type (${cp.semanticType}).`,
          standard: `Type validation identified ${cp.invalidParseCount} observation(s) in "${col.displayName}" that failed parsing under current conventions. Silent coercion to missing is prohibited.`,
          technical: `Cells in ${col.id} have missingState=INVALID_PARSE/NONFINITE. Inspect raw tokens or clean unit/currency suffixes before type conversion.`
        },
        suggestedRemedy: {
          operationType: 'CLEAN_NUMERIC_TEXT',
          label: `Strip currency/unit text and re-parse "${col.displayName}"`,
          params: { colId: col.id, columnName: col.displayName }
        },
        consequences: 'Extracts valid numbers where possible or flags remaining unparseable tokens.',
        riskClassification: RISK_LEVELS.MEDIUM,
        previewAvailable: true,
        resolutionState: 'OPEN'
      });
    }

    // 12. Inconsistent Measurement Units in Raw Strings (e.g. "12 kg", "25 lbs", "180 cm", "70 in")
    const unitCheck = detectEmbeddedUnits(dataset, col);
    if (unitCheck.hasMixedUnits) {
      issues.push({
        id: nextId('units'),
        category: 'Inconsistent measurement units',
        severity: ISSUE_SEVERITIES.POTENTIAL_SEMANTIC_INCONSISTENCY,
        confidence: 'High',
        affectedColumns: [col.displayName],
        affectedRowIds: unitCheck.affectedRowIds,
        affectedCount: unitCheck.affectedRowIds.length,
        finding: `Column "${col.displayName}" contains values with mixed embedded measurement units (${unitCheck.unitsFound.join(', ')}).`,
        evidence: `Detected units: ${unitCheck.examples.join(', ')}.`,
        explanation: {
          simple: `Measurements in "${col.displayName}" mix different units (like ${unitCheck.unitsFound.join(' and ')}). Stripping the unit letters without converting the numbers would make the data wrong!`,
          standard: `Combining numbers measured on different physical scales without explicit unit conversion introduces severe measurement error.`,
          technical: `Heterogeneous unit suffixes (${unitCheck.unitsFound.join(', ')}) detected in ${col.id}. Use validated unit registry conversion to standardize to "${unitCheck.targetUnit}".`
        },
        suggestedRemedy: {
          operationType: 'CONVERT_UNITS',
          label: `Convert mixed units in "${col.displayName}" to ${unitCheck.targetUnit}`,
          params: { colId: col.id, columnName: col.displayName, targetUnit: unitCheck.targetUnit }
        },
        consequences: `Multiplies values by exact physical conversion factors and sets column unit to ${unitCheck.targetUnit}.`,
        riskClassification: RISK_LEVELS.MEDIUM,
        previewAvailable: true,
        resolutionState: 'OPEN'
      });
    }

    // 13. Missing Values
    if (cp.missingCount > 0 && !cp.isEmptyColumn) {
      const affectedRowIds = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || cell.missingState !== MISSING_STATES.PRESENT) {
          affectedRowIds.push(row._rowId);
        }
      }
      const isQuant = cp.semanticType === SEMANTIC_TYPES.INTEGER || cp.semanticType === SEMANTIC_TYPES.DECIMAL;
      issues.push({
        id: nextId('missing'),
        category: 'Missing values',
        severity: ISSUE_SEVERITIES.POTENTIAL_SEMANTIC_INCONSISTENCY,
        confidence: 'High (Detection); Method-dependent (Remedy)',
        affectedColumns: [col.displayName],
        affectedRowIds,
        affectedCount: cp.missingCount,
        finding: `Column "${col.displayName}" has ${cp.missingCount} non-present observation(s) (${cp.missingPercentage.toFixed(1)}%).`,
        evidence: `Breakdown: Missing=${cp.missingCount - cp.notApplicableCount - cp.withheldCount - cp.emptyStringCount}, EmptyString=${cp.emptyStringCount}, NotApplicable=${cp.notApplicableCount}, Withheld=${cp.withheldCount}.`,
        explanation: {
          simple: `There are ${cp.missingCount} blank or missing entries in "${col.displayName}". You can leave them as missing, add a missingness flag, or fill them in carefully.`,
          standard: `Missing values may be Missing Completely at Random (MCAR), Missing at Random (MAR), or Missing Not at Random (MNAR). Mean/median imputation artificially reduces sample variance and distorts correlations.`,
          technical: `Missingness rate=${cp.missingPercentage.toFixed(2)}% on ${col.id}. Differentiate structural N/A (${cp.notApplicableCount}) and withheld (${cp.withheldCount}) from missing observations. Imputation requires explicit assumption disclosure.`
        },
        suggestedRemedy: {
          operationType: 'ADD_MISSINGNESS_INDICATOR',
          label: `Add missingness indicator column for "${col.displayName}" (non-destructive)`,
          params: { colId: col.id, columnName: col.displayName }
        },
        consequences: 'Creates a binary 0/1 indicator preserving missingness information without fabricating values.',
        riskClassification: isQuant ? RISK_LEVELS.LOW : RISK_LEVELS.LOW,
        previewAvailable: true,
        resolutionState: 'OPEN'
      });
    }

    // 14. Outliers & Extreme Observations (Tukey 1.5 IQR & Robust MAD Z-score)
    if (cp.numericStats && cp.numericStats.n >= 5 && cp.numericStats.iqr > 0) {
      const st = cp.numericStats;
      const lowerFence = st.q1 - 1.5 * st.iqr;
      const upperFence = st.q3 + 1.5 * st.iqr;
      const outlierRows = [];
      const outlierExamples = [];

      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (cell?.missingState === MISSING_STATES.PRESENT && typeof cell.parsed === 'number') {
          if (cell.parsed < lowerFence || cell.parsed > upperFence) {
            outlierRows.push(row._rowId);
            if (outlierExamples.length < 4) outlierExamples.push(`${cell.parsed} (${row._rowId})`);
          }
        }
      }

      if (outlierRows.length > 0) {
        issues.push({
          id: nextId('outlier'),
          category: 'Suspicious outliers',
          severity: ISSUE_SEVERITIES.SUSPICIOUS_STATISTICAL_OBSERVATION,
          confidence: 'Diagnostic Flag Only (Extreme values may be legitimate observations!)',
          affectedColumns: [col.displayName],
          affectedRowIds: outlierRows,
          affectedCount: outlierRows.length,
          finding: `Column "${col.displayName}" has ${outlierRows.length} observation(s) outside Tukey 1.5×IQR fences [${lowerFence.toFixed(2)}, ${upperFence.toFixed(2)}].`,
          evidence: `Flagged values: ${outlierExamples.join(', ')}. Median=${st.median.toFixed(2)}, IQR=${st.iqr.toFixed(2)}, MAD_σ=${st.madSigma.toFixed(2)}.`,
          explanation: {
            simple: `Values like ${outlierExamples[0]} in "${col.displayName}" are unusually far from the middle of the data. This does NOT mean they are mistakes—for example, a $500,000 salary can be completely real!`,
            standard: `Tukey's 1.5×IQR rule flags extreme tail values for inspection. Never automatically delete outliers merely because they cross a heuristic threshold; doing so biases variance downward and can invalidate regression inference.`,
            technical: `Observations exceed [Q1 - 1.5·IQR, Q3 + 1.5·IQR] = [${lowerFence.toFixed(4)}, ${upperFence.toFixed(4)}]. Recommended action is non-destructive diagnostic flagging or domain-verified error correction.`
          },
          suggestedRemedy: {
            operationType: 'FLAG_OUTLIERS',
            label: `Add non-destructive outlier diagnostic flag column for "${col.displayName}"`,
            params: { colId: col.id, columnName: col.displayName, method: 'tukey_iqr', multiplier: 1.5 }
          },
          consequences: 'Appends a boolean/label flag column without deleting or altering any observation.',
          riskClassification: RISK_LEVELS.LOW,
          previewAvailable: true,
          resolutionState: 'OPEN'
        });
      }
    }
  }

  return issues;
}

/**
 * Helper to detect common category aliases (e.g., NY / N.Y. / New York, CA / Calif. / California, Dept abbreviations, or small edit distance).
 */
function detectCategoryAliases(frequencies) {
  const KNOWN_ALIASES = {
    'ny': 'New York',
    'n.y.': 'New York',
    'new york': 'New York',
    'ca': 'California',
    'calif.': 'California',
    'california': 'California',
    'tx': 'Texas',
    'tex.': 'Texas',
    'texas': 'Texas',
    'uk': 'United Kingdom',
    'u.k.': 'United Kingdom',
    'usa': 'United States',
    'u.s.a.': 'United States',
    'u.s.': 'United States',
    'hr': 'Human Resources',
    'eng': 'Engineering',
    'engr': 'Engineering',
    'mktg': 'Marketing',
    'fin': 'Finance'
  };

  const suggestions = [];
  const entries = frequencies.map(f => ({
    value: String(f.value),
    trimmedLower: String(f.value).trim().toLowerCase(),
    count: f.count
  }));

  // Check known alias dictionary if canonical target is also present in column
  const byLower = new Map();
  for (const e of entries) {
    if (!byLower.has(e.trimmedLower)) byLower.set(e.trimmedLower, e);
  }

  for (const e of entries) {
    const canonicalName = KNOWN_ALIASES[e.trimmedLower];
    if (canonicalName) {
      const targetEntry = entries.find(
        cand => cand.trimmedLower === canonicalName.toLowerCase() && cand.value !== e.value
      );
      if (targetEntry) {
        suggestions.push({
          variant: e.value,
          variantCount: e.count,
          canonical: targetEntry.value,
          canonicalCount: targetEntry.count,
          reason: 'Standard abbreviation/alias match'
        });
      }
    }
  }

  // Also check punctuation/edit-distance-1 similarity for multi-character strings
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const high = entries[i]; // higher frequency
      const low = entries[j];
      if (high.trimmedLower === low.trimmedLower) continue; // handled by case/whitespace detector
      if (suggestions.some(s => s.variant === low.value)) continue;

      const stripPunctHigh = high.trimmedLower.replace(/[.\-_]/g, '');
      const stripPunctLow = low.trimmedLower.replace(/[.\-_]/g, '');
      if (stripPunctHigh.length >= 2 && stripPunctHigh === stripPunctLow) {
        suggestions.push({
          variant: low.value,
          variantCount: low.count,
          canonical: high.value,
          canonicalCount: high.count,
          reason: 'Punctuation variation'
        });
      } else if (
        high.trimmedLower.length >= 5 &&
        low.trimmedLower.length >= 5 &&
        editDistance(high.trimmedLower, low.trimmedLower) === 1
      ) {
        suggestions.push({
          variant: low.value,
          variantCount: low.count,
          canonical: high.value,
          canonicalCount: high.count,
          reason: 'Edit distance = 1 (typo candidate)'
        });
      }
    }
  }

  return suggestions;
}

/**
 * Helper to detect mixed measurement units embedded in cells (e.g. "70 kg" and "154 lbs").
 */
function detectEmbeddedUnits(dataset, col) {
  const UNIT_REGEX = /^([+\-]?\d+(?:\.\d+)?)\s*(kg|lbs?|lb|g|cm|mm|m|in|inch|inches|ft|°c|c|°f|f)$/i;
  const UNIT_FAMILIES = {
    kg: 'mass_kg', g: 'mass_kg', lb: 'mass_kg', lbs: 'mass_kg',
    cm: 'length_cm', mm: 'length_cm', m: 'length_cm', in: 'length_cm', inch: 'length_cm', inches: 'length_cm', ft: 'length_cm',
    c: 'temp_c', '°c': 'temp_c', f: 'temp_c', '°f': 'temp_c'
  };
  const TARGET_UNITS = {
    mass_kg: 'kg',
    length_cm: 'cm',
    temp_c: 'C'
  };

  const unitsSet = new Set();
  const familiesSet = new Set();
  const affectedRowIds = [];
  const examples = [];

  for (const row of dataset.rows) {
    const raw = String(row.cells[col.id]?.raw ?? '').trim();
    const m = UNIT_REGEX.exec(raw);
    if (m) {
      const unitStr = m[2].toLowerCase();
      unitsSet.add(unitStr);
      familiesSet.add(UNIT_FAMILIES[unitStr]);
      affectedRowIds.push(row._rowId);
      if (examples.length < 4) examples.push(raw);
    }
  }

  if (unitsSet.size >= 2 && familiesSet.size === 1) {
    const family = Array.from(familiesSet)[0];
    return {
      hasMixedUnits: true,
      unitsFound: Array.from(unitsSet),
      targetUnit: TARGET_UNITS[family],
      affectedRowIds,
      examples
    };
  }
  return { hasMixedUnits: false };
}
