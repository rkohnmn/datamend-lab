/**
 * DataMend Lab — Data Restructuring, Multi-Table Relational Joins, and Grouping Engine
 * Implements Parts 18, 19, and 20:
 * - Wide-to-Long (Unpivot / Melt) preserving source column provenance
 * - Long-to-Wide (Pivot Wider) requiring explicit duplicate key/column conflict resolution (never silently overwrites!)
 * - Column Splitting & Combining
 * - Table Transposition with schema warnings
 * - Messy Spreadsheet Repair (Remove preamble rows, Promote row to header, Fill hierarchical labels downward)
 * - Relational Joins (Inner, Left, Right, Full Outer, Semi, Anti) with composite keys, cardinality detection
 *   (1:1, 1:N, N:1, M:N), null-key non-matching guarantee, and unmatched row reports
 * - Multi-File Appending / Union with schema alignment and `_source_file` provenance
 * - Grouping and Aggregation (count, distinct_count, sum, mean, median, min, max, sd, variance, iqr, weighted_mean)
 *
 * All restructuring operations are also registered into OPERATION_REGISTRY so they participate in Undo/Redo and Recipes.
 */

import {
  MISSING_STATES,
  SEMANTIC_TYPES,
  evaluateCellState,
  createDataset
} from './data-model.js';
import { computeNumericStats } from './profiler.js';
import { RISK_LEVELS } from './diagnosis.js';
import { OPERATION_REGISTRY, resolveColumn } from './transforms.js';

/**
 * 18.1 Wide-to-Long (Unpivot / Melt)
 */
export function unpivotWideToLong(dataset, params) {
  const idCols = (params.idColumns || []).map(c => resolveColumn(dataset, c)).filter(Boolean);
  const valueCols = (params.valueColumns || []).map(c => resolveColumn(dataset, c)).filter(Boolean);
  if (valueCols.length === 0) {
    throw new Error('Wide-to-long unpivot requires at least one measurement (value) column.');
  }
  const variableColName = String(params.variableColumnName || 'variable').trim();
  const valueColName = String(params.valueColumnName || 'value').trim();

  const rowsBefore = dataset.rows.length;
  const newColumns = [
    ...idCols.map((c, idx) => ({ ...structuredClone(c), index: idx })),
    {
      id: 'col_unpivot_var',
      index: idCols.length,
      displayName: variableColName,
      originalName: variableColName,
      storageType: 'string',
      semanticType: SEMANTIC_TYPES.CATEGORICAL,
      confirmedType: SEMANTIC_TYPES.CATEGORICAL,
      role: 'grouping',
      nullability: false,
      unit: null,
      allowedCategories: valueCols.map(c => c.displayName),
      parsingConvention: {},
      validationConstraints: [],
      originalSource: { restructured: 'unpivot_variable' },
      provenance: ['unpivot_wide_to_long']
    },
    {
      id: 'col_unpivot_val',
      index: idCols.length + 1,
      displayName: valueColName,
      originalName: valueColName,
      storageType: valueCols.every(c => c.storageType === 'float64') ? 'float64' : 'string',
      semanticType: valueCols.every(c => c.semanticType === SEMANTIC_TYPES.DECIMAL || c.semanticType === SEMANTIC_TYPES.INTEGER)
        ? SEMANTIC_TYPES.DECIMAL
        : SEMANTIC_TYPES.TEXT,
      confirmedType: null,
      role: 'response',
      nullability: true,
      unit: valueCols[0]?.unit || null,
      allowedCategories: null,
      parsingConvention: {},
      validationConstraints: [],
      originalSource: { restructured: 'unpivot_value' },
      provenance: ['unpivot_wide_to_long']
    }
  ];

  const newRows = [];
  let rSeq = 1;
  for (const row of dataset.rows) {
    for (const vCol of valueCols) {
      const cells = {};
      for (const idCol of idCols) {
        cells[idCol.id] = structuredClone(row.cells[idCol.id]);
      }
      cells.col_unpivot_var = evaluateCellState(vCol.displayName, newColumns[idCols.length]);
      cells.col_unpivot_val = structuredClone(row.cells[vCol.id]);
      newRows.push({
        _rowId: `row_long_${rSeq++}`,
        _sourceRowNumber: row._sourceRowNumber,
        _sourceFile: row._sourceFile,
        _lineage: [...(row._lineage || [row._rowId]), `${row._rowId}:${vCol.displayName}`],
        cells
      });
    }
  }

  dataset.columns = newColumns;
  dataset.rows = newRows;

  return {
    summary: `Unpivoted ${valueCols.length} wide column(s) into "${variableColName}" and "${valueColName}" (${rowsBefore} wide rows → ${newRows.length} long observations). Observational unit changed to (ID × ${variableColName}).`,
    cellChanges: [],
    rowsBefore,
    rowsAfter: newRows.length
  };
}

/**
 * 18.2 Long-to-Wide (Pivot Wider) with explicit conflict detection & resolution
 */
export function pivotLongToWide(dataset, params) {
  const idCols = (params.idColumns || []).map(c => resolveColumn(dataset, c)).filter(Boolean);
  const namesFromCol = resolveColumn(dataset, params.namesFromColumn);
  const valuesFromCol = resolveColumn(dataset, params.valuesFromColumn);
  if (!namesFromCol || !valuesFromCol) {
    throw new Error('Pivot wider requires both namesFromColumn and valuesFromColumn.');
  }
  const conflictStrategy = params.conflictStrategy || 'error'; // 'error', 'sum', 'mean', 'first', 'last', 'count'

  const rowsBefore = dataset.rows.length;
  const distinctPivotNames = [];
  const seenNames = new Set();

  for (const row of dataset.rows) {
    const nm = row.cells[namesFromCol.id]?.missingState === MISSING_STATES.PRESENT
      ? String(row.cells[namesFromCol.id].parsed)
      : null;
    if (nm !== null && !seenNames.has(nm)) {
      seenNames.add(nm);
      distinctPivotNames.push(nm);
    }
  }

  // Group by idCols + pivotName to detect collisions
  const groupMap = new Map();
  let collisionCount = 0;

  for (const row of dataset.rows) {
    const idKey = idCols.map(c => String(row.cells[c.id]?.parsed ?? '§NULL')).join('||');
    if (!groupMap.has(idKey)) {
      groupMap.set(idKey, {
        idCells: Object.fromEntries(idCols.map(c => [c.id, structuredClone(row.cells[c.id])])),
        lineage: [],
        buckets: new Map()
      });
    }
    const entry = groupMap.get(idKey);
    entry.lineage.push(row._rowId);
    const pivotName = row.cells[namesFromCol.id]?.missingState === MISSING_STATES.PRESENT
      ? String(row.cells[namesFromCol.id].parsed)
      : null;
    if (pivotName !== null) {
      if (!entry.buckets.has(pivotName)) entry.buckets.set(pivotName, []);
      entry.buckets.get(pivotName).push(row.cells[valuesFromCol.id]);
      if (entry.buckets.get(pivotName).length === 2) {
        collisionCount++;
      }
    }
  }

  if (collisionCount > 0 && conflictStrategy === 'error') {
    throw new Error(
      `Pivot collision detected: ${collisionCount} (ID × ${namesFromCol.displayName}) cell(s) have multiple values. Select an explicit aggregation/resolution strategy (sum, mean, first, last, count) rather than silently overwriting.`
    );
  }

  const valIsNumeric =
    (valuesFromCol.confirmedType || valuesFromCol.semanticType) === SEMANTIC_TYPES.DECIMAL ||
    (valuesFromCol.confirmedType || valuesFromCol.semanticType) === SEMANTIC_TYPES.INTEGER;

  const generatedCols = distinctPivotNames.map((pName, idx) => ({
    id: `col_wide_${idx + 1}`,
    index: idCols.length + idx,
    displayName: pName,
    originalName: pName,
    storageType: valIsNumeric || conflictStrategy === 'count' ? 'float64' : 'string',
    semanticType: conflictStrategy === 'count'
      ? SEMANTIC_TYPES.INTEGER
      : valIsNumeric ? SEMANTIC_TYPES.DECIMAL : SEMANTIC_TYPES.TEXT,
    confirmedType: null,
    role: 'response',
    nullability: true,
    unit: valuesFromCol.unit,
    allowedCategories: null,
    parsingConvention: {},
    validationConstraints: [],
    originalSource: { pivotedFrom: namesFromCol.displayName, valueCol: valuesFromCol.displayName },
    provenance: [`pivot_wider(${conflictStrategy})`]
  }));

  const newColumns = [
    ...idCols.map((c, idx) => ({ ...structuredClone(c), index: idx })),
    ...generatedCols
  ];

  const newRows = [];
  let rSeq = 1;
  for (const [, entry] of groupMap.entries()) {
    const cells = { ...entry.idCells };
    for (let i = 0; i < distinctPivotNames.length; i++) {
      const pName = distinctPivotNames[i];
      const gCol = generatedCols[i];
      const cellList = entry.buckets.get(pName) || [];
      const validCells = cellList.filter(c => c && c.missingState === MISSING_STATES.PRESENT);

      if (validCells.length === 0) {
        cells[gCol.id] = evaluateCellState(null, gCol);
      } else if (validCells.length === 1 && conflictStrategy !== 'count') {
        cells[gCol.id] = evaluateCellState(String(validCells[0].raw), gCol);
      } else {
        let resolvedVal = null;
        if (conflictStrategy === 'first') resolvedVal = validCells[0].raw;
        else if (conflictStrategy === 'last') resolvedVal = validCells[validCells.length - 1].raw;
        else if (conflictStrategy === 'count') resolvedVal = String(validCells.length);
        else if (conflictStrategy === 'sum') {
          const sum = validCells.reduce((acc, c) => acc + Number(c.parsed || 0), 0);
          resolvedVal = String(Number(sum.toFixed(4)));
        } else if (conflictStrategy === 'mean') {
          const sum = validCells.reduce((acc, c) => acc + Number(c.parsed || 0), 0);
          resolvedVal = String(Number((sum / validCells.length).toFixed(4)));
        }
        cells[gCol.id] = evaluateCellState(resolvedVal, gCol);
      }
    }
    newRows.push({
      _rowId: `row_wide_${rSeq++}`,
      _lineage: entry.lineage,
      cells
    });
  }

  dataset.columns = newColumns;
  dataset.rows = newRows;

  return {
    summary: `Pivoted "${namesFromCol.displayName}" into ${generatedCols.length} wide column(s) (${rowsBefore} long rows → ${newRows.length} wide entities, ${collisionCount} collision(s) resolved via ${conflictStrategy}).`,
    cellChanges: [],
    rowsBefore,
    rowsAfter: newRows.length
  };
}

/**
 * 18.3 & 18.4 Split Column and Combine Columns
 */
export function splitColumn(dataset, params) {
  const col = resolveColumn(dataset, params.colId || params.columnName);
  if (!col) throw new Error(`Column not found.`);
  const delimiter = String(params.delimiter ?? ' ');
  const passedNames = params.newColumnNames || params.outputNames;
  const newNames = Array.isArray(passedNames) && passedNames.length >= 2
    ? passedNames
    : [`${col.displayName}_part1`, `${col.displayName}_part2`];

  const addedCols = newNames.map((nm, idx) => ({
    id: `col_${dataset.columns.length + idx + 1}_split`,
    index: dataset.columns.length + idx,
    displayName: nm,
    originalName: nm,
    storageType: 'string',
    semanticType: SEMANTIC_TYPES.TEXT,
    confirmedType: null,
    role: 'metadata',
    nullability: true,
    unit: null,
    allowedCategories: null,
    parsingConvention: {},
    validationConstraints: [],
    originalSource: { splitFrom: col.displayName },
    provenance: [`split(${col.displayName})`]
  }));

  let failedSplits = 0;
  for (const row of dataset.rows) {
    const raw = row.cells[col.id]?.missingState === MISSING_STATES.PRESENT
      ? String(row.cells[col.id].raw)
      : null;
    if (raw === null) {
      for (const ac of addedCols) row.cells[ac.id] = evaluateCellState(null, ac);
    } else {
      const parts = raw.split(delimiter);
      if (parts.length < addedCols.length) failedSplits++;
      for (let i = 0; i < addedCols.length; i++) {
        const partVal = i === addedCols.length - 1
          ? parts.slice(i).join(delimiter)
          : (parts[i] ?? null);
        row.cells[addedCols[i].id] = evaluateCellState(partVal || null, addedCols[i]);
      }
    }
  }

  dataset.columns.push(...addedCols);
  return {
    summary: `Split "${col.displayName}" by "${delimiter}" into [${newNames.join(', ')}] (${failedSplits} row(s) had fewer segments than target columns).`,
    cellChanges: [],
    addedColumns: newNames,
    rowsBefore: dataset.rows.length,
    rowsAfter: dataset.rows.length
  };
}

export function combineColumns(dataset, params) {
  const cols = (params.columns || []).map(c => resolveColumn(dataset, c)).filter(Boolean);
  if (cols.length < 2) throw new Error('Combine columns requires at least 2 columns.');
  const sep = String(params.separator ?? params.delimiter ?? ' ');
  const newColName = String(params.newColumnName || cols.map(c => c.displayName).join('_')).trim();
  const newColId = `col_${dataset.columns.length + 1}_comb`;

  const newCol = {
    id: newColId,
    index: dataset.columns.length,
    displayName: newColName,
    originalName: newColName,
    storageType: 'string',
    semanticType: SEMANTIC_TYPES.TEXT,
    confirmedType: null,
    role: 'metadata',
    nullability: true,
    unit: null,
    allowedCategories: null,
    parsingConvention: {},
    validationConstraints: [],
    originalSource: { combinedFrom: cols.map(c => c.displayName) },
    provenance: [`combine(${cols.map(c => c.displayName).join('+')})`]
  };

  for (const row of dataset.rows) {
    const pieces = [];
    for (const c of cols) {
      const cell = row.cells[c.id];
      if (cell?.missingState === MISSING_STATES.PRESENT && cell.raw !== '') {
        pieces.push(String(cell.raw));
      }
    }
    row.cells[newColId] = evaluateCellState(pieces.length > 0 ? pieces.join(sep) : null, newCol);
  }

  dataset.columns.push(newCol);
  return {
    summary: `Combined [${cols.map(c => c.displayName).join(', ')}] into "${newColName}".`,
    cellChanges: [],
    addedColumns: [newColName],
    rowsBefore: dataset.rows.length,
    rowsAfter: dataset.rows.length
  };
}

/**
 * 18.6 Messy Spreadsheet Structure Repairs:
 * - Fill Down hierarchical labels (e.g. from merged cells)
 * - Promote Row to Header
 * - Remove Preamble / Blank Separator Rows
 */
export function fillDownColumn(dataset, params) {
  const col = resolveColumn(dataset, params.colId || params.columnName);
  if (!col) throw new Error('Column not found.');
  let lastVal = null;
  const cellChanges = [];
  for (const row of dataset.rows) {
    const cell = row.cells[col.id];
    if (cell?.missingState === MISSING_STATES.PRESENT && String(cell.raw).trim() !== '') {
      lastVal = cell.raw;
    } else if (lastVal !== null) {
      const oldVal = cell ? cell.formatted : 'NULL';
      row.cells[col.id] = evaluateCellState(String(lastVal), col, dataset.sourceMetadata?.importOptions);
      cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: String(lastVal) });
    }
  }
  col.provenance.push('fill_down_hierarchical');
  return {
    summary: `Filled downward ${cellChanges.length} hierarchical blank cell(s) in "${col.displayName}".`,
    cellChanges,
    rowsBefore: dataset.rows.length,
    rowsAfter: dataset.rows.length
  };
}

export function promoteRowToHeader(dataset, params) {
  const rowIndex = Number(params.rowIndex || 0);
  if (rowIndex < 0 || rowIndex >= dataset.rows.length) {
    throw new Error(`Row index ${rowIndex} out of bounds.`);
  }
  const rowsBefore = dataset.rows.length;
  const headerRow = dataset.rows[rowIndex];
  const seen = new Map();

  dataset.columns.forEach((col, idx) => {
    const rawCandidate = String(headerRow.cells[col.id]?.raw ?? `col_${idx + 1}`).trim() || `col_${idx + 1}`;
    const cnt = (seen.get(rawCandidate) || 0) + 1;
    seen.set(rawCandidate, cnt);
    col.displayName = cnt > 1 ? `${rawCandidate}_${cnt}` : rawCandidate;
    col.provenance.push(`promoted_header_row_${rowIndex + 1}`);
  });

  // Remove the preamble rows up through rowIndex
  dataset.rows = dataset.rows.slice(rowIndex + 1);
  return {
    summary: `Promoted row ${rowIndex + 1} to column headers and removed ${rowIndex + 1} preamble row(s) (${rowsBefore} → ${dataset.rows.length} rows).`,
    cellChanges: [],
    rowsBefore,
    rowsAfter: dataset.rows.length
  };
}

/**
 * 20. Grouping and Aggregation Engine
 */
export function groupAndAggregate(dataset, params) {
  const groupCols = (params.groupColumns || []).map(c => resolveColumn(dataset, c)).filter(Boolean);
  if (groupCols.length === 0) throw new Error('At least one grouping variable is required.');
  const aggregations = params.aggregations || []; // [{ colId, fn: 'mean'|'sum'|'count'|'median'|'min'|'max'|'sd', weightColId }]
  if (aggregations.length === 0) throw new Error('At least one aggregation specification is required.');

  const rowsBefore = dataset.rows.length;
  const includeMissingGroups = params.includeMissingGroups !== false;
  const buckets = new Map();

  for (const row of dataset.rows) {
    const keyParts = [];
    let hasMissingGrp = false;
    for (const gc of groupCols) {
      const cell = row.cells[gc.id];
      if (!cell || cell.missingState !== MISSING_STATES.PRESENT) {
        hasMissingGrp = true;
        keyParts.push('(Missing Group)');
      } else {
        keyParts.push(String(cell.parsed));
      }
    }
    if (hasMissingGrp && !includeMissingGroups) continue;
    const key = keyParts.join('||');
    if (!buckets.has(key)) {
      buckets.set(key, { keyParts, rows: [] });
    }
    buckets.get(key).rows.push(row);
  }

  const newColumns = groupCols.map((gc, idx) => ({
    ...structuredClone(gc),
    id: `col_grp_${idx + 1}`,
    index: idx
  }));

  const aggSpecs = aggregations.map((agg, idx) => {
    const targetCol = resolveColumn(dataset, agg.colId || agg.columnName);
    const fn = agg.fn || 'count';
    const outName = agg.outputName || `${targetCol ? targetCol.displayName : 'records'}_${fn}`;
    const colObj = {
      id: `col_agg_${idx + 1}`,
      index: groupCols.length + idx,
      displayName: outName,
      originalName: outName,
      storageType: 'float64',
      semanticType: fn === 'count' || fn === 'distinct_count' ? SEMANTIC_TYPES.INTEGER : SEMANTIC_TYPES.DECIMAL,
      confirmedType: null,
      role: 'response',
      nullability: true,
      unit: targetCol?.unit || null,
      allowedCategories: null,
      parsingConvention: {},
      validationConstraints: [],
      originalSource: { aggregatedFrom: targetCol?.displayName || '*', fn },
      provenance: [`aggregate_${fn}`]
    };
    newColumns.push(colObj);
    return { ...agg, targetCol, colObj, fn };
  });

  const newRows = [];
  let gSeq = 1;
  for (const [, bucket] of buckets.entries()) {
    const cells = {};
    groupCols.forEach((gc, idx) => {
      cells[`col_grp_${idx + 1}`] = evaluateCellState(bucket.keyParts[idx], newColumns[idx]);
    });

    for (const spec of aggSpecs) {
      const { targetCol, colObj, fn } = spec;
      let val = null;
      if (fn === 'count') {
        val = targetCol
          ? bucket.rows.filter(r => r.cells[targetCol.id]?.missingState === MISSING_STATES.PRESENT).length
          : bucket.rows.length;
      } else if (fn === 'distinct_count' && targetCol) {
        const s = new Set(
          bucket.rows
            .map(r => r.cells[targetCol.id])
            .filter(c => c?.missingState === MISSING_STATES.PRESENT)
            .map(c => String(c.parsed))
        );
        val = s.size;
      } else if (targetCol) {
        const nums = bucket.rows
          .map(r => r.cells[targetCol.id])
          .filter(c => c?.missingState === MISSING_STATES.PRESENT && typeof c.parsed === 'number')
          .map(c => c.parsed);
        const st = computeNumericStats(nums);
        if (st) {
          if (fn === 'sum') val = Number(st.sum.toFixed(4));
          else if (fn === 'mean') val = Number(st.mean.toFixed(4));
          else if (fn === 'median') val = Number(st.median.toFixed(4));
          else if (fn === 'min') val = Number(st.min.toFixed(4));
          else if (fn === 'max') val = Number(st.max.toFixed(4));
          else if (fn === 'sd') val = Number(st.sd.toFixed(4));
          else if (fn === 'variance') val = Number(st.variance.toFixed(4));
          else if (fn === 'iqr') val = Number(st.iqr.toFixed(4));
        }
      }
      cells[colObj.id] = evaluateCellState(val === null ? null : String(val), colObj);
    }

    newRows.push({
      _rowId: `row_agg_${gSeq++}`,
      _lineage: bucket.rows.map(r => r._rowId),
      cells
    });
  }

  dataset.columns = newColumns;
  dataset.rows = newRows;

  return {
    summary: `Grouped by [${groupCols.map(c => c.displayName).join(', ')}] into ${newRows.length} group(s) from ${rowsBefore} source rows. Note: Aggregation changes observational granularity; individual rows cannot be reconstructed from aggregates alone.`,
    cellChanges: [],
    rowsBefore,
    rowsAfter: newRows.length
  };
}

/**
 * 19.1–19.5 Multi-Dataset Relational Join Engine
 * Supports: inner, left, right, full, semi, anti joins on single or composite keys.
 * Explicitly evaluates cardinality (1:1, 1:N, N:1, M:N) and prevents null==null matches by default.
 */
export function inspectJoinDiagnostics(leftDs, rightDs, keyPairs, options = {}) {
  const matchNullKeys = Boolean(options.matchNullKeys);
  const leftKeyCounts = new Map();
  const rightKeyCounts = new Map();
  let leftNullKeys = 0;
  let rightNullKeys = 0;

  function buildKey(row, cols) {
    const parts = [];
    for (const c of cols) {
      const cell = row.cells[c.id];
      if (!cell || cell.missingState !== MISSING_STATES.PRESENT || String(cell.raw).trim() === '') {
        return null;
      }
      parts.push(String(cell.parsed ?? cell.raw).trim());
    }
    return parts.join('||');
  }

  const leftCols = keyPairs.map(kp => resolveColumn(leftDs, kp.leftKey)).filter(Boolean);
  const rightCols = keyPairs.map(kp => resolveColumn(rightDs, kp.rightKey)).filter(Boolean);
  if (leftCols.length === 0 || leftCols.length !== rightCols.length) {
    throw new Error('Invalid join key mapping.');
  }

  for (const r of leftDs.rows) {
    const k = buildKey(r, leftCols);
    if (k === null) leftNullKeys++;
    else leftKeyCounts.set(k, (leftKeyCounts.get(k) || 0) + 1);
  }
  for (const r of rightDs.rows) {
    const k = buildKey(r, rightCols);
    if (k === null) rightNullKeys++;
    else rightKeyCounts.set(k, (rightKeyCounts.get(k) || 0) + 1);
  }

  const maxLeftMult = Math.max(0, ...leftKeyCounts.values());
  const maxRightMult = Math.max(0, ...rightKeyCounts.values());

  let cardinality = 'One-to-One (1:1)';
  if (maxLeftMult > 1 && maxRightMult > 1) cardinality = 'Many-to-Many (M:N)';
  else if (maxLeftMult === 1 && maxRightMult > 1) cardinality = 'One-to-Many (1:N)';
  else if (maxLeftMult > 1 && maxRightMult === 1) cardinality = 'Many-to-One (N:1)';

  let matchedKeyCount = 0;
  let leftOnlyRows = leftNullKeys;
  let rightOnlyRows = rightNullKeys;
  let innerRowEstimate = 0;

  for (const [k, lCnt] of leftKeyCounts.entries()) {
    if (rightKeyCounts.has(k)) {
      matchedKeyCount++;
      innerRowEstimate += lCnt * rightKeyCounts.get(k);
    } else {
      leftOnlyRows += lCnt;
    }
  }
  for (const [k, rCnt] of rightKeyCounts.entries()) {
    if (!leftKeyCounts.has(k)) {
      rightOnlyRows += rCnt;
    }
  }

  return {
    cardinality,
    isManyToMany: maxLeftMult > 1 && maxRightMult > 1,
    expandsRows: innerRowEstimate > Math.max(leftDs.rows.length, rightDs.rows.length),
    matchedKeyCount,
    leftNullKeys,
    rightNullKeys,
    leftOnlyRows,
    rightOnlyRows,
    predictedCounts: {
      inner: innerRowEstimate,
      left: innerRowEstimate + leftOnlyRows,
      right: innerRowEstimate + rightOnlyRows,
      full: innerRowEstimate + leftOnlyRows + rightOnlyRows,
      semi: Array.from(leftKeyCounts.entries()).reduce((acc, [k, c]) => acc + (rightKeyCounts.has(k) ? c : 0), 0),
      anti: leftOnlyRows
    },
    matchNullKeys
  };
}

export function executeDatasetJoin(leftDs, rightDs, params) {
  const joinType = params.joinType || 'left'; // 'inner', 'left', 'right', 'full', 'semi', 'anti'
  const keyPairs = params.keyPairs || [{ leftKey: params.leftKey, rightKey: params.rightKey }];
  const diag = inspectJoinDiagnostics(leftDs, rightDs, keyPairs, params);

  const leftKeyCols = keyPairs.map(kp => resolveColumn(leftDs, kp.leftKey));
  const rightKeyCols = keyPairs.map(kp => resolveColumn(rightDs, kp.rightKey));
  const rightKeyIds = new Set(rightKeyCols.map(c => c.id));

  function buildKey(row, cols) {
    const parts = [];
    for (const c of cols) {
      const cell = row.cells[c.id];
      if (!cell || cell.missingState !== MISSING_STATES.PRESENT || String(cell.raw).trim() === '') {
        return null;
      }
      parts.push(String(cell.parsed ?? cell.raw).trim());
    }
    return parts.join('||');
  }

  // Build hash index on rightDs
  const rightIndex = new Map();
  const rightRowsWithNullKey = [];
  for (const rRow of rightDs.rows) {
    const k = buildKey(rRow, rightKeyCols);
    if (k === null) {
      rightRowsWithNullKey.push(rRow);
    } else {
      if (!rightIndex.has(k)) rightIndex.set(k, []);
      rightIndex.get(k).push(rRow);
    }
  }

  // Prepare output columns
  const leftColNames = new Set(leftDs.columns.map(c => c.displayName));
  const outColumns = leftDs.columns.map((c, idx) => ({
    ...structuredClone(c),
    id: `col_L_${c.id}`,
    sourceColId: c.id,
    side: 'L',
    index: idx
  }));

  if (joinType !== 'semi' && joinType !== 'anti') {
    for (const rc of rightDs.columns) {
      if (rightKeyIds.has(rc.id) && joinType !== 'right' && joinType !== 'full') continue;
      const conflictName = leftColNames.has(rc.displayName) ? `${rc.displayName}_right` : rc.displayName;
      outColumns.push({
        ...structuredClone(rc),
        id: `col_R_${rc.id}`,
        sourceColId: rc.id,
        side: 'R',
        displayName: conflictName,
        index: outColumns.length
      });
    }
  }

  const outRows = [];
  const matchedRightKeys = new Set();
  let seq = 1;

  function makeJoinedRow(lRow, rRow) {
    const cells = {};
    for (const oc of outColumns) {
      if (oc.side === 'L') {
        cells[oc.id] = lRow && lRow.cells[oc.sourceColId]
          ? structuredClone(lRow.cells[oc.sourceColId])
          : evaluateCellState(null, oc);
      } else {
        cells[oc.id] = rRow && rRow.cells[oc.sourceColId]
          ? structuredClone(rRow.cells[oc.sourceColId])
          : evaluateCellState(null, oc);
      }
    }
    const lineage = [];
    if (lRow) lineage.push(lRow._rowId);
    if (rRow) lineage.push(rRow._rowId);
    return {
      _rowId: `row_join_${seq++}`,
      _lineage: lineage,
      cells
    };
  }

  for (const lRow of leftDs.rows) {
    const k = buildKey(lRow, leftKeyCols);
    const matches = k !== null && rightIndex.has(k) ? rightIndex.get(k) : [];
    if (matches.length > 0) {
      matchedRightKeys.add(k);
      if (joinType === 'semi') {
        outRows.push(makeJoinedRow(lRow, null));
      } else if (joinType !== 'anti') {
        for (const rRow of matches) {
          outRows.push(makeJoinedRow(lRow, rRow));
        }
      }
    } else {
      if (joinType === 'left' || joinType === 'full' || joinType === 'anti') {
        outRows.push(makeJoinedRow(lRow, null));
      }
    }
  }

  if (joinType === 'right' || joinType === 'full') {
    for (const [k, rRows] of rightIndex.entries()) {
      if (!matchedRightKeys.has(k)) {
        for (const rRow of rRows) {
          outRows.push(makeJoinedRow(null, rRow));
        }
      }
    }
    for (const rRow of rightRowsWithNullKey) {
      outRows.push(makeJoinedRow(null, rRow));
    }
  }

  return {
    columns: outColumns.map(({ sourceColId, side, ...rest }) => rest),
    rows: outRows,
    diagnostics: diag,
    summary: `Executed ${joinType.toUpperCase()} JOIN (${diag.cardinality}) between "${leftDs.title}" (${leftDs.rows.length} rows) and "${rightDs.title}" (${rightDs.rows.length} rows) → ${outRows.length} output rows.`
  };
}

/**
 * 19.6 Append / Union Multiple Datasets with Schema Alignment and Provenance
 */
export function executeDatasetAppend(datasets, options = {}) {
  if (!Array.isArray(datasets) || datasets.length < 2) {
    throw new Error('Append requires at least 2 datasets.');
  }

  const colMap = new Map();
  const typeConflicts = [];

  for (const ds of datasets) {
    for (const col of ds.columns) {
      const name = col.displayName;
      if (!colMap.has(name)) {
        colMap.set(name, structuredClone(col));
      } else {
        const existing = colMap.get(name);
        const t1 = existing.confirmedType || existing.semanticType;
        const t2 = col.confirmedType || col.semanticType;
        if (t1 !== t2) {
          typeConflicts.push({
            column: name,
            typeA: t1,
            typeB: t2,
            sourceB: ds.title
          });
          // Promote to TEXT only with explicit warning rather than silent loss
          existing.semanticType = SEMANTIC_TYPES.TEXT;
          existing.storageType = 'string';
        }
      }
    }
  }

  const unifiedColumns = Array.from(colMap.values()).map((c, idx) => ({
    ...c,
    id: `col_union_${idx + 1}`,
    index: idx
  }));

  // Add _source_dataset provenance column
  const provCol = {
    id: `col_union_source`,
    index: unifiedColumns.length,
    displayName: '_source_dataset',
    originalName: '_source_dataset',
    storageType: 'string',
    semanticType: SEMANTIC_TYPES.CATEGORICAL,
    confirmedType: SEMANTIC_TYPES.CATEGORICAL,
    role: 'metadata',
    nullability: false,
    unit: null,
    allowedCategories: datasets.map(d => d.title),
    parsingConvention: {},
    validationConstraints: [],
    originalSource: { provenance: true },
    provenance: ['append_provenance']
  };
  unifiedColumns.push(provCol);

  const outRows = [];
  let rSeq = 1;
  for (const ds of datasets) {
    const byName = new Map(ds.columns.map(c => [c.displayName, c]));
    for (const row of ds.rows) {
      const cells = {};
      for (let i = 0; i < unifiedColumns.length - 1; i++) {
        const uCol = unifiedColumns[i];
        const srcCol = byName.get(uCol.displayName);
        if (srcCol && row.cells[srcCol.id]) {
          cells[uCol.id] = evaluateCellState(row.cells[srcCol.id].raw, uCol);
        } else {
          cells[uCol.id] = evaluateCellState(null, uCol);
        }
      }
      cells[provCol.id] = evaluateCellState(ds.title, provCol);
      outRows.push({
        _rowId: `row_app_${rSeq++}`,
        _sourceFile: ds.sourceMetadata?.filename || ds.title,
        _lineage: [row._rowId],
        cells
      });
    }
  }

  return {
    columns: unifiedColumns,
    rows: outRows,
    typeConflicts,
    summary: `Appended ${datasets.length} datasets into ${outRows.length} combined rows across ${unifiedColumns.length} aligned columns (including "_source_dataset" provenance).`
  };
}


/**
 * 18.5 Table Transposition (Rows ↔ Columns)
 * Swaps rows and columns, using a selected identifier/label column (or row numbers) as new column headers.
 * Warns explicitly when mixed column types are transposed into heterogeneous row series.
 */
export function transposeTable(dataset, params = {}) {
  const headerCol = params.headerColumn ? resolveColumn(dataset, params.headerColumn) : dataset.columns[0];
  const valueCols = dataset.columns.filter(c => !headerCol || c.id !== headerCol.id);
  if (valueCols.length === 0) {
    throw new Error("Transpose requires at least two columns (one label column and one or more value columns).");
  }
  const distinctTypes = new Set(valueCols.map(c => c.confirmedType || c.semanticType));
  const mixedTypeWarning = distinctTypes.size > 1
    ? `Mixed source column types (${Array.from(distinctTypes).join(", ")}) coerced to text in transposed columns.`
    : "Homogeneous measurement columns preserved.";

  const varNameCol = {
    id: "col_tr_var",
    index: 0,
    displayName: params.variableColumnName || "original_column",
    originalName: params.variableColumnName || "original_column",
    storageType: "string",
    semanticType: SEMANTIC_TYPES.IDENTIFIER,
    confirmedType: SEMANTIC_TYPES.IDENTIFIER,
    role: "identifier",
    nullability: false,
    unit: null,
    allowedCategories: null,
    parsingConvention: {},
    validationConstraints: [],
    originalSource: { transposedHeader: true },
    provenance: ["transpose_variable_name"]
  };

  const newColumns = [varNameCol];
  const usedNames = new Set([varNameCol.displayName]);

  const rowHeaderCols = dataset.rows.map((row, rIdx) => {
    const rawLabel = headerCol
      ? String(row.cells[headerCol.id]?.parsed ?? row.cells[headerCol.id]?.raw ?? `row_${rIdx + 1}`).trim()
      : `row_${rIdx + 1}`;
    let baseName = rawLabel || `row_${rIdx + 1}`;
    let finalName = baseName;
    let dup = 2;
    while (usedNames.has(finalName)) {
      finalName = `${baseName}_${dup++}`;
    }
    usedNames.add(finalName);
    const colObj = {
      id: `col_tr_${rIdx + 1}`,
      index: rIdx + 1,
      displayName: finalName,
      originalName: finalName,
      storageType: distinctTypes.size === 1 && (distinctTypes.has(SEMANTIC_TYPES.DECIMAL) || distinctTypes.has(SEMANTIC_TYPES.INTEGER)) ? "float64" : "string",
      semanticType: distinctTypes.size === 1 ? Array.from(distinctTypes)[0] : SEMANTIC_TYPES.TEXT,
      confirmedType: null,
      role: "response",
      nullability: true,
      unit: null,
      allowedCategories: null,
      parsingConvention: {},
      validationConstraints: [],
      originalSource: { transposedFromRow: row._rowId },
      provenance: ["transposed_row"]
    };
    newColumns.push(colObj);
    return { row, colObj };
  });

  const rowsBefore = dataset.rows.length;
  const newRows = valueCols.map((vCol, vIdx) => {
    const cells = {
      [varNameCol.id]: evaluateCellState(vCol.displayName, varNameCol)
    };
    for (const { row, colObj } of rowHeaderCols) {
      const srcCell = row.cells[vCol.id];
      const rawVal = srcCell && srcCell.missingState === MISSING_STATES.PRESENT ? srcCell.raw : null;
      cells[colObj.id] = evaluateCellState(rawVal, colObj);
    }
    return {
      _rowId: `row_tr_${vIdx + 1}`,
      _lineage: dataset.rows.map(r => r._rowId),
      cells
    };
  });

  dataset.columns = newColumns;
  dataset.rows = newRows;

  return {
    summary: `Transposed table using "${headerCol ? headerCol.displayName : "row index"}" as column headers (${rowsBefore} rows -> ${newRows.length} rows, ${newColumns.length} columns). ${mixedTypeWarning}`,
    cellChanges: [],
    rowsBefore,
    rowsAfter: newRows.length
  };
}

// Register restructuring operations in OPERATION_REGISTRY so they work seamlessly with Recipes & Undo/Redo
OPERATION_REGISTRY.UNPIVOT_WIDE_TO_LONG = {
  id: 'UNPIVOT_WIDE_TO_LONG',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Unpivot Wide to Long (Melt)',
  riskLevel: RISK_LEVELS.HIGH,
  description: 'Reshapes multiple measurement columns into key-value observation rows.',
  execute: unpivotWideToLong
};

OPERATION_REGISTRY.PIVOT_LONG_TO_WIDE = {
  id: 'PIVOT_LONG_TO_WIDE',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Pivot Long to Wide',
  riskLevel: RISK_LEVELS.HIGH,
  description: 'Spreads category levels into distinct columns with explicit duplicate collision handling.',
  execute: pivotLongToWide
};

OPERATION_REGISTRY.SPLIT_COLUMN = {
  id: 'SPLIT_COLUMN',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Split Column by Delimiter',
  riskLevel: RISK_LEVELS.MEDIUM,
  description: 'Splits a text column into multiple columns by delimiter.',
  execute: splitColumn
};

OPERATION_REGISTRY.COMBINE_COLUMNS = {
  id: 'COMBINE_COLUMNS',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Combine Columns',
  riskLevel: RISK_LEVELS.LOW,
  description: 'Joins multiple columns into a new column with a chosen delimiter.',
  execute: combineColumns
};

OPERATION_REGISTRY.FILL_DOWN_HIERARCHICAL = {
  id: 'FILL_DOWN_HIERARCHICAL',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Fill Down Hierarchical Labels',
  riskLevel: RISK_LEVELS.MEDIUM,
  description: 'Propagates top-cell labels downward into blank merged-cell rows.',
  execute: fillDownColumn
};

OPERATION_REGISTRY.PROMOTE_ROW_TO_HEADER = {
  id: 'PROMOTE_ROW_TO_HEADER',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Promote Row to Header & Strip Preamble',
  riskLevel: RISK_LEVELS.MEDIUM,
  description: 'Promotes a selected row index to column headers and removes decorative preamble rows above it.',
  execute: promoteRowToHeader
};

OPERATION_REGISTRY.GROUP_AND_AGGREGATE = {
  id: 'GROUP_AND_AGGREGATE',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Group & Aggregate',
  riskLevel: RISK_LEVELS.HIGH,
  description: 'Groups observations by one or more variables and calculates summary statistics.',
  execute: groupAndAggregate
};


OPERATION_REGISTRY.TRANSPOSE_TABLE = {
  id: 'TRANSPOSE_TABLE',
  version: '1.0.0',
  category: 'Restructuring',
  label: 'Transpose Table (Rows ↔ Columns)',
  riskLevel: RISK_LEVELS.HIGH,
  description: 'Transposes rows and columns, warning when heterogeneous column types are combined.',
  execute: transposeTable
};
