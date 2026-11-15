/** Batch 15: regression tests; install as tests/audit-integrity.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset } from '../js/data-model.js';
import { parseDelimitedText, extractZipEntries } from '../js/parsers.js';
import { VALIDATION_RULE_TYPES, evaluateValidationRule, runValidationSuite } from '../js/validation.js';
import { inspectJoinDiagnostics, executeDatasetJoin } from '../js/restructure.js';
import { applyTransformation } from '../js/transforms.js';
import { exportToXlsxBytes, replayCleaningRecipe } from '../js/exporters.js';

function dataset(columnNames, rawRows) {
  return createDataset({ title: 'Audit fixture', columnNames, rawRows });
}

test('CSV rejects trailing non-delimiter characters after a quoted value', () => {
  assert.throws(() => parseDelimitedText('key,label\n01,"Ada"trailer\n'), /after a closing quote/i);
  const good = parseDelimitedText('key,label\n01,"Ada, Bob"\n02,"Quote ""inside"""\n');
  assert.equal(good.rawRows[0][1], 'Ada, Bob');
  assert.equal(good.rawRows[1][1], 'Quote "inside"');
});

test('ZIP parser rejects modified content even when its length is unchanged', () => {
  const archive = exportToXlsxBytes(dataset(['id', 'score'], [['A', '5']]));
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = 30 + nameLen + extraLen;
  assert.ok(dataStart < archive.length);
  const tampered = archive.slice();
  tampered[dataStart + 2] ^= 1;
  assert.throws(() => extractZipEntries(tampered), /CRC mismatch/i);
  assert.ok(extractZipEntries(archive).size > 0);
});

test('ZIP parser rejects false uncompressed-size claims', () => {
  const archive = exportToXlsxBytes(dataset(['id'], [['a']]));
  const changed = archive.slice();
  const view = new DataView(changed.buffer, changed.byteOffset, changed.byteLength);
  let central = -1;
  for (let i = 0; i <= changed.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) { central = i; break; }
  }
  assert.ok(central >= 0);
  view.setUint32(central + 24, 1, true);
  assert.throws(() => extractZipEntries(changed), /size mismatch/i);
});

test('composite uniqueness distinguishes delimiter-containing key tuples', () => {
  const ds = dataset(['part_a', 'part_b'], [['a||b', 'c'], ['a', 'b||c']]);
  const report = evaluateValidationRule(ds, {
    id: 'composite', type: VALIDATION_RULE_TYPES.COMPOSITE_UNIQUENESS,
    columns: ['part_a', 'part_b'], isQualityGate: true,
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.passing, 2);
});

test('unavailable referential dataset or column fails a quality gate', () => {
  const ds = dataset(['foreign_key'], [['A'], ['B']]);
  ds.validationRules = [{
    id: 'ref', type: VALIDATION_RULE_TYPES.REFERENTIAL_INTEGRITY,
    column: 'foreign_key', referenceDatasetId: 'missing',
    referenceColumn: 'id', isQualityGate: true,
  }];
  const report = runValidationSuite(ds, {});
  assert.equal(report.results[0].status, 'FAIL');
  assert.equal(report.exportBlockedByGate, true);
});

test('unknown validation columns and types cannot pass a gate', () => {
  const ds = dataset(['id'], [['A']]);
  for (const rule of [
    { type: VALIDATION_RULE_TYPES.NONMISSING, column: 'missing' },
    { type: VALIDATION_RULE_TYPES.COMPOSITE_UNIQUENESS, columns: ['id', 'missing'] },
    { type: 'unknown_rule', column: 'id' },
  ]) {
    const result = evaluateValidationRule(ds, { ...rule, isQualityGate: true });
    assert.equal(result.status, 'FAIL');
  }
});

test('joins do not match different tuples that stringify with the same separator', () => {
  const left = dataset(['key_a', 'key_b', 'score'], [['a||b', 'c', '10']]);
  const right = dataset(['key_a', 'key_b', 'value'], [['a', 'b||c', '20']]);
  const keyPairs = [{ leftKey: 'key_a', rightKey: 'key_a' }, { leftKey: 'key_b', rightKey: 'key_b' }];
  assert.equal(inspectJoinDiagnostics(left, right, keyPairs).predictedCounts.inner, 0);
  assert.equal(executeDatasetJoin(left, right, { joinType: 'inner', keyPairs }).rows.length, 0);
});

test('join rejects partially resolvable paired keys rather than projecting them', () => {
  const left = dataset(['a', 'b'], [['1', '2']]);
  const right = dataset(['a', 'b'], [['1', '2']]);
  assert.throws(() => inspectJoinDiagnostics(left, right,
    [{leftKey:'a',rightKey:'missing'},{leftKey:'missing',rightKey:'b'}]), /Invalid join key mapping/i);
});

test('pivot and group-by preserve distinct compound keys and reject missing identifiers', () => {
  const ds = dataset(['id_a', 'id_b', 'metric', 'value'], [
    ['a||b', 'c', 'height', '10'], ['a', 'b||c', 'height', '20'],
  ]);
  assert.throws(() => applyTransformation(ds, 'PIVOT_LONG_TO_WIDE', {
    idColumns: ['missing'], namesFromColumn: 'metric', valuesFromColumn: 'value',
  }), /identifier columns/i);
  applyTransformation(ds, 'PIVOT_LONG_TO_WIDE', {
    idColumns: ['id_a','id_b'], namesFromColumn: 'metric', valuesFromColumn: 'value',
  });
  assert.equal(ds.rows.length, 2);
  const grouped = dataset(['id_a', 'id_b', 'value'], [
    ['a||b', 'c', '10'], ['a', 'b||c', '20'],
  ]);
  applyTransformation(grouped, 'GROUP_AND_AGGREGATE', {
    groupColumns: ['id_a', 'id_b'], aggregations: [{columnName:'value',fn:'count'}],
  });
  assert.equal(grouped.rows.length, 2);
});

test('failed recipe replay restores validation rules, history, undo/redo, revision and timestamps', () => {
  const ds = dataset(['name', 'value'], [[' Ada ', '5']]);
  const before = structuredClone({
    columns: ds.columns, rows: ds.rows, validationRules: ds.validationRules,
    history: ds.history, redoStack: ds.redoStack, revision: ds.revision,
    updatedAt: ds.updatedAt, learnedParameters: ds.learnedParameters,
  });
  const recipe = {
    steps: [
      { stepNumber: 1, operationType: 'TRIM_WHITESPACE', params: {colId:'name'} },
      { stepNumber: 2, operationType: 'PIVOT_LONG_TO_WIDE', params: {
        idColumns: [], namesFromColumn: 'name', valuesFromColumn: 'value',
      } },
    ],
    validationRules: [{id:'inserted_by_recipe',type:'nonmissing',column:'name'}],
  };
  assert.throws(() => replayCleaningRecipe(ds, recipe), /rolled back cleanly/i);
  for (const key of Object.keys(before)) assert.deepEqual(ds[key], before[key], key);
});
