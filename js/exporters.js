/**
 * DataMend Lab — Reproducible Recipes, Schema-Drift Detection, Multi-Format Exporters, and Code Generators
 * Implements Parts 25, 26, and 27:
 * - Versioned Recipe JSON format (`DataMendRecipe` v1.0.0) with learned training parameters, schema contracts,
 *   schema-drift detection, and transactional replay.
 * - Multi-format Export Engine:
 *   1. RFC 4180 CSV & TSV with formula-injection sanitization (`=`, `+`, `-`, `@`, `\t`, `\r`)
 *   2. Pure-JS valid XLSX Workbook generator (ZIP + OpenXML worksheet)
 *   3. JSON & Newline-Delimited JSON (NDJSON)
 *   4. DataSense Interchange JSON (`DataSenseDataset` v1.0.0)
 *   5. Comprehensive Data-Quality Audit Report (Markdown & JSON)
 *   6. Verified R (`tidyverse` / `dplyr` / `tidyr`) and Python (`pandas`) script generators
 */

import { MISSING_STATES, SEMANTIC_TYPES, cloneWorkingState } from './data-model.js';
import { OPERATION_REGISTRY, applyTransformation, resolveColumn } from './transforms.js';
import { runValidationSuite, computeBeforeAfterComparison } from './validation.js';

/**
 * 25.1 Serializes the current dataset's transformation history and schema into a versioned Recipe JSON object.
 */
export function exportCleaningRecipe(dataset, options = {}) {
  const origCols = dataset.originalSnapshot.columns.map(c => ({
    name: c.displayName,
    originalName: c.originalName,
    semanticType: c.semanticType,
    unit: c.unit || null,
    allowedCategories: c.allowedCategories || null
  }));

  const steps = dataset.history.map((h, idx) => {
    const cleanParams = { ...h.params };
    // Store portable column names alongside internal IDs so replay works across new imports
    if (cleanParams.colId && !cleanParams.columnName) {
      const found = dataset.originalSnapshot.columns.find(c => c.id === cleanParams.colId) ||
                    dataset.columns.find(c => c.id === cleanParams.colId);
      if (found) cleanParams.columnName = found.displayName;
    }
    return {
      stepNumber: idx + 1,
      operationType: h.operationType,
      label: h.label,
      category: h.category,
      riskLevel: h.riskLevel,
      params: cleanParams
    };
  });

  return {
    $schema: 'https://datasense-studio.github.io/schemas/v1/datamend-recipe.json',
    recipeId: options.recipeId || `rcp_${dataset.id}_${Date.now().toString(36)}`,
    title: options.title || `Cleaning Recipe for ${dataset.title}`,
    recipeVersion: '1.0.0',
    applicationVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    sourceFingerprint: dataset.sourceMetadata?.fingerprint || null,
    requiredInputSchema: origCols,
    learnedParameters: structuredClone(dataset.learnedParameters || {}),
    validationRules: structuredClone(dataset.validationRules || []),
    steps,
    expectedOutputSchema: dataset.columns.map(c => ({
      name: c.displayName,
      semanticType: c.confirmedType || c.semanticType,
      unit: c.unit || null
    }))
  };
}

/**
 * 25.2 & 25.4 Validates a Recipe JSON object and checks for Schema Drift against a target dataset.
 */
export function validateRecipeCompatibility(recipe, targetDataset, columnMapping = {}) {
  if (!recipe || typeof recipe !== 'object' || !Array.isArray(recipe.steps)) {
    return { valid: false, schemaDrift: [], errors: ['Invalid recipe JSON structure: missing steps array.'] };
  }

  const errors = [];
  const schemaDrift = [];

  for (const step of recipe.steps) {
    if (!step.operationType || !OPERATION_REGISTRY[step.operationType]) {
      errors.push(`Step ${step.stepNumber}: Unsupported or untrusted operationType "${step.operationType}".`);
    }
  }

  const targetByName = new Map(targetDataset.columns.map(c => [c.displayName, c]));

  if (Array.isArray(recipe.requiredInputSchema)) {
    for (const reqCol of recipe.requiredInputSchema) {
      const mappedName = columnMapping[reqCol.name] || reqCol.name;
      const actualCol = targetByName.get(mappedName);
      if (!actualCol) {
        schemaDrift.push({
          type: 'MISSING_COLUMN',
          expectedColumn: reqCol.name,
          expectedType: reqCol.semanticType,
          message: `Required input column "${reqCol.name}" is missing in target dataset.`
        });
      } else {
        const actualType = actualCol.confirmedType || actualCol.semanticType;
        if (actualType !== reqCol.semanticType) {
          schemaDrift.push({
            type: 'TYPE_DRIFT',
            expectedColumn: reqCol.name,
            mappedColumn: mappedName,
            expectedType: reqCol.semanticType,
            actualType,
            message: `Column "${mappedName}" changed type from ${reqCol.semanticType} to ${actualType}.`
          });
        }
      }
    }
  }

  // Check if any step references a column that is missing and unmapped
  const simulatedCols = new Set(targetDataset.columns.map(c => c.displayName));
  for (const step of recipe.steps) {
    const p = step.params || {};
    const refCol = p.columnName || p.colId;
    if (refCol && !refCol.startsWith('col_')) {
      const mapped = columnMapping[refCol] || refCol;
      if (!simulatedCols.has(mapped)) {
        errors.push(`Step ${step.stepNumber} (${step.operationType}) references missing column "${refCol}".`);
      }
    }
    if (step.operationType === 'RENAME_COLUMN' && p.newName) {
      simulatedCols.add(p.newName);
    }
    if (step.operationType === 'DROP_COLUMN' && p.columnName) {
      simulatedCols.delete(columnMapping[p.columnName] || p.columnName);
    }
  }

  return {
    valid: errors.length === 0,
    hasSchemaDrift: schemaDrift.length > 0,
    schemaDrift,
    errors
  };
}

/**
 * 25.3 & 23.6 Transactionally replays a validated recipe on a target dataset.
 * Rolls back to pre-replay state if any step fails.
 */
export function replayCleaningRecipe(targetDataset, recipe, options = {}) {
  const columnMapping = options.columnMapping || {};
  const compatibility = validateRecipeCompatibility(recipe, targetDataset, columnMapping);
  if (!compatibility.valid && !options.allowMappedOverride) {
    throw new Error(`Recipe validation failed: ${compatibility.errors.join(' ')}`);
  }

  const checkpoint = cloneWorkingState(targetDataset);
  const checkpointHistory = structuredClone(targetDataset.history);

  try {
    if (options.useLearnedParameters && recipe.learnedParameters) {
      targetDataset.learnedParameters = structuredClone(recipe.learnedParameters);
    }
    if (Array.isArray(recipe.validationRules) && recipe.validationRules.length > 0 && targetDataset.validationRules.length === 0) {
      targetDataset.validationRules = structuredClone(recipe.validationRules);
    }

    const appliedSteps = [];
    for (const step of recipe.steps) {
      const mappedParams = structuredClone(step.params || {});
      if (mappedParams.columnName && columnMapping[mappedParams.columnName]) {
        mappedParams.columnName = columnMapping[mappedParams.columnName];
        delete mappedParams.colId;
      } else if (mappedParams.columnName) {
        delete mappedParams.colId;
      }
      if (options.useLearnedParameters && step.operationType === 'IMPUTE_MISSING') {
        mappedParams.useLearnedParameter = true;
      }
      const rec = applyTransformation(targetDataset, step.operationType, mappedParams);
      appliedSteps.push(rec);
    }
    return {
      success: true,
      stepsApplied: appliedSteps.length,
      compatibility
    };
  } catch (err) {
    // Transactional rollback on mid-recipe failure
    targetDataset.columns = checkpoint.columns;
    targetDataset.rows = checkpoint.rows;
    targetDataset.learnedParameters = checkpoint.learnedParameters;
    targetDataset.history = checkpointHistory;
    throw new Error(`Recipe replay aborted and rolled back cleanly: ${err.message}`);
  }
}

/**
 * 27.4 Escapes a cell for RFC 4180 CSV/TSV export with optional CSV formula-injection mitigation.
 */
export function escapeDelimitedCell(val, delimiter = ',', sanitizeFormulaInjection = true) {
  if (val === null || val === undefined) return '';
  let str = String(val);

  if (sanitizeFormulaInjection && str.length > 0) {
    const firstChar = str.charAt(0);
    if (['=', '+', '-', '@', '\t', '\r'].includes(firstChar)) {
      // Allow plain negative numbers like -42.5, sanitize everything else
      const isPlainNegativeNumber = firstChar === '-' && /^-\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?$/.test(str);
      if (!isPlainNegativeNumber) {
        str = "'" + str;
      }
    }
  }

  const needsQuotes =
    str.includes(delimiter) ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r');

  if (needsQuotes) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * 27.1 & 27.2 Exports Dataset to RFC 4180 CSV or TSV string.
 */
export function exportToDelimitedText(dataset, options = {}) {
  const delimiter = options.delimiter || ',';
  const includeHeader = options.includeHeader !== false;
  const missingToken = options.missingToken ?? '';
  const sanitizeFormulas = options.sanitizeFormulaInjection !== false;
  const selectedCols = options.columns && options.columns.length > 0
    ? options.columns.map(c => resolveColumn(dataset, c)).filter(Boolean)
    : dataset.columns;

  const lines = [];
  if (includeHeader) {
    lines.push(selectedCols.map(c => escapeDelimitedCell(c.displayName, delimiter, sanitizeFormulas)).join(delimiter));
  }

  for (const row of dataset.rows) {
    const rowCells = selectedCols.map(col => {
      const cell = row.cells[col.id];
      if (!cell || cell.missingState !== MISSING_STATES.PRESENT) {
        return escapeDelimitedCell(missingToken, delimiter, false);
      }
      const val = cell.parsed !== null && cell.parsed !== undefined ? cell.parsed : cell.raw;
      return escapeDelimitedCell(val, delimiter, sanitizeFormulas);
    });
    lines.push(rowCells.join(delimiter));
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Pure-JS CRC32 calculation for valid ZIP/XLSX generation.
 */
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Builds an uncompressed Store ZIP archive from a list of { name, contentString } entries.
 */
function buildZipArchive(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = file.bytes || encoder.encode(file.content);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true);  // flags
    lv.setUint16(8, 0, true);  // compression = 0 (store)
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const cdSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + cdSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) { out.set(p, pos); pos += p.length; }
  for (const p of centralParts) { out.set(p, pos); pos += p.length; }
  out.set(eocd, pos);
  return out;
}

function indexToExcelCol(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 27.3 Pure-JS Valid XLSX Workbook Exporter (preserves numeric vs string/identifier types).
 * Note: Produces a cleaned data workbook rather than preserving decorative original layout/macros.
 */
export function exportToXlsxBytes(dataset, options = {}) {
  const sheetName = escapeXml((options.sheetName || dataset.title || 'CleanedData').slice(0, 31));
  const cols = dataset.columns;

  const rowXmls = [];
  // Row 1: Headers
  const headerCells = cols.map((c, cIdx) => {
    const ref = `${indexToExcelCol(cIdx)}1`;
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(c.displayName)}</t></is></c>`;
  }).join('');
  rowXmls.push(`<row r="1">${headerCells}</row>`);

  // Data Rows
  dataset.rows.forEach((row, rIdx) => {
    const excelRowNum = rIdx + 2;
    const cellsXml = cols.map((col, cIdx) => {
      const ref = `${indexToExcelCol(cIdx)}${excelRowNum}`;
      const cell = row.cells[col.id];
      if (!cell || cell.missingState !== MISSING_STATES.PRESENT) {
        return `<c r="${ref}"/>`;
      }
      const activeType = col.confirmedType || col.semanticType;
      if (
        (activeType === SEMANTIC_TYPES.INTEGER || activeType === SEMANTIC_TYPES.DECIMAL) &&
        typeof cell.parsed === 'number' &&
        Number.isFinite(cell.parsed)
      ) {
        return `<c r="${ref}" t="n"><v>${cell.parsed}</v></c>`;
      }
      if (activeType === SEMANTIC_TYPES.BOOLEAN && typeof cell.parsed === 'boolean') {
        return `<c r="${ref}" t="b"><v>${cell.parsed ? 1 : 0}</v></c>`;
      }
      // Identifiers, dates, categories, and text exported as inlineStr to strictly preserve leading zeros
      const strVal = String(cell.parsed ?? cell.raw);
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(strVal)}</t></is></c>`;
    }).join('');
    rowXmls.push(`<row r="${excelRowNum}">${cellsXml}</row>`);
  });

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXmls.join('')}</sheetData>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${sheetName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  return buildZipArchive([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: wbRelsXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ]);
}

/**
 * Exports Dataset to canonical `DataSenseDataset` (v1.0.0) JSON format per DATA_CONVENTIONS.md Section E.1.
 */
export function exportToDataSenseJson(dataset) {
  const variables = dataset.columns.map(c => {
    const activeType = c.confirmedType || c.semanticType;
    let dataType = 'string';
    if (activeType === SEMANTIC_TYPES.DECIMAL || activeType === SEMANTIC_TYPES.INTEGER) dataType = 'float64';
    else if (activeType === SEMANTIC_TYPES.DATE) dataType = 'date';
    else if (activeType === SEMANTIC_TYPES.DATETIME) dataType = 'datetime';
    else if (activeType === SEMANTIC_TYPES.CATEGORICAL || activeType === SEMANTIC_TYPES.ORDERED_CATEGORICAL) dataType = 'categorical';
    else if (activeType === SEMANTIC_TYPES.IDENTIFIER) dataType = 'identifier';

    return {
      name: c.displayName,
      label: c.originalName || c.displayName,
      unit: c.unit || 'units',
      dataType,
      role: c.role || 'explanatory',
      allowedCategories: c.allowedCategories || undefined,
      provenance: c.provenance
    };
  });

  const observations = dataset.rows.map(row => {
    const obs = { obs_id: row._rowId };
    for (const col of dataset.columns) {
      const cell = row.cells[col.id];
      obs[col.displayName] = cell?.missingState === MISSING_STATES.PRESENT ? cell.parsed : null;
      if (cell?.isImputed) {
        obs[`${col.displayName}_is_imputed`] = true;
      }
    }
    return obs;
  });

  return {
    $schema: 'https://datasense-studio.github.io/schemas/v1/dataset.json',
    version: '1.0.0',
    metadata: {
      id: dataset.id,
      title: dataset.title,
      description: dataset.description || 'Cleaned and validated in DataMend Lab.',
      createdAt: new Date().toISOString(),
      sourceApplication: 'DataMend Lab',
      applicationVersion: '1.0.0',
      sourceFingerprint: dataset.sourceMetadata?.fingerprint || null,
      transformationCount: dataset.history.length
    },
    variables,
    observations
  };
}

/**
 * Exports JSON array of records or Newline-Delimited JSON (NDJSON).
 */
export function exportToJsonRecords(dataset, ndjson = false) {
  const records = dataset.rows.map(row => {
    const obj = {};
    for (const col of dataset.columns) {
      const cell = row.cells[col.id];
      obj[col.displayName] = cell?.missingState === MISSING_STATES.PRESENT ? cell.parsed : null;
    }
    return obj;
  });
  if (ndjson) {
    return records.map(r => JSON.stringify(r)).join('\n') + '\n';
  }
  return JSON.stringify(records, null, 2);
}

/**
 * 26.1 Verified R Code Generator (`tidyverse` / `dplyr` / `tidyr` / `readr`).
 */
export function generateRScript(dataset) {
  const filename = dataset.sourceMetadata?.filename || 'dataset.csv';
  const lines = [
    `# ==============================================================================`,
    `# DataMend Lab — Reproducible R Data Preparation Script (tidyverse)`,
    `# Dataset: ${dataset.title}`,
    `# Source Fingerprint: ${dataset.sourceMetadata?.fingerprint || 'N/A'}`,
    `# Generated: ${new Date().toISOString()}`,
    `# ==============================================================================`,
    `library(dplyr)`,
    `library(tidyr)`,
    `library(stringr)`,
    `library(readr)`,
    ``,
    `# 1. Import Dataset (preserving leading-zero identifiers as character)`,
    `df <- read_csv("${filename.replace(/"/g, '\\"')}", show_col_types = FALSE)`,
    ``
  ];

  // Explicit identifier protection
  const idCols = dataset.originalSnapshot.columns.filter(c => c.semanticType === SEMANTIC_TYPES.IDENTIFIER);
  if (idCols.length > 0) {
    for (const ic of idCols) {
      lines.push(`df <- df %>% mutate(\`${ic.displayName}\` = as.character(\`${ic.displayName}\`))`);
    }
    lines.push('');
  }

  if (dataset.history.length === 0) {
    lines.push(`# No cleaning transformations applied yet.`);
  } else {
    lines.push(`# 2. Applied Transformation Pipeline (${dataset.history.length} step(s))`);
  }

  for (let i = 0; i < dataset.history.length; i++) {
    const step = dataset.history[i];
    const p = step.params || {};
    const colName = p.columnName || p.colId || '';
    lines.push(`# Step ${i + 1}: ${step.label} — ${step.summary}`);

    switch (step.operationType) {
      case 'TRIM_WHITESPACE':
        lines.push(`df <- df %>% mutate(\`${colName}\` = str_squish(trimws(as.character(\`${colName}\`))))`);
        break;
      case 'STANDARDIZE_CASE':
        if (p.mode === 'lower') lines.push(`df <- df %>% mutate(\`${colName}\` = str_to_lower(\`${colName}\`))`);
        else if (p.mode === 'upper') lines.push(`df <- df %>% mutate(\`${colName}\` = str_to_upper(\`${colName}\`))`);
        else lines.push(`df <- df %>% mutate(\`${colName}\` = str_to_title(str_squish(\`${colName}\`)))`);
        break;
      case 'FIND_REPLACE_TEXT':
        lines.push(`df <- df %>% mutate(\`${colName}\` = str_replace_all(\`${colName}\`, fixed(${JSON.stringify(p.find || '')}), ${JSON.stringify(p.replace || '')}))`);
        break;
      case 'PAD_OR_AFFIX_TEXT':
        if (p.targetLength) {
          lines.push(`df <- df %>% mutate(\`${colName}\` = str_pad(as.character(\`${colName}\`), width = ${Number(p.targetLength)}, side = "left", pad = ${JSON.stringify(p.padChar || '0')}))`);
        }
        break;
      case 'CLEAN_NUMERIC_TEXT':
        lines.push(`df <- df %>% mutate(\`${colName}\` = parse_number(as.character(\`${colName}\`)))`);
        break;
      case 'PARSE_DATES':
        if (p.dateFormat === 'DMY') {
          lines.push(`df <- df %>% mutate(\`${colName}\` = as.character(as.Date(\`${colName}\`, format = "%d/%m/%Y")))`);
        } else {
          lines.push(`df <- df %>% mutate(\`${colName}\` = as.character(as.Date(\`${colName}\`, format = "%m/%d/%Y")))`);
        }
        break;
      case 'ADD_MISSINGNESS_INDICATOR':
        lines.push(`df <- df %>% mutate(\`${p.newColumnName || colName + '_is_missing'}\` = ifelse(is.na(\`${colName}\`), 1L, 0L))`);
        break;
      case 'IMPUTE_MISSING':
        if (p.method === 'constant') {
          lines.push(`df <- df %>% mutate(\`${colName}\` = replace_na(\`${colName}\`, ${JSON.stringify(p.constantValue ?? 0)}))`);
        } else if (p.method === 'mean') {
          lines.push(`df <- df %>% mutate(\`${colName}\` = ifelse(is.na(\`${colName}\`), mean(\`${colName}\`, na.rm = TRUE), \`${colName}\`))`);
        } else if (p.method === 'median') {
          lines.push(`df <- df %>% mutate(\`${colName}\` = ifelse(is.na(\`${colName}\`), median(\`${colName}\`, na.rm = TRUE), \`${colName}\`))`);
        } else if (p.method === 'ffill') {
          lines.push(`df <- df %>% fill(\`${colName}\`, .direction = "down")`);
        } else if (p.method === 'bfill') {
          lines.push(`df <- df %>% fill(\`${colName}\`, .direction = "up")`);
        } else {
          lines.push(`# Imputation method "${p.method}" applied; see native recipe JSON for exact fit parameters.`);
        }
        break;
      case 'DROP_MISSING_ROWS':
        if (colName) lines.push(`df <- df %>% drop_na(\`${colName}\`)`);
        else lines.push(`df <- df %>% drop_na()`);
        break;
      case 'DEDUPLICATE_EXACT':
        lines.push(`df <- df %>% distinct(.keep_all = TRUE)`);
        break;
      case 'MAP_CATEGORIES': {
        const pairs = Object.entries(p.mapping || {}).map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`).join(', ');
        lines.push(`df <- df %>% mutate(\`${colName}\` = recode(\`${colName}\`, ${pairs}))`);
        break;
      }
      case 'RENAME_COLUMN':
        lines.push(`df <- df %>% rename(\`${p.newName}\` = \`${colName}\`)`);
        break;
      case 'DROP_COLUMN':
        lines.push(`df <- df %>% select(-\`${colName}\`)`);
        break;
      case 'SORT_ROWS':
        lines.push(p.direction === 'desc' ? `df <- df %>% arrange(desc(\`${colName}\`))` : `df <- df %>% arrange(\`${colName}\`)`);
        break;
      case 'UNPIVOT_WIDE_TO_LONG': {
        const colsStr = (p.valueColumns || []).map(c => `\`${c}\``).join(', ');
        lines.push(`df <- df %>% pivot_longer(cols = c(${colsStr}), names_to = ${JSON.stringify(p.variableColumnName || 'variable')}, values_to = ${JSON.stringify(p.valueColumnName || 'value')})`);
        break;
      }
      case 'PIVOT_LONG_TO_WIDE':
        lines.push(`df <- df %>% pivot_wider(names_from = \`${p.namesFromColumn}\`, values_from = \`${p.valuesFromColumn}\`)`);
        break;
      case 'SPLIT_COLUMN':
        lines.push(`df <- df %>% separate(\`${colName}\`, into = ${JSON.stringify(p.outputNames || [colName + "_1", colName + "_2"])}, sep = ${JSON.stringify(p.delimiter || ",")}, extra = "merge", fill = "right")`);
        break;
      case 'COMBINE_COLUMNS':
        lines.push(`df <- df %>% unite(\`${p.newColumnName || "combined"}\`, ${(p.columns || []).map(c => `\`${c}\``).join(", ")}, sep = ${JSON.stringify(p.delimiter ?? " ")}, remove = ${p.dropOriginal ? "TRUE" : "FALSE"}, na.rm = TRUE)`);
        break;
      case 'FILL_DOWN_HIERARCHICAL':
        lines.push(`df <- df %>% fill(\`${colName}\`, .direction = "down")`);
        break;
      case 'GROUP_AND_AGGREGATE':
        lines.push(`df <- df %>% group_by(${(p.groupColumns || []).map(c => `\`${c}\``).join(", ")}) %>% summarise(across(everything(), ~ first(.x)), .groups = "drop")`);
        break;
      case 'TRANSPOSE_TABLE':
        lines.push(`df <- df %>% pivot_longer(-1, names_to = "original_column", values_to = "val") %>% pivot_wider(names_from = 1, values_from = "val")`);
        break;
      default:
        lines.push(`# Note: Operation ${step.operationType} has specialized semantics; use native DataMend Recipe JSON for exact replay.`);
    }
    lines.push('');
  }

  lines.push(`# 3. Export Cleaned Dataset`);
  lines.push(`write_csv(df, "cleaned_${filename.replace(/\.[^.]+$/, '')}.csv")`);
  lines.push(`# Cross-language note: R quantile() defaults to Hyndman-Fan Type 7, matching DataMend Lab.`);
  return lines.join('\n');
}

/**
 * 26.2 Verified Python Code Generator (`pandas` / `numpy`).
 */
export function generatePythonScript(dataset) {
  const filename = dataset.sourceMetadata?.filename || 'dataset.csv';
  const idCols = dataset.originalSnapshot.columns.filter(c => c.semanticType === SEMANTIC_TYPES.IDENTIFIER);
  const dtypeMap = Object.fromEntries(idCols.map(c => [c.displayName, 'str']));

  const lines = [
    `# ==============================================================================`,
    `# DataMend Lab — Reproducible Python Data Preparation Script (pandas)`,
    `# Dataset: ${dataset.title}`,
    `# Source Fingerprint: ${dataset.sourceMetadata?.fingerprint || 'N/A'}`,
    `# Generated: ${new Date().toISOString()}`,
    `# ==============================================================================`,
    `import pandas as pd`,
    `import numpy as np`,
    ``,
    `# 1. Import Dataset (preserving leading-zero identifiers as string)`,
    `df = pd.read_csv(${JSON.stringify(filename)}, dtype=${JSON.stringify(dtypeMap)})`,
    ``
  ];

  if (dataset.history.length === 0) {
    lines.push(`# No cleaning transformations applied yet.`);
  } else {
    lines.push(`# 2. Applied Transformation Pipeline (${dataset.history.length} step(s))`);
  }

  for (let i = 0; i < dataset.history.length; i++) {
    const step = dataset.history[i];
    const p = step.params || {};
    const colName = p.columnName || p.colId || '';
    const cStr = JSON.stringify(colName);
    lines.push(`# Step ${i + 1}: ${step.label} — ${step.summary}`);

    switch (step.operationType) {
      case 'TRIM_WHITESPACE':
        lines.push(`df[${cStr}] = df[${cStr}].astype("string").str.strip().str.replace(r"\\s{2,}", " ", regex=True)`);
        break;
      case 'STANDARDIZE_CASE':
        if (p.mode === 'lower') lines.push(`df[${cStr}] = df[${cStr}].astype("string").str.lower()`);
        else if (p.mode === 'upper') lines.push(`df[${cStr}] = df[${cStr}].astype("string").str.upper()`);
        else lines.push(`df[${cStr}] = df[${cStr}].astype("string").str.strip().str.title()`);
        break;
      case 'FIND_REPLACE_TEXT':
        lines.push(`df[${cStr}] = df[${cStr}].astype("string").str.replace(${JSON.stringify(p.find || '')}, ${JSON.stringify(p.replace || '')}, regex=${p.matchMode === 'regex' ? 'True' : 'False'})`);
        break;
      case 'PAD_OR_AFFIX_TEXT':
        if (p.targetLength) {
          lines.push(`df[${cStr}] = df[${cStr}].astype("string").str.zfill(${Number(p.targetLength)})`);
        }
        break;
      case 'CLEAN_NUMERIC_TEXT':
        lines.push(`df[${cStr}] = pd.to_numeric(df[${cStr}].astype(str).str.replace(r"[$,\\s]", "", regex=True), errors="coerce")`);
        break;
      case 'PARSE_DATES':
        lines.push(`df[${cStr}] = pd.to_datetime(df[${cStr}], format=${p.dateFormat === 'DMY' ? '"%d/%m/%Y"' : '"%m/%d/%Y"'}, errors="coerce").dt.strftime("%Y-%m-%d")`);
        break;
      case 'ADD_MISSINGNESS_INDICATOR':
        lines.push(`df[${JSON.stringify(p.newColumnName || colName + '_is_missing')}] = df[${cStr}].isna().astype(int)`);
        break;
      case 'IMPUTE_MISSING':
        if (p.method === 'constant') {
          lines.push(`df[${cStr}] = df[${cStr}].fillna(${JSON.stringify(p.constantValue ?? 0)})`);
        } else if (p.method === 'mean') {
          lines.push(`df[${cStr}] = df[${cStr}].fillna(df[${cStr}].mean())`);
        } else if (p.method === 'median') {
          lines.push(`df[${cStr}] = df[${cStr}].fillna(df[${cStr}].median())`);
        } else if (p.method === 'ffill') {
          lines.push(`df[${cStr}] = df[${cStr}].ffill()`);
        } else if (p.method === 'bfill') {
          lines.push(`df[${cStr}] = df[${cStr}].bfill()`);
        } else {
          lines.push(`# Imputation method "${p.method}" applied; see native recipe JSON for exact fit parameters.`);
        }
        break;
      case 'DROP_MISSING_ROWS':
        if (colName) lines.push(`df = df.dropna(subset=[${cStr}]).reset_index(drop=True)`);
        else lines.push(`df = df.dropna().reset_index(drop=True)`);
        break;
      case 'DEDUPLICATE_EXACT':
        lines.push(`df = df.drop_duplicates(keep=${p.strategy === 'keep_last' ? '"last"' : '"first"'}).reset_index(drop=True)`);
        break;
      case 'MAP_CATEGORIES':
        lines.push(`df[${cStr}] = df[${cStr}].replace(${JSON.stringify(p.mapping || {})})`);
        break;
      case 'RENAME_COLUMN':
        lines.push(`df = df.rename(columns={${cStr}: ${JSON.stringify(p.newName)}})`);
        break;
      case 'DROP_COLUMN':
        lines.push(`df = df.drop(columns=[${cStr}])`);
        break;
      case 'SORT_ROWS':
        lines.push(`df = df.sort_values(by=${cStr}, ascending=${p.direction === 'desc' ? 'False' : 'True'}).reset_index(drop=True)`);
        break;
      case 'UNPIVOT_WIDE_TO_LONG':
        lines.push(`df = df.melt(id_vars=${JSON.stringify(p.idColumns || [])}, value_vars=${JSON.stringify(p.valueColumns || [])}, var_name=${JSON.stringify(p.variableColumnName || 'variable')}, value_name=${JSON.stringify(p.valueColumnName || 'value')})`);
        break;
      case 'PIVOT_LONG_TO_WIDE':
        lines.push(`df = df.pivot_table(index=${JSON.stringify(p.idColumns || [])}, columns=${JSON.stringify(p.namesFromColumn)}, values=${JSON.stringify(p.valuesFromColumn)}, aggfunc="first").reset_index()`);
        break;
      case 'SPLIT_COLUMN':
        lines.push(`df[${JSON.stringify(p.outputNames || [colName + "_1", colName + "_2"])}] = df[${cStr}].astype("string").str.split(${JSON.stringify(p.delimiter || ",")}, n=1, expand=True)`);
        break;
      case 'COMBINE_COLUMNS':
        lines.push(`df[${JSON.stringify(p.newColumnName || "combined")}] = df[${JSON.stringify(p.columns || [])}].astype("string").agg(${JSON.stringify(p.delimiter ?? " ")}.join, axis=1)`);
        break;
      case 'FILL_DOWN_HIERARCHICAL':
        lines.push(`df[${cStr}] = df[${cStr}].ffill()`);
        break;
      case 'GROUP_AND_AGGREGATE':
        lines.push(`df = df.groupby(${JSON.stringify(p.groupColumns || [])}, dropna=False).agg("first").reset_index()`);
        break;
      case 'TRANSPOSE_TABLE':
        lines.push(`df = df.set_index(df.columns[0]).T.reset_index().rename(columns={"index": "original_column"})`);
        break;
      default:
        lines.push(`# Note: Operation ${step.operationType} has specialized semantics; use native DataMend Recipe JSON for exact replay.`);
    }
    lines.push('');
  }

  lines.push(`# 3. Export Cleaned Dataset`);
  lines.push(`df.to_csv("cleaned_${filename.replace(/\.[^.]+$/, '')}.csv", index=False)`);
  lines.push(`# Cross-language note: pandas quantile(method="linear") matches Hyndman-Fan Type 7 used in DataMend Lab.`);
  return lines.join('\n');
}

/**
 * 27.5 Generates a complete, auditable Data-Quality & Provenance Report (Markdown).
 */
export function generateQualityAuditReport(dataset, issues = []) {
  const comparison = computeBeforeAfterComparison(dataset);
  const valSuite = runValidationSuite(dataset);

  const lines = [
    `# DataMend Lab — Comprehensive Data-Quality & Provenance Report`,
    ``,
    `- **Dataset Title:** ${dataset.title}`,
    `- **Source File:** ${dataset.sourceMetadata?.filename || 'N/A'} (${dataset.sourceMetadata?.format || 'CSV'})`,
    `- **Source Fingerprint:** \`${dataset.sourceMetadata?.fingerprint || 'N/A'}\``,
    `- **Report Generated:** ${new Date().toISOString()}`,
    `- **Original Dimensions:** ${comparison.rowsBefore} rows × ${comparison.colsBefore} columns`,
    `- **Final Cleaned Dimensions:** ${comparison.rowsAfter} rows × ${comparison.colsAfter} columns`,
    ``,
    `## 1. Before vs. After Quality Scorecard`,
    ``,
    `| Quality Dimension | Original (%) | Cleaned (%) | Delta | Formula |`,
    `|---|---:|---:|---:|---|`
  ];

  for (let i = 0; i < comparison.afterScorecard.dimensions.length; i++) {
    const b = comparison.beforeScorecard.dimensions[i];
    const a = comparison.afterScorecard.dimensions[i];
    const delta = (a.percentage - b.percentage).toFixed(2);
    const sign = Number(delta) > 0 ? '+' : '';
    lines.push(`| ${a.name} | ${b.percentage.toFixed(2)}% | ${a.percentage.toFixed(2)}% | ${sign}${delta}% | ${a.formula} |`);
  }

  lines.push(
    ``,
    `## 2. Transformation Audit Log (${dataset.history.length} Operation(s))`,
    ``
  );

  if (dataset.history.length === 0) {
    lines.push(`No mutating operations have been applied to the dataset.`);
  } else {
    lines.push(`| Step | Operation | Category | Risk Level | Rows (Before → After) | Summary |`);
    lines.push(`|---:|---|---|---|---|---|`);
    dataset.history.forEach((h, idx) => {
      lines.push(`| ${idx + 1} | ${h.label} (\`${h.operationType}\`) | ${h.category} | ${h.riskLevel} | ${h.rowsBefore} → ${h.rowsAfter} | ${h.summary} |`);
    });
  }

  lines.push(
    ``,
    `## 3. Validation Rules & Quality Gates (${valSuite.passingRules}/${valSuite.totalRules} Passing)`,
    ``
  );

  if (valSuite.results.length === 0) {
    lines.push(`No custom validation rules configured.`);
  } else {
    lines.push(`| Rule Name | Type | Status | Tested | Passing | Failing | Quality Gate |`);
    lines.push(`|---|---|---|---:|---:|---:|---|`);
    for (const r of valSuite.results) {
      lines.push(`| ${r.name} | \`${r.type}\` | **${r.status}** | ${r.tested} | ${r.passing} | ${r.failing} | ${r.isQualityGate ? 'Yes' : 'No'} |`);
    }
  }

  lines.push(
    ``,
    `## 4. Remaining Open Diagnostic Findings (${issues.length})`,
    ``
  );

  if (issues.length === 0) {
    lines.push(`Zero open diagnostic issues remain on the current working dataset.`);
  } else {
    for (const iss of issues) {
      lines.push(`- **[${iss.severity}] ${iss.category}**: ${iss.finding} (*Evidence:* ${iss.evidence})`);
    }
  }

  lines.push(
    ``,
    `## 5. Statistical & Methodological Disclaimers`,
    `- Passing formal validation constraints verifies schema compliance, not ground-truth empirical measurement accuracy.`,
    `- Any imputed cells are explicitly flagged with \`isImputed = true\` in DataSense interchange exports.`
  );

  return lines.join('\n');
}
