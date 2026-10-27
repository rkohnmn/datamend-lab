/**
 * DataMend Lab — Data Profiling Engine (Part 8)
 * Adheres strictly to STATISTICAL_STANDARDS.md:
 * - Two-pass centered variance and standard deviation with Bessel's correction (n - 1)
 * - Hyndman-Fan Type 7 quantiles ((n - 1)q + 1)
 * - Median Absolute Deviation (MAD and normal-consistent MAD_sigma)
 * - Never computes arithmetic mean or SD on postal codes or identifiers!
 * - Relationship profiling: candidate primary keys, functional dependencies, conflicting values for repeated IDs.
 */

import { MISSING_STATES, SEMANTIC_TYPES } from './data-model.js';

/**
 * Hyndman-Fan Type 7 sample quantile on a sorted ascending numerical array.
 */
export function quantileType7(sorted, q) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const k = (n - 1) * q + 1;
  const j = Math.floor(k);
  const gamma = k - j;
  if (k <= 1) return sorted[0];
  if (k >= n) return sorted[n - 1];
  return (1 - gamma) * sorted[j - 1] + gamma * sorted[j];
}

/**
 * Computes two-pass descriptive summary statistics for a numerical vector.
 */
export function computeNumericStats(values) {
  const finite = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  const n = finite.length;
  if (n === 0) {
    return null;
  }

  // Pass 1: Mean
  let sum = 0;
  for (let i = 0; i < n; i++) sum += finite[i];
  const mean = sum / n;

  // Pass 2: Centered Sum of Squares & higher moments
  let ss = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = finite[i] - mean;
    const d2 = d * d;
    ss += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }

  const variance = n > 1 ? ss / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const se = n > 0 ? sd / Math.sqrt(n) : NaN;

  const sorted = [...finite].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];
  const q1 = quantileType7(sorted, 0.25);
  const median = quantileType7(sorted, 0.50);
  const q3 = quantileType7(sorted, 0.75);
  const p05 = quantileType7(sorted, 0.05);
  const p95 = quantileType7(sorted, 0.95);
  const iqr = q3 - q1;

  // MAD
  const absDevs = sorted.map(x => Math.abs(x - median)).sort((a, b) => a - b);
  const mad = quantileType7(absDevs, 0.50);
  const madSigma = 1.482602218505602 * mad;

  const m2Pop = ss / n;
  const skewness = m2Pop > 1e-12 ? (m3 / n) / Math.pow(m2Pop, 1.5) : 0;
  const kurtosisExcess = m2Pop > 1e-12 ? (m4 / n) / (m2Pop * m2Pop) - 3 : 0;

  return {
    n,
    sum,
    mean,
    variance,
    sd,
    se,
    min,
    max,
    q1,
    median,
    q3,
    p05,
    p95,
    iqr,
    mad,
    madSigma,
    skewness,
    kurtosisExcess,
    sorted
  };
}

/**
 * Profiles a single column of a Dataset.
 */
export function profileColumn(dataset, col) {
  const totalRows = dataset.rows.length;
  let nonMissingCount = 0;
  let missingCount = 0;
  let emptyStringCount = 0;
  let invalidParseCount = 0;
  let notApplicableCount = 0;
  let withheldCount = 0;
  let nonFiniteCount = 0;
  let userMarkerCount = 0;
  let ambiguousDateCount = 0;

  const freqMap = new Map();
  const caseVariantsMap = new Map(); // lowercased trimmed -> Set of raw variants
  const numericValues = [];
  const stringLengths = [];
  const dateValues = [];

  let leadingWhitespaceCount = 0;
  let trailingWhitespaceCount = 0;
  let repeatedSpaceCount = 0;
  let controlCharCount = 0;
  let leadingZeroCount = 0;

  const activeType = col.confirmedType || col.semanticType;

  for (let r = 0; r < totalRows; r++) {
    const cell = dataset.rows[r].cells[col.id];
    if (!cell) {
      missingCount++;
      continue;
    }

    switch (cell.missingState) {
      case MISSING_STATES.PRESENT:
        nonMissingCount++;
        break;
      case MISSING_STATES.EMPTY_STRING:
        emptyStringCount++;
        missingCount++;
        break;
      case MISSING_STATES.MISSING:
        missingCount++;
        break;
      case MISSING_STATES.INVALID_PARSE:
        invalidParseCount++;
        break;
      case MISSING_STATES.NOT_APPLICABLE:
        notApplicableCount++;
        missingCount++;
        break;
      case MISSING_STATES.WITHHELD:
        withheldCount++;
        missingCount++;
        break;
      case MISSING_STATES.NONFINITE:
        nonFiniteCount++;
        invalidParseCount++;
        break;
      case MISSING_STATES.USER_MISSING_MARKER:
        userMarkerCount++;
        missingCount++;
        break;
      default:
        missingCount++;
    }

    if (cell.validationState === 'AMBIGUOUS_DATE') {
      ambiguousDateCount++;
    }

    if (cell.raw !== null && cell.raw !== undefined && String(cell.raw) !== '') {
      const rawStr = String(cell.raw);
      stringLengths.push(rawStr.length);

      if (/^\s+/.test(rawStr)) leadingWhitespaceCount++;
      if (/\s+$/.test(rawStr)) trailingWhitespaceCount++;
      if (/\S\s{2,}\S/.test(rawStr)) repeatedSpaceCount++;
      if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(rawStr)) controlCharCount++;
      if (/^0\d+$/.test(rawStr.trim())) leadingZeroCount++;

      if (cell.missingState === MISSING_STATES.PRESENT) {
        const keyStr = String(cell.parsed ?? rawStr);
        freqMap.set(keyStr, (freqMap.get(keyStr) || 0) + 1);

        const normKey = rawStr.trim().toLowerCase();
        if (!caseVariantsMap.has(normKey)) caseVariantsMap.set(normKey, new Set());
        caseVariantsMap.get(normKey).add(rawStr);

        if (
          (activeType === SEMANTIC_TYPES.INTEGER || activeType === SEMANTIC_TYPES.DECIMAL) &&
          typeof cell.parsed === 'number' &&
          Number.isFinite(cell.parsed)
        ) {
          numericValues.push(cell.parsed);
        }

        if (activeType === SEMANTIC_TYPES.DATE || activeType === SEMANTIC_TYPES.DATETIME) {
          if (typeof cell.parsed === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cell.parsed)) {
            dateValues.push(cell.parsed);
          }
        }
      }
    }
  }

  const uniqueCount = freqMap.size;
  const sortedFreqs = Array.from(freqMap.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([value, count]) => ({
      value,
      count,
      proportion: nonMissingCount > 0 ? count / nonMissingCount : 0
    }));

  // Only compute mean/SD/quantiles on quantitative variables (never on identifiers or postal codes!)
  const isQuantitative =
    activeType === SEMANTIC_TYPES.INTEGER || activeType === SEMANTIC_TYPES.DECIMAL;
  const numericStats = isQuantitative ? computeNumericStats(numericValues) : null;

  let dateRange = null;
  if (dateValues.length > 0) {
    const sortedDates = [...dateValues].sort();
    dateRange = {
      min: sortedDates[0],
      max: sortedDates[sortedDates.length - 1],
      count: sortedDates.length
    };
  }

  let stringLengthStats = null;
  if (stringLengths.length > 0) {
    stringLengthStats = {
      min: Math.min(...stringLengths),
      max: Math.max(...stringLengths)
    };
  }

  // Case / whitespace variant clusters
  const superficialClusters = [];
  for (const [normKey, variantsSet] of caseVariantsMap.entries()) {
    if (variantsSet.size > 1) {
      const variants = Array.from(variantsSet).map(v => ({
        value: v,
        count: freqMap.get(v) || 0
      }));
      superficialClusters.push({
        normalized: normKey,
        variants
      });
    }
  }

  return {
    colId: col.id,
    displayName: col.displayName,
    originalName: col.originalName,
    semanticType: activeType,
    role: col.role,
    unit: col.unit,
    totalRows,
    nonMissingCount,
    missingCount,
    missingPercentage: totalRows > 0 ? (missingCount / totalRows) * 100 : 0,
    completenessPercentage: totalRows > 0 ? (nonMissingCount / totalRows) * 100 : 100,
    emptyStringCount,
    invalidParseCount,
    notApplicableCount,
    withheldCount,
    nonFiniteCount,
    userMarkerCount,
    ambiguousDateCount,
    uniqueCount,
    isUniqueCandidateKey: nonMissingCount === totalRows && uniqueCount === totalRows && totalRows > 0,
    isConstant: uniqueCount === 1 && nonMissingCount > 0,
    isEmptyColumn: nonMissingCount === 0 && invalidParseCount === 0,
    topValues: sortedFreqs.slice(0, 10),
    allFrequencies: sortedFreqs,
    numericStats,
    dateRange,
    stringLengthStats,
    whitespacePatterns: {
      leading: leadingWhitespaceCount,
      trailing: trailingWhitespaceCount,
      repeatedInternal: repeatedSpaceCount,
      controlChars: controlCharCount
    },
    leadingZeroCount,
    superficialClusters
  };
}

/**
 * Profiles relationships across columns (candidate keys, repeated identifiers with conflicting attributes,
 * exact row duplicates, functional dependencies).
 */
export function profileDatasetRelationships(dataset, columnProfiles) {
  const rowCount = dataset.rows.length;
  const colCount = dataset.columns.length;

  // 1. Exact duplicate rows across all columns
  const rowSigMap = new Map();
  let exactDuplicateRowCount = 0;
  const duplicateRowGroups = [];

  for (let r = 0; r < rowCount; r++) {
    const row = dataset.rows[r];
    const sig = dataset.columns
      .map(c => {
        const cell = row.cells[c.id];
        if (!cell) return '§NULL';
        return `${cell.missingState}:${String(cell.raw ?? '')}`;
      })
      .join('||');
    if (!rowSigMap.has(sig)) rowSigMap.set(sig, []);
    rowSigMap.get(sig).push(row._rowId);
  }

  for (const [sig, rowIds] of rowSigMap.entries()) {
    if (rowIds.length > 1) {
      exactDuplicateRowCount += rowIds.length - 1;
      duplicateRowGroups.push({ signature: sig, rowIds });
    }
  }

  // 2. Candidate Primary Keys
  const candidatePrimaryKeys = columnProfiles
    .filter(cp => cp.isUniqueCandidateKey)
    .map(cp => cp.displayName);

  // 3. Repeated Entity Identifiers & Conflicting Values Check
  const repeatedIdentifierFindings = [];
  const idColumns = dataset.columns.filter(
    c =>
      (c.confirmedType || c.semanticType) === SEMANTIC_TYPES.IDENTIFIER ||
      /(?:^|_)(?:id|code|key|customer_id|patient_id|emp_id|entity_id)(?:$|_)/i.test(c.displayName)
  );

  for (const idCol of idColumns) {
    const entityMap = new Map();
    for (const row of dataset.rows) {
      const val = row.cells[idCol.id]?.raw;
      if (val === null || val === undefined || String(val).trim() === '') continue;
      const key = String(val).trim();
      if (!entityMap.has(key)) entityMap.set(key, []);
      entityMap.get(key).push(row);
    }

    const repeatedKeys = Array.from(entityMap.entries()).filter(([, rows]) => rows.length > 1);
    if (repeatedKeys.length > 0) {
      // Check if repeated rows are exact duplicates or longitudinal/one-to-many records
      let conflictingAttrCount = 0;
      for (const [, rows] of repeatedKeys) {
        const otherCols = dataset.columns.filter(c => c.id !== idCol.id);
        for (const oc of otherCols) {
          const vals = new Set(rows.map(r => String(r.cells[oc.id]?.raw ?? '')));
          if (vals.size > 1) {
            conflictingAttrCount++;
            break;
          }
        }
      }
      repeatedIdentifierFindings.push({
        columnName: idCol.displayName,
        colId: idCol.id,
        repeatedKeyCount: repeatedKeys.length,
        totalAffectedRows: repeatedKeys.reduce((acc, [, r]) => acc + r.length, 0),
        hasConflictingAttributes: conflictingAttrCount > 0,
        examples: repeatedKeys.slice(0, 5).map(([k, r]) => ({ key: k, count: r.length }))
      });
    }
  }

  // 4. Functional Dependency Hypotheses (A -> B where each value of A maps to at most 1 value of B)
  const functionalDependencies = [];
  if (rowCount >= 4 && colCount >= 2 && colCount <= 25) {
    for (let i = 0; i < dataset.columns.length; i++) {
      const colA = dataset.columns[i];
      const profA = columnProfiles[i];
      if (profA.uniqueCount <= 1 || profA.uniqueCount === rowCount) continue;

      for (let j = 0; j < dataset.columns.length; j++) {
        if (i === j) continue;
        const colB = dataset.columns[j];
        const profB = columnProfiles[j];
        if (profB.uniqueCount <= 1) continue;

        const mapAB = new Map();
        let holds = true;
        for (const row of dataset.rows) {
          const a = row.cells[colA.id]?.raw;
          const b = row.cells[colB.id]?.raw;
          if (!a || !b) continue;
          if (mapAB.has(a) && mapAB.get(a) !== b) {
            holds = false;
            break;
          }
          mapAB.set(a, b);
        }
        if (holds && mapAB.size >= 2) {
          functionalDependencies.push({
            determinant: colA.displayName,
            dependent: colB.displayName,
            distinctDeterminants: mapAB.size
          });
        }
      }
    }
  }

  return {
    exactDuplicateRowCount,
    duplicateRowGroups,
    candidatePrimaryKeys,
    repeatedIdentifierFindings,
    functionalDependencies: functionalDependencies.slice(0, 12)
  };
}

/**
 * Full Dataset Profile orchestration.
 */
export function profileDataset(dataset) {
  const columnProfiles = dataset.columns.map(col => profileColumn(dataset, col));
  const relationships = profileDatasetRelationships(dataset, columnProfiles);

  const totalCells = dataset.rows.length * dataset.columns.length;
  const totalMissingCells = columnProfiles.reduce((acc, cp) => acc + cp.missingCount, 0);
  const totalInvalidCells = columnProfiles.reduce((acc, cp) => acc + cp.invalidParseCount, 0);
  const totalAmbiguousCells = columnProfiles.reduce((acc, cp) => acc + cp.ambiguousDateCount, 0);

  // Missingness co-occurrence patterns across rows
  let completeRowCount = 0;
  const patternMap = new Map();
  for (const row of dataset.rows) {
    const missingCols = [];
    for (const col of dataset.columns) {
      const cell = row.cells[col.id];
      if (!cell || cell.missingState !== MISSING_STATES.PRESENT) {
        missingCols.push(col.displayName);
      }
    }
    if (missingCols.length === 0) completeRowCount++;
    const patKey = missingCols.length === 0 ? '(Complete Case)' : missingCols.join(' + ');
    patternMap.set(patKey, (patternMap.get(patKey) || 0) + 1);
  }

  const missingnessPatterns = Array.from(patternMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([pattern, count]) => ({
      pattern,
      count,
      percentage: dataset.rows.length > 0 ? (count / dataset.rows.length) * 100 : 0
    }));

  const typeBreakdown = {};
  for (const cp of columnProfiles) {
    typeBreakdown[cp.semanticType] = (typeBreakdown[cp.semanticType] || 0) + 1;
  }

  return {
    datasetId: dataset.id,
    revision: dataset.revision,
    rowCount: dataset.rows.length,
    colCount: dataset.columns.length,
    totalCells,
    totalMissingCells,
    overallCompleteness: totalCells > 0 ? ((totalCells - totalMissingCells) / totalCells) * 100 : 100,
    completeRowCount,
    incompleteRowCount: dataset.rows.length - completeRowCount,
    totalInvalidCells,
    totalAmbiguousCells,
    exactDuplicateRowCount: relationships.exactDuplicateRowCount,
    typeBreakdown,
    columnProfiles,
    relationships,
    missingnessPatterns
  };
}
