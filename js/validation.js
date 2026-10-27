/**
 * DataMend Lab — Validation Rules, Quality Gates, Scorecard, and Before/After Comparison Engine
 * Implements Parts 21, 22, and 24:
 * - 16 Rule families (nonmissing, data_type, min_value, max_value, inclusive_range, allowed_categories,
 *   uniqueness, composite_uniqueness, string_length, pattern, date_range, chronological_order,
 *   cross_field, conditional_requirement, referential_integrity, custom_formula)
 * - Quality Gates that block export if violated, explaining exact failed conditions
 * - 7-Dimension Data-Quality Scorecard (Completeness, Type Validity, Uniqueness, Consistency,
 *   Constraint Satisfaction, Structural Integrity, Parsing Validity) with transparent formula disclosure
 * - Before/After Comparison Engine computing exact cell-level diffs, structural changes, and metric shifts.
 */

import { MISSING_STATES, SEMANTIC_TYPES } from './data-model.js';
import { resolveColumn, validateSafeRegex, evaluateSafeExpression } from './transforms.js';
import { profileDataset } from './profiler.js';

export const VALIDATION_RULE_TYPES = Object.freeze({
  NONMISSING: 'nonmissing',
  DATA_TYPE: 'data_type',
  MIN_VALUE: 'min_value',
  MAX_VALUE: 'max_value',
  INCLUSIVE_RANGE: 'inclusive_range',
  ALLOWED_CATEGORIES: 'allowed_categories',
  UNIQUENESS: 'uniqueness',
  COMPOSITE_UNIQUENESS: 'composite_uniqueness',
  STRING_LENGTH: 'string_length',
  PATTERN: 'pattern',
  DATE_RANGE: 'date_range',
  CHRONOLOGICAL_ORDER: 'chronological_order',
  CROSS_FIELD: 'cross_field',
  CONDITIONAL_REQUIREMENT: 'conditional_requirement',
  REFERENTIAL_INTEGRITY: 'referential_integrity',
  CUSTOM_FORMULA: 'custom_formula'
});

/**
 * Evaluates a single validation rule against a dataset.
 */
export function evaluateValidationRule(dataset, rule, secondaryDatasets = {}) {
  const totalRows = dataset.rows.length;
  let tested = 0;
  let passing = 0;
  let failing = 0;
  let inapplicable = 0;
  const failingRowIds = [];
  const failureExamples = [];

  const col = rule.column ? resolveColumn(dataset, rule.column) : null;

  if (rule.type === VALIDATION_RULE_TYPES.UNIQUENESS && col) {
    const counts = new Map();
    for (const row of dataset.rows) {
      const c = row.cells[col.id];
      if (!c || c.missingState !== MISSING_STATES.PRESENT) continue;
      const k = String(c.parsed ?? c.raw);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const row of dataset.rows) {
      const c = row.cells[col.id];
      if (!c || c.missingState !== MISSING_STATES.PRESENT) {
        inapplicable++;
        continue;
      }
      tested++;
      const k = String(c.parsed ?? c.raw);
      if ((counts.get(k) || 0) > 1) {
        failing++;
        failingRowIds.push(row._rowId);
        if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: duplicate "${k}"`);
      } else {
        passing++;
      }
    }
  } else if (rule.type === VALIDATION_RULE_TYPES.COMPOSITE_UNIQUENESS) {
    const cols = (rule.columns || []).map(c => resolveColumn(dataset, c)).filter(Boolean);
    const counts = new Map();
    for (const row of dataset.rows) {
      const k = cols.map(c => String(row.cells[c.id]?.parsed ?? '§NULL')).join('||');
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const row of dataset.rows) {
      tested++;
      const k = cols.map(c => String(row.cells[c.id]?.parsed ?? '§NULL')).join('||');
      if ((counts.get(k) || 0) > 1) {
        failing++;
        failingRowIds.push(row._rowId);
        if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: composite key [${k}]`);
      } else {
        passing++;
      }
    }
  } else if (rule.type === VALIDATION_RULE_TYPES.CHRONOLOGICAL_ORDER && col) {
    let prevDate = null;
    for (const row of dataset.rows) {
      const c = row.cells[col.id];
      if (!c || c.missingState !== MISSING_STATES.PRESENT) {
        inapplicable++;
        continue;
      }
      tested++;
      const cur = String(c.parsed);
      if (prevDate !== null && cur < prevDate) {
        failing++;
        failingRowIds.push(row._rowId);
        if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: "${cur}" < previous "${prevDate}"`);
      } else {
        passing++;
      }
      prevDate = cur;
    }
  } else {
    // Row-by-row rules
    let rx = null;
    if (rule.type === VALIDATION_RULE_TYPES.PATTERN && rule.pattern) {
      const check = validateSafeRegex(rule.pattern, '');
      if (check.valid) rx = check.regex;
    }

    let refSet = null;
    if (rule.type === VALIDATION_RULE_TYPES.REFERENTIAL_INTEGRITY && rule.referenceValues) {
      refSet = new Set(rule.referenceValues.map(String));
    } else if (rule.type === VALIDATION_RULE_TYPES.REFERENTIAL_INTEGRITY && rule.referenceDatasetId) {
      const refDs = secondaryDatasets[rule.referenceDatasetId];
      const refCol = refDs ? resolveColumn(refDs, rule.referenceColumn) : null;
      if (refDs && refCol) {
        refSet = new Set(
          refDs.rows
            .map(r => r.cells[refCol.id])
            .filter(c => c?.missingState === MISSING_STATES.PRESENT)
            .map(c => String(c.parsed))
        );
      }
    }

    for (const row of dataset.rows) {
      const c = col ? row.cells[col.id] : null;

      if (rule.type === VALIDATION_RULE_TYPES.NONMISSING) {
        tested++;
        if (c && c.missingState === MISSING_STATES.PRESENT && String(c.raw).trim() !== '') {
          passing++;
        } else {
          failing++;
          failingRowIds.push(row._rowId);
          if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: missing`);
        }
        continue;
      }

      if (rule.type === VALIDATION_RULE_TYPES.DATA_TYPE) {
        if (!c || (c.missingState !== MISSING_STATES.PRESENT && c.missingState !== MISSING_STATES.INVALID_PARSE && c.missingState !== MISSING_STATES.NONFINITE)) {
          inapplicable++;
          continue;
        }
        tested++;
        if (c.missingState === MISSING_STATES.PRESENT && c.validationState === 'VALID') {
          passing++;
        } else {
          failing++;
          failingRowIds.push(row._rowId);
          if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: "${c?.raw}" (${c?.validationState})`);
        }
        continue;
      }

      if (rule.type === VALIDATION_RULE_TYPES.CONDITIONAL_REQUIREMENT) {
        const condCol = resolveColumn(dataset, rule.ifColumn);
        const condCell = condCol ? row.cells[condCol.id] : null;
        if (!condCell || String(condCell.parsed) !== String(rule.ifEquals)) {
          inapplicable++;
          continue;
        }
        tested++;
        if (c && c.missingState === MISSING_STATES.PRESENT) {
          passing++;
        } else {
          failing++;
          failingRowIds.push(row._rowId);
          if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: required when ${rule.ifColumn}==${rule.ifEquals}`);
        }
        continue;
      }

      if (rule.type === VALIDATION_RULE_TYPES.CROSS_FIELD || rule.type === VALIDATION_RULE_TYPES.CUSTOM_FORMULA) {
        tested++;
        const ctx = {};
        for (const dc of dataset.columns) {
          ctx[dc.displayName] = row.cells[dc.id]?.missingState === MISSING_STATES.PRESENT
            ? row.cells[dc.id].parsed
            : null;
        }
        const ok = Boolean(evaluateSafeExpression(rule.expression || 'true', ctx));
        if (ok) passing++;
        else {
          failing++;
          failingRowIds.push(row._rowId);
          if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: failed (${rule.expression})`);
        }
        continue;
      }

      // Remaining rules apply to present values on `col`
      if (!c || c.missingState !== MISSING_STATES.PRESENT) {
        inapplicable++;
        continue;
      }
      tested++;
      const val = c.parsed;
      let ok = true;

      if (rule.type === VALIDATION_RULE_TYPES.MIN_VALUE) {
        ok = typeof val === 'number' && val >= Number(rule.min);
      } else if (rule.type === VALIDATION_RULE_TYPES.MAX_VALUE) {
        ok = typeof val === 'number' && val <= Number(rule.max);
      } else if (rule.type === VALIDATION_RULE_TYPES.INCLUSIVE_RANGE) {
        ok = typeof val === 'number' && val >= Number(rule.min) && val <= Number(rule.max);
      } else if (rule.type === VALIDATION_RULE_TYPES.ALLOWED_CATEGORIES) {
        const allowed = new Set((rule.allowed || []).map(s => String(s).trim()));
        ok = allowed.has(String(val).trim());
      } else if (rule.type === VALIDATION_RULE_TYPES.STRING_LENGTH) {
        const len = String(val).length;
        const minL = rule.minLength !== undefined ? Number(rule.minLength) : 0;
        const maxL = rule.maxLength !== undefined ? Number(rule.maxLength) : Infinity;
        ok = len >= minL && len <= maxL;
      } else if (rule.type === VALIDATION_RULE_TYPES.PATTERN) {
        ok = rx ? rx.test(String(val)) : false;
      } else if (rule.type === VALIDATION_RULE_TYPES.DATE_RANGE) {
        const s = String(val);
        ok = (!rule.minDate || s >= rule.minDate) && (!rule.maxDate || s <= rule.maxDate);
      } else if (rule.type === VALIDATION_RULE_TYPES.REFERENTIAL_INTEGRITY) {
        ok = refSet ? refSet.has(String(val)) : true;
      }

      if (ok) passing++;
      else {
        failing++;
        failingRowIds.push(row._rowId);
        if (failureExamples.length < 5) failureExamples.push(`${row._rowId}: "${val}"`);
      }
    }
  }

  return {
    ruleId: rule.id,
    name: rule.name || `${rule.type} on ${rule.column || 'dataset'}`,
    type: rule.type,
    column: rule.column || null,
    isQualityGate: Boolean(rule.isQualityGate),
    enabled: rule.enabled !== false,
    status: failing === 0 ? 'PASS' : 'FAIL',
    totalRows,
    tested,
    passing,
    failing,
    inapplicable,
    failingRowIds,
    failureExamples,
    explanation: failing === 0
      ? `All ${tested} applicable observation(s) satisfied "${rule.name || rule.type}".`
      : `${failing} of ${tested} tested observation(s) violated "${rule.name || rule.type}".`,
    suggestedInvestigation: failing > 0
      ? `Filter or inspect rows [${failingRowIds.slice(0, 5).join(', ')}] in Cleaning Studio.`
      : null
  };
}

/**
 * Evaluates all active validation rules and Quality Gates on a dataset.
 */
export function runValidationSuite(dataset, secondaryDatasets = {}) {
  const activeRules = (dataset.validationRules || []).filter(r => r.enabled !== false);
  const results = activeRules.map(rule => evaluateValidationRule(dataset, rule, secondaryDatasets));
  const failedGates = results.filter(r => r.isQualityGate && r.status === 'FAIL');

  return {
    totalRules: activeRules.length,
    passingRules: results.filter(r => r.status === 'PASS').length,
    failingRules: results.filter(r => r.status === 'FAIL').length,
    exportBlockedByGate: failedGates.length > 0,
    failedGates,
    results,
    disclaimer: 'Passing all user-defined validation constraints verifies formal schema compliance, not complete real-world empirical accuracy.'
  };
}

/**
 * Computes the 7-Dimension Data-Quality Scorecard (Part 22).
 * Never produces an opaque single score without disclosing components and underlying counts.
 */
export function computeQualityScorecard(dataset, profile = null, validationReport = null) {
  const prof = profile || profileDataset(dataset);
  const valRep = validationReport || runValidationSuite(dataset);

  const totalCells = Math.max(1, prof.totalCells);
  const totalRows = Math.max(1, prof.rowCount);

  // 1. Completeness: % of cells with PRESENT values
  const completenessPct = prof.overallCompleteness;

  // 2. Type & Parsing Validity: % of non-missing cells that parsed cleanly without INVALID_PARSE or AMBIGUOUS_DATE
  const nonMissingOrInvalid = Math.max(1, prof.totalCells - prof.totalMissingCells + prof.totalInvalidCells);
  const badParseTotal = prof.totalInvalidCells + prof.totalAmbiguousCells;
  const parsingValidityPct = Math.max(0, ((nonMissingOrInvalid - badParseTotal) / nonMissingOrInvalid) * 100);

  // 3. Uniqueness (Record-level non-duplication): % of rows that are not redundant exact duplicates
  const uniquenessPct = ((totalRows - prof.exactDuplicateRowCount) / totalRows) * 100;

  // 4. Superficial Consistency: % of cells free from leading/trailing whitespace & case split clusters
  let superficialAffectedCells = 0;
  for (const cp of prof.columnProfiles) {
    superficialAffectedCells += cp.whitespacePatterns.leading + cp.whitespacePatterns.trailing + cp.whitespacePatterns.repeatedInternal;
    for (const cl of cp.superficialClusters) {
      // Count minority variants
      const sortedCounts = cl.variants.map(v => v.count).sort((a, b) => b - a);
      for (let i = 1; i < sortedCounts.length; i++) superficialAffectedCells += sortedCounts[i];
    }
  }
  const consistencyPct = Math.max(0, ((totalCells - Math.min(totalCells, superficialAffectedCells)) / totalCells) * 100);

  // 5. Constraint Satisfaction: % of rule checks passing
  let totalRuleChecks = 0;
  let passingRuleChecks = 0;
  for (const r of valRep.results) {
    totalRuleChecks += r.tested;
    passingRuleChecks += r.passing;
  }
  const constraintPct = totalRuleChecks > 0 ? (passingRuleChecks / totalRuleChecks) * 100 : 100;

  // 6. Structural Integrity: absence of malformed row widths, duplicate headers, or empty columns
  const emptyCols = prof.columnProfiles.filter(c => c.isEmptyColumn).length;
  const malformedWarnings = (dataset.sourceMetadata?.parsingWarnings || []).filter(w => w.code.includes('MALFORMED')).length;
  const structuralPenalties = emptyCols * 5 + malformedWarnings * 2;
  const structuralPct = Math.max(0, 100 - structuralPenalties);

  const dimensions = [
    {
      id: 'completeness',
      name: 'Completeness',
      percentage: Number(completenessPct.toFixed(2)),
      numerator: prof.totalCells - prof.totalMissingCells,
      denominator: prof.totalCells,
      unit: 'present cells',
      formula: '(Present Cells / Total Cells) × 100'
    },
    {
      id: 'parsing_validity',
      name: 'Type & Parsing Validity',
      percentage: Number(parsingValidityPct.toFixed(2)),
      numerator: nonMissingOrInvalid - badParseTotal,
      denominator: nonMissingOrInvalid,
      unit: 'valid parsed cells',
      formula: '(Validly Parsed Non-Empty Cells / Total Non-Empty Cells) × 100'
    },
    {
      id: 'uniqueness',
      name: 'Record Uniqueness',
      percentage: Number(uniquenessPct.toFixed(2)),
      numerator: prof.rowCount - prof.exactDuplicateRowCount,
      denominator: prof.rowCount,
      unit: 'distinct rows',
      formula: '((Total Rows - Exact Duplicate Rows) / Total Rows) × 100'
    },
    {
      id: 'consistency',
      name: 'Lexical & Category Consistency',
      percentage: Number(consistencyPct.toFixed(2)),
      numerator: prof.totalCells - Math.min(prof.totalCells, superficialAffectedCells),
      denominator: prof.totalCells,
      unit: 'consistent cells',
      formula: '((Total Cells - Whitespace/Case Variant Cells) / Total Cells) × 100'
    },
    {
      id: 'constraints',
      name: 'Constraint Satisfaction',
      percentage: Number(constraintPct.toFixed(2)),
      numerator: passingRuleChecks,
      denominator: totalRuleChecks,
      unit: 'rule evaluations',
      formula: totalRuleChecks > 0 ? '(Passing Rule Evaluations / Total Tested Evaluations) × 100' : 'No active constraints (100%)'
    },
    {
      id: 'structural',
      name: 'Structural Integrity',
      percentage: Number(structuralPct.toFixed(2)),
      numerator: prof.colCount - emptyCols,
      denominator: prof.colCount,
      unit: 'populated columns',
      formula: '100 - (5 × Empty Columns + 2 × Malformed Row Warnings)'
    }
  ];

  return {
    dimensions,
    rowCount: prof.rowCount,
    colCount: prof.colCount,
    missingCells: prof.totalMissingCells,
    invalidCells: prof.totalInvalidCells,
    ambiguousCells: prof.totalAmbiguousCells,
    duplicateRows: prof.exactDuplicateRowCount
  };
}

/**
 * Computes Before/After Comparison between Original Snapshot and Current Working State (Part 24).
 */
export function computeBeforeAfterComparison(dataset) {
  const origCols = dataset.originalSnapshot.columns;
  const origRows = dataset.originalSnapshot.rows;
  const curCols = dataset.columns;
  const curRows = dataset.rows;

  // Temp dataset object for profiling original snapshot
  const origTempDs = {
    id: dataset.id + '_orig',
    revision: 0,
    sourceMetadata: dataset.sourceMetadata,
    columns: origCols,
    rows: origRows,
    validationRules: dataset.validationRules
  };

  const beforeScorecard = computeQualityScorecard(origTempDs);
  const afterScorecard = computeQualityScorecard(dataset);

  const origColById = new Map(origCols.map(c => [c.id, c]));
  const curColById = new Map(curCols.map(c => [c.id, c]));

  const addedColumns = curCols.filter(c => !origColById.has(c.id)).map(c => c.displayName);
  const removedColumns = origCols.filter(c => !curColById.has(c.id)).map(c => c.displayName);
  const renamedColumns = [];
  for (const c of curCols) {
    if (origColById.has(c.id) && origColById.get(c.id).displayName !== c.displayName) {
      renamedColumns.push({ from: origColById.get(c.id).displayName, to: c.displayName });
    }
  }

  const origRowById = new Map(origRows.map(r => [r._rowId, r]));
  const curRowById = new Map(curRows.map(r => [r._rowId, r]));

  const removedRowIds = origRows.filter(r => !curRowById.has(r._rowId)).map(r => r._rowId);
  const addedRowIds = curRows.filter(r => !origRowById.has(r._rowId)).map(r => r._rowId);

  // Check if observational unit changed (e.g. unpivot, pivot, aggregate, join)
  const observationalUnitChanged = addedRowIds.length > 0 && removedRowIds.length === origRows.length;

  const cellDiffs = [];
  let totalChangedCells = 0;

  if (!observationalUnitChanged) {
    const sharedCols = curCols.filter(c => origColById.has(c.id));
    for (const curRow of curRows) {
      const origRow = origRowById.get(curRow._rowId);
      if (!origRow) continue;
      for (const col of sharedCols) {
        const cBefore = origRow.cells[col.id];
        const cAfter = curRow.cells[col.id];
        const rawBefore = String(cBefore?.raw ?? '');
        const rawAfter = String(cAfter?.raw ?? '');
        const fmtBefore = String(cBefore?.formatted ?? '');
        const fmtAfter = String(cAfter?.formatted ?? '');
        if (rawBefore !== rawAfter || fmtBefore !== fmtAfter) {
          totalChangedCells++;
          if (cellDiffs.length < 200) {
            cellDiffs.push({
              rowId: curRow._rowId,
              colId: col.id,
              columnName: col.displayName,
              beforeRaw: rawBefore,
              afterRaw: rawAfter,
              beforeFormatted: fmtBefore,
              afterFormatted: fmtAfter,
              isImputed: Boolean(cAfter?.isImputed)
            });
          }
        }
      }
    }
  }

  return {
    observationalUnitChanged,
    rowsBefore: origRows.length,
    rowsAfter: curRows.length,
    colsBefore: origCols.length,
    colsAfter: curCols.length,
    addedColumns,
    removedColumns,
    renamedColumns,
    removedRowCount: removedRowIds.length,
    addedRowCount: addedRowIds.length,
    removedRowIds: removedRowIds.slice(0, 50),
    totalChangedCells,
    cellDiffs,
    beforeScorecard,
    afterScorecard
  };
}
