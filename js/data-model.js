/**
 * DataMend Lab — Internal Data Model & Immutable Snapshot Architecture
 * Zero-dependency ES2022+ module.
 *
 * Implements Part 7:
 * - Separate raw and interpreted values (raw, parsed, formatted, missingState, validationState, transformed)
 * - Column metadata (id, displayName, originalName, storageType, semanticType, confirmedType, nullability, unit, allowedCategories, parsingConvention, validationConstraints, originalSource, provenance)
 * - Row identity (stable internal _rowId distinct from business identifiers, lineage tracking)
 * - Missing-value states (PRESENT, EMPTY_STRING, MISSING, INVALID_PARSE, NOT_APPLICABLE, WITHHELD, NONFINITE, USER_MISSING_MARKER)
 * - Dataset identity & Non-destructive immutable snapshots with Undo/Redo support.
 */

export const MISSING_STATES = Object.freeze({
  PRESENT: 'PRESENT',
  EMPTY_STRING: 'EMPTY_STRING',
  MISSING: 'MISSING',
  INVALID_PARSE: 'INVALID_PARSE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  WITHHELD: 'WITHHELD',
  NONFINITE: 'NONFINITE',
  USER_MISSING_MARKER: 'USER_MISSING_MARKER'
});

export const SEMANTIC_TYPES = Object.freeze({
  TEXT: 'text',
  INTEGER: 'integer',
  DECIMAL: 'decimal',
  BOOLEAN: 'boolean',
  CATEGORICAL: 'categorical',
  ORDERED_CATEGORICAL: 'ordered_categorical',
  DATE: 'date',
  DATETIME: 'datetime',
  DURATION: 'duration',
  IDENTIFIER: 'identifier'
});

export const VARIABLE_ROLES = Object.freeze({
  EXPLANATORY: 'explanatory',
  RESPONSE: 'response',
  GROUPING: 'grouping',
  WEIGHT: 'weight',
  TIMESTAMP: 'timestamp',
  METADATA: 'metadata',
  IDENTIFIER: 'identifier'
});

export const DEFAULT_MISSING_MARKERS = Object.freeze({
  MISSING: ['NA', 'N/A', 'NULL', 'null', 'NaN', 'nan', '.', '-999', '-9999'],
  NOT_APPLICABLE: ['N/A (Not Applicable)', 'NOT_APPLICABLE', 'inapplicable'],
  WITHHELD: ['WITHHELD', 'REDACTED', 'CONFIDENTIAL', 'UNKNOWN', 'Unknown', 'unknown', 'Prefer not to say']
});

/**
 * Generates a deterministic fingerprint hash for provenance auditing.
 */
export function computeDatasetFingerprint(rawRows, columnNames) {
  let hash = 2166136261;
  const headerStr = (columnNames || []).join('|');
  for (let i = 0; i < headerStr.length; i++) {
    hash ^= headerStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const limit = Math.min(rawRows.length, 500);
  for (let r = 0; r < limit; r++) {
    const row = rawRows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const s = String(row[c] ?? '');
      for (let k = 0; k < s.length; k++) {
        hash ^= s.charCodeAt(k);
        hash = Math.imul(hash, 16777619);
      }
    }
  }
  return 'fnv1a_' + (hash >>> 0).toString(16).padStart(8, '0') + `_n${rawRows.length}`;
}

/**
 * Checks if a raw string value looks like a leading-zero identifier (e.g. "00123", "07030")
 * or structured code (e.g. "ID-104", "ACCT_09").
 */
export function isLeadingZeroIdentifier(strVal) {
  if (typeof strVal !== 'string') return false;
  const trimmed = strVal.trim();
  if (trimmed.length > 1 && /^0\d+$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Checks if a date string is ambiguous between US (MM/DD/YYYY) and International (DD/MM/YYYY),
 * e.g., "03/04/2026" where both first and second components are <= 12 and unequal.
 */
export function detectDateAmbiguity(strVal) {
  if (typeof strVal !== 'string') return { isDateCandidate: false, ambiguous: false };
  const s = strVal.trim();
  // Match slash or dash separated numeric dates like 03/04/2026 or 03-04-2026
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (!m) {
    // Check ISO YYYY-MM-DD
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?)?$/.exec(s);
    if (iso) {
      const year = Number(iso[1]);
      const month = Number(iso[2]);
      const day = Number(iso[3]);
      const valid = month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1000 && year <= 9999;
      return {
        isDateCandidate: true,
        ambiguous: false,
        format: iso[4] ? 'ISO_DATETIME' : 'ISO_DATE',
        valid,
        isoValue: valid ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}${iso[4] ? `T${iso[4]}:${iso[5]}:${iso[6] || '00'}Z` : ''}` : null
      };
    }
    return { isDateCandidate: false, ambiguous: false };
  }
  const p1 = Number(m[1]);
  const p2 = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year >= 50 ? 1900 : 2000;

  if (p1 > 12 && p2 >= 1 && p2 <= 12 && p1 <= 31) {
    return {
      isDateCandidate: true,
      ambiguous: false,
      format: 'DD/MM/YYYY',
      valid: true,
      isoValue: `${String(year).padStart(4, '0')}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`
    };
  }
  if (p2 > 12 && p1 >= 1 && p1 <= 12 && p2 <= 31) {
    return {
      isDateCandidate: true,
      ambiguous: false,
      format: 'MM/DD/YYYY',
      valid: true,
      isoValue: `${String(year).padStart(4, '0')}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`
    };
  }
  if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 12) {
    if (p1 === p2) {
      return {
        isDateCandidate: true,
        ambiguous: false,
        format: 'SYMMETRIC_SLASH',
        valid: true,
        isoValue: `${String(year).padStart(4, '0')}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`
      };
    }
    return {
      isDateCandidate: true,
      ambiguous: true,
      format: 'AMBIGUOUS_SLASH',
      valid: true,
      isoIfMDY: `${String(year).padStart(4, '0')}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`,
      isoIfDMY: `${String(year).padStart(4, '0')}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`
    };
  }
  return {
    isDateCandidate: true,
    ambiguous: false,
    format: 'INVALID_DATE',
    valid: false,
    isoValue: null
  };
}

/**
 * Parses a numeric value according to explicit locale / convention options without silent coercion.
 */
export function parseNumericCell(raw, options = {}) {
  const decimalSep = options.decimalSeparator || '.';
  const thousandsSep = options.thousandsSeparator ?? (decimalSep === '.' ? ',' : '.');
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { valid: false, value: null, nonFinite: true };
    }
    return { valid: true, value: raw };
  }
  if (typeof raw !== 'string') return { valid: false, value: null };
  let s = raw.trim();
  if (!s) return { valid: false, value: null, empty: true };

  // Do not coerce leading-zero strings unless explicitly forced
  if (!options.allowLeadingZeroTruncation && isLeadingZeroIdentifier(s)) {
    return { valid: false, value: null, leadingZeroProtected: true };
  }

  // Handle accounting parentheses e.g. (1,250.50)
  let isNegative = false;
  if (/^\(.*\)$/.test(s)) {
    isNegative = true;
    s = s.slice(1, -1).trim();
  }

  // Strip currency symbols ($ € £ ¥) and percentage sign if allowed
  let isPercent = false;
  if (s.endsWith('%')) {
    isPercent = true;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(/^[\$€£¥]\s*/, '').replace(/\s*[\$€£¥]$/, '');

  // Remove thousands separator if properly placed
  if (thousandsSep) {
    const escapedT = thousandsSep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(escapedT, 'g'), '');
  }
  if (decimalSep !== '.') {
    const escapedD = decimalSep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(escapedD, 'g'), '.');
  }

  if (s === 'Infinity' || s === '+Infinity' || s === '-Infinity' || s === 'NaN') {
    return { valid: false, value: null, nonFinite: true };
  }

  if (!/^[+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?$/.test(s)) {
    return { valid: false, value: null };
  }

  let num = Number(s);
  if (!Number.isFinite(num)) {
    return { valid: false, value: null, nonFinite: true };
  }
  if (isNegative) num = -Math.abs(num);
  if (isPercent && options.scalePercentages) num = num / 100;
  return { valid: true, value: num, isPercent };
}

/**
 * Infers the semantic type of a column from its raw values and column name.
 */
export function inferColumnSemanticType(colName, rawValues, options = {}) {
  const nameLower = String(colName || '').toLowerCase();
  const isIdName = /(?:^|_)(?:id|code|zip|postal|ssn|account|sku|uuid|key)(?:$|_)/i.test(nameLower);

  let nonEmpty = 0;
  let leadingZeros = 0;
  let integers = 0;
  let decimals = 0;
  let booleans = 0;
  let dates = 0;
  let datetimes = 0;
  let ambiguousDates = 0;
  const distinctValues = new Set();

  const missingSet = new Set(options.missingMarkers || DEFAULT_MISSING_MARKERS.MISSING);
  const naSet = new Set(options.notApplicableMarkers || DEFAULT_MISSING_MARKERS.NOT_APPLICABLE);
  const withheldSet = new Set(options.withheldMarkers || DEFAULT_MISSING_MARKERS.WITHHELD);

  for (let i = 0; i < rawValues.length; i++) {
    const v = rawValues[i];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s === '') continue;
    if (missingSet.has(s) || naSet.has(s) || withheldSet.has(s)) continue;

    nonEmpty++;
    distinctValues.add(s);

    if (isLeadingZeroIdentifier(s)) {
      leadingZeros++;
      continue;
    }

    if (/^(?:true|false|yes|no|0|1)$/i.test(s)) {
      booleans++;
    }

    const dCheck = detectDateAmbiguity(s);
    if (dCheck.isDateCandidate && dCheck.valid) {
      if (dCheck.ambiguous) ambiguousDates++;
      if (dCheck.format === 'ISO_DATETIME') datetimes++;
      else dates++;
    }

    const nCheck = parseNumericCell(v, options);
    if (nCheck.valid) {
      if (Number.isInteger(nCheck.value) && !s.includes('.')) {
        integers++;
      } else {
        decimals++;
      }
    }
  }

  if (nonEmpty === 0) {
    return {
      semanticType: SEMANTIC_TYPES.TEXT,
      storageType: 'string',
      role: VARIABLE_ROLES.METADATA,
      hasLeadingZeros: false,
      hasAmbiguousDates: false
    };
  }

  if (leadingZeros > 0 || (isIdName && distinctValues.size >= nonEmpty * 0.8)) {
    return {
      semanticType: SEMANTIC_TYPES.IDENTIFIER,
      storageType: 'string',
      role: VARIABLE_ROLES.IDENTIFIER,
      hasLeadingZeros: leadingZeros > 0,
      hasAmbiguousDates: false
    };
  }

  if ((dates + datetimes) / nonEmpty >= 0.8) {
    const isDt = datetimes > 0;
    return {
      semanticType: isDt ? SEMANTIC_TYPES.DATETIME : SEMANTIC_TYPES.DATE,
      storageType: 'string',
      role: VARIABLE_ROLES.TIMESTAMP,
      hasLeadingZeros: false,
      hasAmbiguousDates: ambiguousDates > 0
    };
  }

  if (booleans === nonEmpty && distinctValues.size <= 2 && integers < nonEmpty) {
    return {
      semanticType: SEMANTIC_TYPES.BOOLEAN,
      storageType: 'boolean',
      role: VARIABLE_ROLES.GROUPING,
      hasLeadingZeros: false,
      hasAmbiguousDates: false
    };
  }

  if ((integers + decimals) / nonEmpty >= 0.85) {
    if (isIdName) {
      return {
        semanticType: SEMANTIC_TYPES.IDENTIFIER,
        storageType: 'string',
        role: VARIABLE_ROLES.IDENTIFIER,
        hasLeadingZeros: leadingZeros > 0,
        hasAmbiguousDates: false
      };
    }
    const isInt = decimals === 0;
    return {
      semanticType: isInt ? SEMANTIC_TYPES.INTEGER : SEMANTIC_TYPES.DECIMAL,
      storageType: 'float64',
      role: VARIABLE_ROLES.EXPLANATORY,
      hasLeadingZeros: false,
      hasAmbiguousDates: false
    };
  }

  // Check if ordered Likert scale
  const lowerSet = new Set(Array.from(distinctValues).map(x => x.toLowerCase()));
  const likertLevels = ['strongly disagree', 'disagree', 'neutral', 'agree', 'strongly agree'];
  const ordLevels = ['low', 'medium', 'high'];
  if ([...lowerSet].every(x => likertLevels.includes(x))) {
    return {
      semanticType: SEMANTIC_TYPES.ORDERED_CATEGORICAL,
      storageType: 'string',
      role: VARIABLE_ROLES.GROUPING,
      allowedCategories: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
      hasLeadingZeros: false,
      hasAmbiguousDates: false
    };
  }
  if ([...lowerSet].every(x => ordLevels.includes(x))) {
    return {
      semanticType: SEMANTIC_TYPES.ORDERED_CATEGORICAL,
      storageType: 'string',
      role: VARIABLE_ROLES.GROUPING,
      allowedCategories: ['low', 'medium', 'high'],
      hasLeadingZeros: false,
      hasAmbiguousDates: false
    };
  }

  if (distinctValues.size <= Math.max(20, Math.floor(nonEmpty * 0.35))) {
    return {
      semanticType: SEMANTIC_TYPES.CATEGORICAL,
      storageType: 'string',
      role: VARIABLE_ROLES.GROUPING,
      hasLeadingZeros: false,
      hasAmbiguousDates: false
    };
  }

  return {
    semanticType: SEMANTIC_TYPES.TEXT,
    storageType: 'string',
    role: VARIABLE_ROLES.METADATA,
    hasLeadingZeros: false,
    hasAmbiguousDates: false
  };
}

/**
 * Evaluates a single cell against its column metadata to produce a rich CellState object
 * separating raw, parsed, formatted, missingState, and validationState.
 */
export function evaluateCellState(rawValue, columnMeta, importOptions = {}) {
  const missingMarkers = new Set(importOptions.missingMarkers || DEFAULT_MISSING_MARKERS.MISSING);
  const naMarkers = new Set(importOptions.notApplicableMarkers || DEFAULT_MISSING_MARKERS.NOT_APPLICABLE);
  const withheldMarkers = new Set(importOptions.withheldMarkers || DEFAULT_MISSING_MARKERS.WITHHELD);
  const userMarkers = new Set(columnMeta.userMissingMarkers || importOptions.userMissingMarkers || []);

  if (rawValue === null || rawValue === undefined) {
    return {
      raw: null,
      parsed: null,
      formatted: 'NULL',
      missingState: MISSING_STATES.MISSING,
      validationState: 'VALID',
      formula: null,
      isImputed: false
    };
  }

  // Handle Excel formula cell objects { formula, cachedValue, literalValue }
  let formula = null;
  let effectiveRaw = rawValue;
  if (typeof rawValue === 'object' && rawValue !== null && ('formula' in rawValue || 'raw' in rawValue)) {
    formula = rawValue.formula || null;
    if (rawValue.cachedValue !== undefined && rawValue.cachedValue !== null) {
      effectiveRaw = rawValue.cachedValue;
    } else if (rawValue.raw !== undefined) {
      effectiveRaw = rawValue.raw;
    } else {
      return {
        raw: formula ? `=${formula}` : '',
        parsed: null,
        formatted: `[Formula: =${formula}]`,
        missingState: MISSING_STATES.INVALID_PARSE,
        validationState: 'UNAVAILABLE_FORMULA',
        formula,
        isImputed: false
      };
    }
  }

  if (typeof effectiveRaw === 'number' && !Number.isFinite(effectiveRaw)) {
    return {
      raw: String(effectiveRaw),
      parsed: null,
      formatted: String(effectiveRaw),
      missingState: MISSING_STATES.NONFINITE,
      validationState: 'INVALID_NONFINITE',
      formula,
      isImputed: false
    };
  }

  const strVal = String(effectiveRaw);
  const trimmed = strVal.trim();

  if (strVal === '') {
    const treatEmptyAsMissing = importOptions.emptyStringAsMissing !== false;
    return {
      raw: '',
      parsed: treatEmptyAsMissing ? null : '',
      formatted: treatEmptyAsMissing ? '(missing)' : '""',
      missingState: treatEmptyAsMissing ? MISSING_STATES.MISSING : MISSING_STATES.EMPTY_STRING,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  if (userMarkers.has(trimmed) || userMarkers.has(strVal)) {
    return {
      raw: strVal,
      parsed: null,
      formatted: `${strVal} [User Missing]`,
      missingState: MISSING_STATES.USER_MISSING_MARKER,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  if (naMarkers.has(trimmed)) {
    return {
      raw: strVal,
      parsed: null,
      formatted: 'N/A',
      missingState: MISSING_STATES.NOT_APPLICABLE,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  if (withheldMarkers.has(trimmed)) {
    return {
      raw: strVal,
      parsed: null,
      formatted: `[Withheld: ${trimmed}]`,
      missingState: MISSING_STATES.WITHHELD,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  if (missingMarkers.has(trimmed)) {
    if (trimmed === 'NaN' || trimmed === 'nan' || trimmed === 'Infinity' || trimmed === '-Infinity') {
      return {
        raw: strVal,
        parsed: null,
        formatted: trimmed,
        missingState: MISSING_STATES.NONFINITE,
        validationState: 'INVALID_NONFINITE',
        formula,
        isImputed: false
      };
    }
    return {
      raw: strVal,
      parsed: null,
      formatted: `(missing: ${trimmed})`,
      missingState: MISSING_STATES.MISSING,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  const activeType = columnMeta.confirmedType || columnMeta.semanticType || SEMANTIC_TYPES.TEXT;

  if (activeType === SEMANTIC_TYPES.IDENTIFIER) {
    // Always preserve exact raw string including leading zeros
    return {
      raw: strVal,
      parsed: strVal,
      formatted: strVal,
      missingState: MISSING_STATES.PRESENT,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  if (activeType === SEMANTIC_TYPES.INTEGER || activeType === SEMANTIC_TYPES.DECIMAL) {
    const nRes = parseNumericCell(effectiveRaw, {
      decimalSeparator: columnMeta.parsingConvention?.decimalSeparator || importOptions.decimalSeparator || '.',
      thousandsSeparator: columnMeta.parsingConvention?.thousandsSeparator,
      allowLeadingZeroTruncation: Boolean(columnMeta.parsingConvention?.allowLeadingZeroTruncation)
    });
    if (!nRes.valid) {
      return {
        raw: strVal,
        parsed: null,
        formatted: strVal,
        missingState: nRes.nonFinite ? MISSING_STATES.NONFINITE : MISSING_STATES.INVALID_PARSE,
        validationState: nRes.leadingZeroProtected ? 'LEADING_ZERO_PROTECTED' : 'PARSE_ERROR',
        formula,
        isImputed: false
      };
    }
    if (activeType === SEMANTIC_TYPES.INTEGER && !Number.isInteger(nRes.value)) {
      return {
        raw: strVal,
        parsed: nRes.value,
        formatted: String(nRes.value),
        missingState: MISSING_STATES.INVALID_PARSE,
        validationState: 'NON_INTEGER_DECIMAL',
        formula,
        isImputed: false
      };
    }
    const formatted = activeType === SEMANTIC_TYPES.INTEGER
      ? String(Math.trunc(nRes.value))
      : Number(nRes.value.toFixed(4)).toString();
    return {
      raw: strVal,
      parsed: nRes.value,
      formatted,
      missingState: MISSING_STATES.PRESENT,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  if (activeType === SEMANTIC_TYPES.DATE || activeType === SEMANTIC_TYPES.DATETIME) {
    const dateConv = columnMeta.parsingConvention?.dateFormat || importOptions.dateFormat || 'AUTO';
    const dRes = detectDateAmbiguity(strVal);
    if (!dRes.isDateCandidate || !dRes.valid) {
      return {
        raw: strVal,
        parsed: null,
        formatted: strVal,
        missingState: MISSING_STATES.INVALID_PARSE,
        validationState: 'INVALID_DATE',
        formula,
        isImputed: false
      };
    }
    if (dRes.ambiguous && dateConv === 'AUTO') {
      // Do NOT silently coerce ambiguous dates! Keep raw and mark AMBIGUOUS_DATE
      return {
        raw: strVal,
        parsed: strVal,
        formatted: `${strVal} [Ambiguous Date]`,
        missingState: MISSING_STATES.PRESENT,
        validationState: 'AMBIGUOUS_DATE',
        formula,
        isImputed: false
      };
    }
    const iso = dRes.ambiguous
      ? (dateConv === 'DMY' ? dRes.isoIfDMY : dRes.isoIfMDY)
      : dRes.isoValue;
    return {
      raw: strVal,
      parsed: iso,
      formatted: iso,
      missingState: MISSING_STATES.PRESENT,
      validationState: 'VALID',
      formula,
      isImputed: false
    };
  }

  if (activeType === SEMANTIC_TYPES.BOOLEAN) {
    if (/^(?:true|yes|1)$/i.test(trimmed)) {
      return {
        raw: strVal,
        parsed: true,
        formatted: 'true',
        missingState: MISSING_STATES.PRESENT,
        validationState: 'VALID',
        formula,
        isImputed: false
      };
    }
    if (/^(?:false|no|0)$/i.test(trimmed)) {
      return {
        raw: strVal,
        parsed: false,
        formatted: 'false',
        missingState: MISSING_STATES.PRESENT,
        validationState: 'VALID',
        formula,
        isImputed: false
      };
    }
    return {
      raw: strVal,
      parsed: null,
      formatted: strVal,
      missingState: MISSING_STATES.INVALID_PARSE,
      validationState: 'INVALID_BOOLEAN',
      formula,
      isImputed: false
    };
  }

  // Default Text / Categorical / Ordered Categorical
  return {
    raw: strVal,
    parsed: strVal,
    formatted: strVal,
    missingState: MISSING_STATES.PRESENT,
    validationState: 'VALID',
    formula,
    isImputed: false
  };
}

/**
 * Creates a complete, self-contained Dataset object with non-destructive original snapshot.
 */
export function createDataset({
  id,
  title,
  description = '',
  sourceFilename = 'dataset.csv',
  sourceFormat = 'CSV',
  sourceSheet = null,
  columnNames = [],
  rawRows = [],
  importOptions = {},
  columnOverrides = {},
  validationRules = [],
  parsingWarnings = []
}) {
  const datasetId = id || ('ds_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
  const createdAt = new Date().toISOString();

  // Deduplicate or preserve column names with explicit tracking
  const seenNames = new Map();
  const columns = columnNames.map((origName, idx) => {
    const cleanOrig = String(origName ?? `col_${idx + 1}`);
    const count = (seenNames.get(cleanOrig) || 0) + 1;
    seenNames.set(cleanOrig, count);
    const displayName = count > 1 ? `${cleanOrig}_${count}` : cleanOrig;
    const colId = `col_${idx + 1}`;

    const colRawVals = rawRows.map(r => r[idx]);
    const inferred = inferColumnSemanticType(displayName, colRawVals, importOptions);
    const override = columnOverrides[displayName] || columnOverrides[colId] || {};

    return {
      id: colId,
      index: idx,
      displayName: override.displayName || displayName,
      originalName: cleanOrig,
      duplicateHeaderCorrected: count > 1,
      storageType: override.storageType || inferred.storageType,
      semanticType: override.semanticType || inferred.semanticType,
      confirmedType: override.confirmedType || null,
      role: override.role || inferred.role,
      nullability: override.nullability !== undefined ? override.nullability : true,
      unit: override.unit || null,
      allowedCategories: override.allowedCategories || inferred.allowedCategories || null,
      parsingConvention: override.parsingConvention || {
        decimalSeparator: importOptions.decimalSeparator || '.',
        dateFormat: importOptions.dateFormat || 'AUTO'
      },
      validationConstraints: override.validationConstraints || [],
      originalSource: {
        filename: sourceFilename,
        sheet: sourceSheet,
        columnName: cleanOrig
      },
      provenance: ['imported']
    };
  });

  // Build rows with stable internal _rowId and per-cell rich state
  const rows = rawRows.map((rawArr, rIdx) => {
    const rowId = `row_${rIdx + 1}`;
    const cells = {};
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      cells[col.id] = evaluateCellState(rawArr[c], col, importOptions);
    }
    return {
      _rowId: rowId,
      _sourceRowNumber: rIdx + 1,
      _sourceFile: sourceFilename,
      _sourceSheet: sourceSheet,
      _lineage: [rowId],
      cells
    };
  });

  const fingerprint = computeDatasetFingerprint(rawRows, columnNames);

  const workingSnapshot = {
    columns: structuredClone(columns),
    rows: structuredClone(rows)
  };

  const originalSnapshot = {
    columns: structuredClone(columns),
    rows: structuredClone(rows)
  };

  return {
    id: datasetId,
    title: title || sourceFilename,
    description,
    schemaVersion: '1.0.0',
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    sourceMetadata: {
      filename: sourceFilename,
      format: sourceFormat,
      sheet: sourceSheet,
      importOptions: structuredClone(importOptions),
      originalRowCount: rawRows.length,
      originalColCount: columns.length,
      fingerprint,
      parsingWarnings: [...parsingWarnings]
    },
    columns: workingSnapshot.columns,
    rows: workingSnapshot.rows,
    originalSnapshot,
    history: [],
    redoStack: [],
    validationRules: [...validationRules],
    learnedParameters: {}
  };
}

/**
 * Clones working state of a dataset for safe preview or transactional execution.
 */
export function cloneWorkingState(dataset) {
  return {
    columns: structuredClone(dataset.columns),
    rows: structuredClone(dataset.rows),
    learnedParameters: structuredClone(dataset.learnedParameters || {})
  };
}

/**
 * Restores dataset to its exact imported state while clearing history (or pushing onto redoStack).
 */
export function restoreOriginalDataset(dataset) {
  dataset.columns = structuredClone(dataset.originalSnapshot.columns);
  dataset.rows = structuredClone(dataset.originalSnapshot.rows);
  dataset.history = [];
  dataset.redoStack = [];
  dataset.revision += 1;
  dataset.updatedAt = new Date().toISOString();
  return dataset;
}

/**
 * Extracts a simplified plain object matrix for convenience while keeping access to rich cell state.
 */
export function getPlainRowObjects(dataset, useFormatted = false) {
  return dataset.rows.map(row => {
    const obj = { _rowId: row._rowId };
    for (const col of dataset.columns) {
      const cell = row.cells[col.id];
      if (!cell) {
        obj[col.displayName] = null;
      } else if (useFormatted) {
        obj[col.displayName] = cell.formatted;
      } else {
        obj[col.displayName] = cell.missingState === MISSING_STATES.PRESENT ? cell.parsed : null;
      }
    }
    return obj;
  });
}
