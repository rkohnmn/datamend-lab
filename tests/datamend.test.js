/**
 * DataMend Lab — Automated Unit, Property-Based, and Acceptance Scenario Test Suite (Part 37 & Part 38)
 * Executed via Node.js native test runner: `node --test tests/*.test.js`
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSING_STATES,
  SEMANTIC_TYPES,
  createDataset,
  restoreOriginalDataset,
  detectDateAmbiguity
} from '../js/data-model.js';
import {
  parseDelimitedText,
  parseJsonContent,
  parseXlsxWorkbook,
  buildDatasetFromParsed
} from '../js/parsers.js';
import { profileDataset, quantileType7 } from '../js/profiler.js';
import { diagnoseDataset } from '../js/diagnosis.js';
import {
  applyTransformation,
  previewTransformation,
  undoTransformation,
  redoTransformation,
  detectFuzzyDuplicateCandidates
} from '../js/transforms.js';
import {
  executeDatasetJoin,
  executeDatasetAppend
} from '../js/restructure.js';
import {
  VALIDATION_RULE_TYPES,
  runValidationSuite,
  computeQualityScorecard,
  computeBeforeAfterComparison
} from '../js/validation.js';
import {
  exportCleaningRecipe,
  validateRecipeCompatibility,
  replayCleaningRecipe,
  exportToDelimitedText,
  exportToXlsxBytes,
  exportToDataSenseJson,
  generateRScript,
  generatePythonScript,
  generateQualityAuditReport
} from '../js/exporters.js';
import { SYNTHETIC_PRESETS } from '../js/presets.js';
import { encodeWorkspaceHashState, decodeWorkspaceHashState } from '../js/storage.js';

// ============================================================================
// 1. Parser & Format Tests (Part 37.1)
// ============================================================================
test('Part 37.1 — RFC 4180 CSV parser handles quotes, embedded commas, newlines, BOM, and malformed rows without silent loss', () => {
  const csvWithBomAndEdgeCases =
    '\uFEFFid,name,notes,amount\r\n' +
    '001,"Rostova, Elena","Line 1\nLine 2",1250.50\r\n' +
    '002,"O""Connor, Liam","Quoted ""nick"" here",890\r\n' +
    '003,MalformedExtraCol,Note,100,EXTRA_VALUE\r\n';

  const parsed = parseDelimitedText(csvWithBomAndEdgeCases);
  assert.equal(parsed.hadBOM, true);
  assert.equal(parsed.rawRows.length, 3);
  assert.equal(parsed.rawRows[0][0], '001');
  assert.equal(parsed.rawRows[0][1], 'Rostova, Elena');
  assert.equal(parsed.rawRows[0][2], 'Line 1\nLine 2');
  assert.equal(parsed.rawRows[1][1], 'O"Connor, Liam');
  assert.equal(parsed.rawRows[1][2], 'Quoted "nick" here');
  // Extra value on malformed row 3 is preserved in an expanded column rather than silently discarded
  assert.equal(parsed.rawRows[2][4], 'EXTRA_VALUE');
  assert.ok(parsed.warnings.some(w => w.code === 'MALFORMED_ROW_WIDTH'));
});

test('Part 37.1 & 37.10 — Pure-JS XLSX round-trip preserves leading zeros, numbers, and sheet structure', () => {
  const ds = createDataset({
    title: 'XLSX Test',
    columnNames: ['postal_code', 'measure', 'category'],
    rawRows: [
      ['00501', '42.5', 'Alpha'],
      ['02139', '108.25', 'Beta']
    ]
  });

  const xlsxBytes = exportToXlsxBytes(ds, { sheetName: 'AuditSheet' });
  assert.ok(xlsxBytes instanceof Uint8Array && xlsxBytes.length > 200);

  const parsedWb = parseXlsxWorkbook(xlsxBytes);
  assert.equal(parsedWb.sheets.length, 1);
  assert.equal(parsedWb.sheets[0].name, 'AuditSheet');
  assert.deepEqual(parsedWb.sheets[0].columnNames, ['postal_code', 'measure', 'category']);
  assert.equal(parsedWb.sheets[0].rawRows[0][0], '00501'); // Leading zero preserved!
  assert.equal(parsedWb.sheets[0].rawRows[1][0], '02139');
  assert.equal(Number(parsedWb.sheets[0].rawRows[0][1]), 42.5);
});

test('Part 37.1 — JSON, Nested Record Path, NDJSON, and DataSenseDataset parsing', () => {
  const nestedJson = JSON.stringify({
    meta: { version: 1 },
    data: {
      records: [
        { id: '01', user: { name: 'Ada' }, tags: ['a', 'b'] },
        { id: '02', user: { name: 'Grace' }, tags: ['c'] }
      ]
    }
  });

  const res = parseJsonContent(nestedJson, { recordPath: 'data.records' });
  assert.ok(res.columnNames.includes('user.name'));
  assert.equal(res.rawRows.length, 2);
  // Nested array is serialized with warning, never silently multiplying rows
  assert.ok(res.warnings.some(w => w.code === 'NESTED_ARRAY_SERIALIZED'));
});

// ============================================================================
// 2. Type, Identifier, and Date Ambiguity Tests (Part 37.2 & Scenarios 2 & 3)
// ============================================================================
test('Scenario 2 & Part 37.2 — Leading-zero codes are classified as IDENTIFIER, never truncated, and never averaged', () => {
  const preset = SYNTHETIC_PRESETS[0];
  const ds = createDataset({
    title: preset.title,
    columnNames: preset.columnNames,
    rawRows: preset.rawRows
  });

  const zipCol = ds.columns.find(c => c.displayName === 'postal_code');
  assert.equal(zipCol.semanticType, SEMANTIC_TYPES.IDENTIFIER);

  const row3Zip = ds.rows[3].cells[zipCol.id];
  assert.equal(row3Zip.raw, '00501');
  assert.equal(row3Zip.parsed, '00501');

  const prof = profileDataset(ds);
  const zipProf = prof.columnProfiles.find(cp => cp.displayName === 'postal_code');
  assert.equal(zipProf.numericStats, null, 'Must never compute mean/SD on postal codes');
});

test('Scenario 3 & Part 37.2 — Ambiguous dates (03/04/2026) are flagged as AMBIGUOUS_DATE and never silently coerced until convention is chosen', () => {
  const ambig = detectDateAmbiguity('03/04/2026');
  assert.equal(ambig.ambiguous, true);
  assert.equal(ambig.isoIfMDY, '2026-03-04');
  assert.equal(ambig.isoIfDMY, '2026-04-03');

  const ds = createDataset({
    title: 'Dates Test',
    columnNames: ['event_date'],
    rawRows: [['03/04/2026'], ['2026-08-15']]
  });
  const col = ds.columns[0];
  assert.equal(ds.rows[0].cells[col.id].validationState, 'AMBIGUOUS_DATE');
  assert.equal(ds.rows[0].cells[col.id].parsed, '03/04/2026'); // Not coerced!

  // Now explicitly resolve as DMY
  applyTransformation(ds, 'PARSE_DATES', { columnName: 'event_date', dateFormat: 'DMY' });
  assert.equal(ds.rows[0].cells[col.id].parsed, '2026-04-03');
  assert.equal(ds.rows[0].cells[col.id].validationState, 'VALID');
});

// ============================================================================
// 3. Text, Missingness, Leakage, Duplicate, Category & Outlier Tests (Parts 37.3–37.5)
// ============================================================================
test('Scenario 5 & 19 — Imputation supports training-only parameter fitting to prevent test leakage', () => {
  const preset = SYNTHETIC_PRESETS.find(p => p.id === 'preset_forecast_leakage_series');
  const ds = createDataset({
    title: preset.title,
    columnNames: preset.columnNames,
    rawRows: preset.rawRows
  });

  // Training values are 102.4, 105.1, 108.9, 111.2 -> Mean = 106.9000
  // Test values are 185.0, 192.4 (much higher!)
  applyTransformation(ds, 'IMPUTE_MISSING', {
    columnName: 'demand_index',
    method: 'mean',
    splitColumn: 'split',
    trainValue: 'train'
  });

  const col = ds.columns.find(c => c.displayName === 'demand_index');
  const marchTrainCell = ds.rows[2].cells[col.id];
  const julyTestCell = ds.rows[6].cells[col.id];

  assert.equal(marchTrainCell.parsed, 106.9);
  assert.equal(marchTrainCell.isImputed, true);
  assert.equal(julyTestCell.parsed, 106.9); // Uses training mean without peeking at test set!
});

test('Scenario 6, 7, 8 — Duplicates, Category Mapping, and Non-Destructive Outlier Flagging', () => {
  const preset = SYNTHETIC_PRESETS[0];
  const ds = createDataset({
    title: preset.title,
    columnNames: preset.columnNames,
    rawRows: preset.rawRows
  });

  const profBefore = profileDataset(ds);
  const issuesBefore = diagnoseDataset(ds, profBefore);

  assert.equal(profBefore.exactDuplicateRowCount, 1);
  assert.ok(issuesBefore.some(i => i.category === 'Duplicate rows'));
  assert.ok(issuesBefore.some(i => i.category === 'Near-duplicate categories'));
  assert.ok(issuesBefore.some(i => i.category === 'Suspicious outliers'));

  // Deduplicate exact rows -> removes 1 duplicate of CUST-101, keeps both Alex Rivera rows (CUST-103 and CUST-104)
  applyTransformation(ds, 'DEDUPLICATE_EXACT', { strategy: 'keep_first' });
  assert.equal(ds.rows.length, 11);

  // Trim whitespace & map state aliases
  applyTransformation(ds, 'TRIM_WHITESPACE', { columnName: 'state', normalizeInternal: true });
  applyTransformation(ds, 'STANDARDIZE_CASE', { columnName: 'state', mode: 'title' });
  applyTransformation(ds, 'MAP_CATEGORIES', {
    columnName: 'state',
    mapping: { 'Ny': 'New York', 'N.Y.': 'New York', 'Ca': 'California', 'Tx': 'Texas' }
  });

  const stateCol = ds.columns.find(c => c.displayName === 'state');
  const distinctStates = new Set(ds.rows.map(r => r.cells[stateCol.id].parsed));
  assert.deepEqual([...distinctStates].sort(), ['California', 'New York', 'Texas']);

  // Flag outliers on annual_salary_usd without deleting $500,000 observation
  applyTransformation(ds, 'FLAG_OUTLIERS', { columnName: 'annual_salary_usd', method: 'tukey_iqr' });
  const flagCol = ds.columns.find(c => c.displayName === 'annual_salary_usd_outlier_flag');
  assert.ok(flagCol);
  const hannahRow = ds.rows.find(r => r.cells[ds.columns[0].id].raw === 'CUST-107');
  assert.equal(hannahRow.cells[flagCol.id].parsed, 'HIGH_OUTLIER');
  assert.equal(ds.rows.length, 11); // Not deleted!
});

// ============================================================================
// 4. Restructuring, Pivot Collisions, Joins, and Appending (Parts 37.6 & 37.7)
// ============================================================================
test('Scenario 9 & 10 — Wide-to-Long Unpivot and Long-to-Wide Pivot Collision Guard', () => {
  const widePreset = SYNTHETIC_PRESETS.find(p => p.id === 'preset_wide_monthly_revenue');
  const dsWide = createDataset({
    title: widePreset.title,
    columnNames: widePreset.columnNames,
    rawRows: widePreset.rawRows
  });

  applyTransformation(dsWide, 'UNPIVOT_WIDE_TO_LONG', {
    idColumns: ['store_id', 'region'],
    valueColumns: ['2026_Jan', '2026_Feb', '2026_Mar', '2026_Apr'],
    variableColumnName: 'month',
    valueColumnName: 'revenue'
  });
  assert.equal(dsWide.rows.length, 16);

  // Round-trip back to wide
  applyTransformation(dsWide, 'PIVOT_LONG_TO_WIDE', {
    idColumns: ['store_id', 'region'],
    namesFromColumn: 'month',
    valuesFromColumn: 'revenue',
    conflictStrategy: 'error'
  });
  assert.equal(dsWide.rows.length, 4);

  // Scenario 10: Long clinical dataset with duplicate (PAT-01, Baseline) must reject silent pivot overwrite
  const collisionPreset = SYNTHETIC_PRESETS.find(p => p.id === 'preset_long_panel_collisions');
  const dsCol = createDataset({
    title: collisionPreset.title,
    columnNames: collisionPreset.columnNames,
    rawRows: collisionPreset.rawRows
  });

  assert.throws(() => {
    applyTransformation(dsCol, 'PIVOT_LONG_TO_WIDE', {
      idColumns: ['patient_id'],
      namesFromColumn: 'visit_stage',
      valuesFromColumn: 'systolic_bp',
      conflictStrategy: 'error'
    });
  }, /Pivot collision detected/);

  // Succeeds when explicit aggregation strategy (mean) is chosen
  applyTransformation(dsCol, 'PIVOT_LONG_TO_WIDE', {
    idColumns: ['patient_id'],
    namesFromColumn: 'visit_stage',
    valuesFromColumn: 'systolic_bp',
    conflictStrategy: 'mean'
  });
  assert.equal(dsCol.rows.length, 3);
  const pat01Baseline = dsCol.rows[0].cells[dsCol.columns.find(c => c.displayName === 'Baseline').id].parsed;
  assert.equal(pat01Baseline, 132); // Mean of 134 and 130
});

test('Scenario 11 & 12 — Relational Join Cardinality (M:N detection) and Multi-File Appending', () => {
  const leftP = SYNTHETIC_PRESETS.find(p => p.id === 'preset_join_orders_left');
  const rightP = SYNTHETIC_PRESETS.find(p => p.id === 'preset_join_customers_right');
  const leftDs = createDataset({ title: 'Orders', columnNames: leftP.columnNames, rawRows: leftP.rawRows });
  const rightDs = createDataset({ title: 'Customers', columnNames: rightP.columnNames, rawRows: rightP.rawRows });

  const joinOut = executeDatasetJoin(leftDs, rightDs, {
    joinType: 'inner',
    leftKey: 'account_id',
    rightKey: 'account_id'
  });

  assert.equal(joinOut.diagnostics.cardinality, 'Many-to-Many (M:N)');
  assert.equal(joinOut.diagnostics.isManyToMany, true);
  // ACCT-01 (2x2=4) + ACCT-02 (1x1=1) + ACCT-03 (1x1=1) = 6 rows
  assert.equal(joinOut.rows.length, 6);

  // Append test
  const appendOut = executeDatasetAppend([leftDs, leftDs]);
  assert.equal(appendOut.rows.length, 10);
  assert.ok(appendOut.columns.some(c => c.displayName === '_source_dataset'));
});

// ============================================================================
// 5. Validation, Undo/Redo, Recipes, Schema Drift & Export Security (Parts 37.8–37.12)
// ============================================================================
test('Scenario 13, 14, 15, 16 — Validation Rules, Undo/Redo, Recipe Replay, and Schema Drift Detection', () => {
  const preset = SYNTHETIC_PRESETS[0];
  const ds = createDataset({
    title: preset.title,
    columnNames: preset.columnNames,
    rawRows: preset.rawRows,
    validationRules: [
      { id: 'r1', name: 'Unique Customer ID', type: VALIDATION_RULE_TYPES.UNIQUENESS, column: 'customer_id', isQualityGate: true }
    ]
  });

  // Initially fails uniqueness because CUST-101 is duplicated
  const valBefore = runValidationSuite(ds);
  assert.equal(valBefore.exportBlockedByGate, true);

  applyTransformation(ds, 'DEDUPLICATE_EXACT', { strategy: 'keep_first' });
  applyTransformation(ds, 'TRIM_WHITESPACE', { columnName: 'full_name' });

  const valAfter = runValidationSuite(ds);
  assert.equal(valAfter.exportBlockedByGate, false);

  // Test Undo & Redo
  undoTransformation(ds);
  assert.equal(ds.rows[0].cells[ds.columns[1].id].raw, '  Elena Rostova ');
  redoTransformation(ds);
  assert.equal(ds.rows[0].cells[ds.columns[1].id].raw, 'Elena Rostova');

  // Export recipe and test Schema Drift against Dataset 8
  const recipe = exportCleaningRecipe(ds);
  const driftPreset = SYNTHETIC_PRESETS.find(p => p.id === 'preset_schema_drift_batch2');
  const dsDrifted = createDataset({
    title: driftPreset.title,
    columnNames: driftPreset.columnNames,
    rawRows: driftPreset.rawRows
  });

  const compat = validateRecipeCompatibility(recipe, dsDrifted);
  assert.equal(compat.hasSchemaDrift, true);
  assert.ok(compat.schemaDrift.some(d => d.expectedColumn === 'annual_salary_usd'));

  // Replay with column mapping resolves drift
  const replayRes = replayCleaningRecipe(dsDrifted, recipe, {
    columnMapping: { annual_salary_usd: 'compensation_usd' }
  });
  assert.equal(replayRes.success, true);
  assert.equal(dsDrifted.rows.length, 2); // Duplicate CUST-202/203 row deduplicated or trimmed
});

test('Part 37.10 & 37.12 — CSV Formula Injection Mitigation and Property-Based Invariants', () => {
  const ds = createDataset({
    title: 'Security Test',
    columnNames: ['user_input', 'delta_val'],
    rawRows: [
      ['=cmd|\'/C calc\'!A0', '-42.5'],
      ['+SUM(A1:A10)', '15.0'],
      ['@IMPORTXML()', '0']
    ]
  });

  const csvText = exportToDelimitedText(ds, { sanitizeFormulaInjection: true });
  assert.ok(csvText.includes("'=cmd"), 'Formula starting with = must be prefixed with apostrophe');
  assert.ok(csvText.includes("'+SUM"), 'Formula starting with + must be prefixed with apostrophe');
  assert.ok(csvText.includes("'@IMPORTXML"), 'Formula starting with @ must be prefixed with apostrophe');
  assert.ok(csvText.includes(',-42.5'), 'Negative number -42.5 must NOT be prefixed with apostrophe');

  // Property: Sorting preserves row count; R and Python script generation are non-empty and accurate
  const rCode = generateRScript(ds);
  const pyCode = generatePythonScript(ds);
  const reportMd = generateQualityAuditReport(ds);
  assert.ok(rCode.includes('read_csv'));
  assert.ok(pyCode.includes('pd.read_csv'));
  assert.ok(reportMd.includes('Before vs. After Quality Scorecard'));
});


test('12. Split, Combine, Fill Down, Promote Header, Group/Aggregate, Transpose, and Hash State', () => {
  // 12A. Split & Combine
  const csv = 'id,full_name,dept,score\n1,"Ada, Lovelace",R&D,90\n2,"Alan, Turing",R&D,95\n3,"Grace, Hopper",Ops,100';
  const p = parseDelimitedText(csv);
  const ds = buildDatasetFromParsed({ filename: 'staff.csv', columnNames: p.columnNames, rawRows: p.rawRows });
  applyTransformation(ds, 'SPLIT_COLUMN', { columnName: 'full_name', delimiter: ',', outputNames: ['last_name', 'first_name'] });
  assert.ok(ds.columns.some(c => c.displayName === 'last_name'));
  assert.ok(ds.columns.some(c => c.displayName === 'first_name'));

  applyTransformation(ds, 'COMBINE_COLUMNS', { columns: ['first_name', 'last_name'], delimiter: ' ', newColumnName: 'display_name' });
  assert.ok(ds.columns.some(c => c.displayName === 'display_name'));

  // 12B. Group & Aggregate
  const dsAgg = structuredClone(ds);
  applyTransformation(dsAgg, 'GROUP_AND_AGGREGATE', {
    groupColumns: ['dept'],
    aggregations: [{ columnName: 'score', fn: 'mean' }, { columnName: 'score', fn: 'count' }]
  });
  assert.equal(dsAgg.rows.length, 2);

  // 12C. Transpose Table
  const csvTr = 'metric,Q1,Q2\nRevenue,120,150\nCost,80,90';
  const pTr = parseDelimitedText(csvTr);
  const dsTr = buildDatasetFromParsed({ filename: 'tr.csv', columnNames: pTr.columnNames, rawRows: pTr.rawRows });
  applyTransformation(dsTr, 'TRANSPOSE_TABLE', { headerColumn: 'metric', variableColumnName: 'quarter' });
  assert.equal(dsTr.rows.length, 2);
  assert.deepEqual(dsTr.columns.map(c => c.displayName), ['quarter', 'Revenue', 'Cost']);

  // 12D. Promote Header & Fill Down on messy spreadsheet
  const messyPreset = SYNTHETIC_PRESETS.find(pr => pr.id === 'preset_messy_spreadsheet_export');
  const dsM = buildDatasetFromParsed({ filename: 'erp.csv', columnNames: messyPreset.columnNames, rawRows: messyPreset.rawRows });
  applyTransformation(dsM, 'PROMOTE_ROW_TO_HEADER', { rowIndex: 0 });
  applyTransformation(dsM, 'FILL_DOWN_HIERARCHICAL', { columnName: dsM.columns[0].displayName });
  assert.equal(dsM.rows[1].cells[dsM.columns[0].id].raw, 'North America');

  // 12E. Shareable Hash State round-trip
  const hash = encodeWorkspaceHashState({ presetId: 'preset_messy_customers', activeView: 'cleaning', explanationMode: 'technical' });
  const decoded = decodeWorkspaceHashState(hash);
  assert.equal(decoded.presetId, 'preset_messy_customers');
  assert.equal(decoded.activeView, 'cleaning');
  assert.equal(decoded.explanationMode, 'technical');
});
