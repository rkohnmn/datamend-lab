/**
 * DataMend Lab — Transformation Engine & Operation Registry
 * Implements Parts 11, 12, 13, 14, 15, 16, 17, and 23.
 *
 * Key Guarantees:
 * - Never uses dynamic-eval or Function() for expressions or regular expressions.
 * - Safe Regex validator prevents catastrophic backtracking (ReDoS).
 * - Safe AST mathematical/logical expression evaluator for calculated columns & filters.
 * - Preserves original values in dataset.originalSnapshot; every step is recorded on dataset.history
 *   with full cell-level and structural impact summaries, supporting deterministic Undo & Redo.
 * - Supports explicit training-only fit/transform parameters for imputation to prevent data leakage (Part 13.5).
 */

import {
  MISSING_STATES,
  SEMANTIC_TYPES,
  evaluateCellState,
  detectDateAmbiguity,
  parseNumericCell,
  cloneWorkingState
} from './data-model.js';
import { computeNumericStats, quantileType7 } from './profiler.js';
import { RISK_LEVELS, editDistance } from './diagnosis.js';

/**
 * Validates that a user-supplied regular expression pattern does not contain nested quantifiers
 * that can cause catastrophic ReDoS freezes in the browser.
 */
export function validateSafeRegex(pattern, flags = 'g') {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { valid: false, reason: 'Pattern must be a non-empty string.' };
  }
  if (pattern.length > 250) {
    return { valid: false, reason: 'Pattern exceeds maximum safe length (250 characters).' };
  }
  // Reject nested quantifiers such as (a+)+, (.*)*, (\w+)+
  if (/\([^()]*[+*?][^()]*\)[+*?{]/.test(pattern)) {
    return {
      valid: false,
      reason: 'Pattern contains nested quantifiers that risk catastrophic backtracking (ReDoS).'
    };
  }
  try {
    const rx = new RegExp(pattern, flags);
    return { valid: true, regex: rx };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

/**
 * Validated Unit Conversion Registry (Part 12.4).
 */
export const UNIT_CONVERSION_REGISTRY = Object.freeze({
  // Mass -> kg
  'g->kg': v => v / 1000,
  'kg->kg': v => v,
  'lb->kg': v => v * 0.45359237,
  'lbs->kg': v => v * 0.45359237,
  'kg->lb': v => v / 0.45359237,
  'kg->g': v => v * 1000,
  // Length -> cm or m
  'mm->cm': v => v / 10,
  'cm->cm': v => v,
  'm->cm': v => v * 100,
  'in->cm': v => v * 2.54,
  'inch->cm': v => v * 2.54,
  'inches->cm': v => v * 2.54,
  'ft->cm': v => v * 30.48,
  'cm->m': v => v / 100,
  'in->m': v => v * 0.0254,
  // Temperature -> C or F
  'c->c': v => v,
  '°c->c': v => v,
  'f->c': v => (v - 32) * (5 / 9),
  '°f->c': v => (v - 32) * (5 / 9),
  'c->f': v => v * (9 / 5) + 32,
  '°c->f': v => v * (9 / 5) + 32
});

/**
 * Safe Typed Expression Parser & Evaluator (Part 17.1).
 * Supports column references `[col_name]` or bare identifier names, numeric & string literals,
 * arithmetic (+, -, *, /, %), comparisons (==, !=, <, <=, >, >=), logical (&&, ||),
 * and safe functions: ABS, ROUND, SQRT, LOG, LN, EXP, COALESCE, IF, LOWER, UPPER, LEN.
 * Strictly zero dynamic-eval or Function() usage.
 */
export function evaluateSafeExpression(exprStr, rowContext) {
  const tokens = tokenizeExpression(exprStr);
  let pos = 0;

  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseLogicalOr() {
    let left = parseLogicalAnd();
    while (peek() && peek().type === 'OP' && peek().value === '||') {
      consume();
      const right = parseLogicalAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  function parseLogicalAnd() {
    let left = parseComparison();
    while (peek() && peek().type === 'OP' && peek().value === '&&') {
      consume();
      const right = parseComparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  function parseComparison() {
    let left = parseAdditive();
    while (peek() && peek().type === 'OP' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().value)) {
      const op = consume().value;
      const right = parseAdditive();
      if (op === '==') left = left == right;
      else if (op === '!=') left = left != right;
      else if (op === '<') left = left !== null && right !== null && left < right;
      else if (op === '<=') left = left !== null && right !== null && left <= right;
      else if (op === '>') left = left !== null && right !== null && left > right;
      else if (op === '>=') left = left !== null && right !== null && left >= right;
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek() && peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseMultiplicative();
      if (left === null || right === null) {
        left = null;
      } else if (op === '+') {
        left = (typeof left === 'number' && typeof right === 'number') ? left + right : String(left) + String(right);
      } else {
        left = Number(left) - Number(right);
      }
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (peek() && peek().type === 'OP' && ['*', '/', '%'].includes(peek().value)) {
      const op = consume().value;
      const right = parseUnary();
      if (left === null || right === null) {
        left = null;
      } else if (op === '*') {
        left = Number(left) * Number(right);
      } else if (op === '/') {
        left = Number(right) === 0 ? null : Number(left) / Number(right);
      } else {
        left = Number(right) === 0 ? null : Number(left) % Number(right);
      }
    }
    return left;
  }

  function parseUnary() {
    if (peek() && peek().type === 'OP' && (peek().value === '-' || peek().value === '+' || peek().value === '!')) {
      const op = consume().value;
      const val = parseUnary();
      if (op === '!') return !val;
      if (val === null) return null;
      return op === '-' ? -Number(val) : +Number(val);
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const tok = consume();
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.type === 'NUMBER' || tok.type === 'STRING' || tok.type === 'NULL' || tok.type === 'BOOLEAN') {
      return tok.value;
    }
    if (tok.type === 'COL_REF') {
      return rowContext[tok.value] !== undefined ? rowContext[tok.value] : null;
    }
    if (tok.type === 'IDENT') {
      if (peek() && peek().type === 'LPAREN') {
        consume(); // '('
        const args = [];
        if (peek() && peek().type !== 'RPAREN') {
          args.push(parseLogicalOr());
          while (peek() && peek().type === 'COMMA') {
            consume();
            args.push(parseLogicalOr());
          }
        }
        if (!peek() || consume().type !== 'RPAREN') {
          throw new Error(`Missing closing parenthesis in call to ${tok.value}`);
        }
        return invokeSafeFunction(tok.value.toUpperCase(), args);
      }
      return rowContext[tok.value] !== undefined ? rowContext[tok.value] : null;
    }
    if (tok.type === 'LPAREN') {
      const val = parseLogicalOr();
      if (!peek() || consume().type !== 'RPAREN') {
        throw new Error('Missing closing parenthesis');
      }
      return val;
    }
    throw new Error(`Unexpected token ${tok.value}`);
  }

  const result = parseLogicalOr();
  if (pos < tokens.length) {
    throw new Error(`Unexpected trailing token: ${tokens[pos].value}`);
  }
  return result;
}

function invokeSafeFunction(fnName, args) {
  switch (fnName) {
    case 'ABS': return args[0] === null ? null : Math.abs(Number(args[0]));
    case 'ROUND': return args[0] === null ? null : Number(Number(args[0]).toFixed(Number(args[1] ?? 0)));
    case 'SQRT': return args[0] === null || Number(args[0]) < 0 ? null : Math.sqrt(Number(args[0]));
    case 'LOG':
    case 'LN': return args[0] === null || Number(args[0]) <= 0 ? null : Math.log(Number(args[0]));
    case 'LOG10': return args[0] === null || Number(args[0]) <= 0 ? null : Math.log10(Number(args[0]));
    case 'EXP': return args[0] === null ? null : Math.exp(Number(args[0]));
    case 'COALESCE': return args.find(a => a !== null && a !== undefined && a !== '') ?? null;
    case 'IF': return args[0] ? args[1] : args[2];
    case 'LOWER': return args[0] === null ? null : String(args[0]).toLowerCase();
    case 'UPPER': return args[0] === null ? null : String(args[0]).toUpperCase();
    case 'LEN': return args[0] === null ? 0 : String(args[0]).length;
    default:
      throw new Error(`Unsupported function "${fnName}" in safe expression evaluator.`);
  }
}

function tokenizeExpression(str) {
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '[') {
      const end = str.indexOf(']', i + 1);
      if (end === -1) throw new Error('Unclosed column bracket [ in expression');
      tokens.push({ type: 'COL_REF', value: str.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let val = '';
      i++;
      while (i < str.length && str[i] !== quote) {
        val += str[i++];
      }
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value: val });
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(str[i + 1] || ''))) {
      let numStr = '';
      while (i < str.length && /[\d.eE+\-]/.test(str[i])) {
        if ((str[i] === '+' || str[i] === '-') && !/[eE]/.test(str[i - 1])) break;
        numStr += str[i++];
      }
      tokens.push({ type: 'NUMBER', value: Number(numStr) });
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue; }

    const twoChar = str.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(twoChar)) {
      tokens.push({ type: 'OP', value: twoChar });
      i += 2;
      continue;
    }
    if (['+', '-', '*', '/', '%', '<', '>', '!'].includes(ch)) {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let ident = '';
      while (i < str.length && /[A-Za-z0-9_.]/.test(str[i])) {
        ident += str[i++];
      }
      if (ident.toLowerCase() === 'null') tokens.push({ type: 'NULL', value: null });
      else if (ident.toLowerCase() === 'true') tokens.push({ type: 'BOOLEAN', value: true });
      else if (ident.toLowerCase() === 'false') tokens.push({ type: 'BOOLEAN', value: false });
      else tokens.push({ type: 'IDENT', value: ident });
      continue;
    }
    throw new Error(`Invalid character "${ch}" in expression`);
  }
  return tokens;
}

/**
 * Helper to resolve a column by colId or displayName.
 */
export function resolveColumn(dataset, colIdOrName) {
  if (!colIdOrName) return null;
  return (
    dataset.columns.find(c => c.id === colIdOrName) ||
    dataset.columns.find(c => c.displayName === colIdOrName) ||
    dataset.columns.find(c => c.originalName === colIdOrName) ||
    null
  );
}

/**
 * Helper to convert text to Title Case cleanly.
 */
function toTitleCase(str) {
  return str
    .toLowerCase()
    .replace(/(?:^|\s|[-/])\S/g, ch => ch.toUpperCase());
}

/**
 * Canonical Operation Registry (Part 23.1).
 * Every operation defines metadata, risk level, parameter contract, and deterministic execution logic.
 */
export const OPERATION_REGISTRY = {
  TRIM_WHITESPACE: {
    id: 'TRIM_WHITESPACE',
    version: '1.0.0',
    category: 'Text Cleaning',
    label: 'Trim & Normalize Whitespace',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Removes leading/trailing whitespace and optionally collapses repeated internal spaces.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column "${params.colId || params.columnName}" not found.`);
      if ((col.confirmedType || col.semanticType) === SEMANTIC_TYPES.IDENTIFIER && !params.allowOnIdentifier) {
        // Still allow trimming outer spaces on identifiers if requested, but never strip leading zeros!
      }
      const mode = params.mode || 'both'; // 'leading', 'trailing', 'both'
      const normalizeInternal = params.normalizeInternal !== false;
      const cellChanges = [];

      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || typeof cell.raw !== 'string') continue;
        let nextRaw = cell.raw;
        if (mode === 'leading' || mode === 'both') nextRaw = nextRaw.replace(/^\s+/, '');
        if (mode === 'trailing' || mode === 'both') nextRaw = nextRaw.replace(/\s+$/, '');
        if (normalizeInternal) nextRaw = nextRaw.replace(/\s{2,}/g, ' ');
        if (nextRaw !== cell.raw) {
          const oldVal = cell.raw;
          row.cells[col.id] = evaluateCellState(nextRaw, col, dataset.sourceMetadata?.importOptions);
          cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: nextRaw });
        }
      }
      col.provenance.push('trim_whitespace');
      return {
        summary: `Trimmed whitespace in "${col.displayName}" (${cellChanges.length} cell(s) updated).`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  NORMALIZE_UNICODE_CONTROL: {
    id: 'NORMALIZE_UNICODE_CONTROL',
    version: '1.0.0',
    category: 'Text Cleaning',
    label: 'Normalize Unicode & Strip Control Characters',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Normalizes Unicode strings (NFC/NFKC) and removes non-printable ASCII control characters without stripping international accents.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const form = ['NFC', 'NFD', 'NFKC', 'NFKD'].includes(params.unicodeForm) ? params.unicodeForm : 'NFC';
      const stripControl = params.stripControl !== false;
      const normalizeLineEndings = params.normalizeLineEndings !== false;
      const cellChanges = [];

      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || typeof cell.raw !== 'string') continue;
        let next = cell.raw.normalize(form);
        if (normalizeLineEndings) next = next.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (stripControl) next = next.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        if (next !== cell.raw) {
          const oldVal = cell.raw;
          row.cells[col.id] = evaluateCellState(next, col, dataset.sourceMetadata?.importOptions);
          cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: next });
        }
      }
      col.provenance.push(`unicode_${form}`);
      return {
        summary: `Normalized Unicode (${form}) in "${col.displayName}" (${cellChanges.length} cell(s) updated).`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  STANDARDIZE_CASE: {
    id: 'STANDARDIZE_CASE',
    version: '1.0.0',
    category: 'Text Cleaning',
    label: 'Standardize Text Case',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Applies lowercase, UPPERCASE, Title Case, or consolidates variants into the most frequent canonical spelling.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const mode = params.mode || 'title'; // 'lower', 'upper', 'title', 'canonical_most_frequent'
      const cellChanges = [];

      // Precompute most frequent spelling per lowercase key if canonical_most_frequent
      const canonicalMap = new Map();
      if (mode === 'canonical_most_frequent') {
        const counts = new Map();
        for (const row of dataset.rows) {
          const raw = row.cells[col.id]?.raw;
          if (typeof raw === 'string' && raw.trim() !== '') {
            const trimmed = raw.trim().replace(/\s{2,}/g, ' ');
            counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
          }
        }
        const byLower = new Map();
        for (const [spelling, cnt] of counts.entries()) {
          const lk = spelling.toLowerCase();
          if (!byLower.has(lk) || cnt > byLower.get(lk).cnt) {
            byLower.set(lk, { spelling, cnt });
          }
        }
        for (const [lk, best] of byLower.entries()) {
          canonicalMap.set(lk, best.spelling);
        }
      }

      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || typeof cell.raw !== 'string' || cell.missingState !== MISSING_STATES.PRESENT) continue;
        const trimmed = cell.raw.trim().replace(/\s{2,}/g, ' ');
        let next = trimmed;
        if (mode === 'lower') next = trimmed.toLowerCase();
        else if (mode === 'upper') next = trimmed.toUpperCase();
        else if (mode === 'title') next = toTitleCase(trimmed);
        else if (mode === 'canonical_most_frequent') {
          next = canonicalMap.get(trimmed.toLowerCase()) || toTitleCase(trimmed);
        }
        if (next !== cell.raw) {
          const oldVal = cell.raw;
          row.cells[col.id] = evaluateCellState(next, col, dataset.sourceMetadata?.importOptions);
          cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: next });
        }
      }
      col.provenance.push(`case_${mode}`);
      return {
        summary: `Standardized case (${mode}) in "${col.displayName}" (${cellChanges.length} cell(s) updated).`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  FIND_REPLACE_TEXT: {
    id: 'FIND_REPLACE_TEXT',
    version: '1.0.0',
    category: 'Text Cleaning',
    label: 'Find & Replace Text / Pattern',
    riskLevel: RISK_LEVELS.MEDIUM,
    description: 'Replaces exact values, substrings, or validated safe regular expression matches.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const findStr = String(params.find ?? '');
      const replaceStr = String(params.replace ?? '');
      const matchMode = params.matchMode || 'substring'; // 'exact', 'substring', 'regex'
      let rx = null;
      if (matchMode === 'regex') {
        const check = validateSafeRegex(findStr, params.flags || 'g');
        if (!check.valid) throw new Error(`Unsafe or invalid regex: ${check.reason}`);
        rx = check.regex;
      }

      const cellChanges = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || cell.raw === null || cell.raw === undefined) continue;
        const raw = String(cell.raw);
        let next = raw;
        if (matchMode === 'exact') {
          if (raw === findStr) next = replaceStr;
        } else if (matchMode === 'substring') {
          if (findStr.length > 0 && raw.includes(findStr)) {
            next = raw.split(findStr).join(replaceStr);
          }
        } else if (matchMode === 'regex' && rx) {
          next = raw.replace(rx, replaceStr);
        }
        if (next !== raw) {
          row.cells[col.id] = evaluateCellState(next, col, dataset.sourceMetadata?.importOptions);
          cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal: raw, newVal: next });
        }
      }
      col.provenance.push(`replace_${matchMode}`);
      return {
        summary: `Replaced ${cellChanges.length} occurrence(s) in "${col.displayName}".`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  PAD_OR_AFFIX_TEXT: {
    id: 'PAD_OR_AFFIX_TEXT',
    version: '1.0.0',
    category: 'Text Cleaning',
    label: 'Pad Identifier / Add Prefix or Suffix',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Pads strings (e.g., restoring 5-digit ZIP leading zeros) or attaches prefixes/suffixes.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const targetLength = Number(params.targetLength || 0);
      const padChar = String(params.padChar || '0').charAt(0) || '0';
      const prefix = String(params.prefix || '');
      const suffix = String(params.suffix || '');
      const cellChanges = [];

      if (params.treatAsIdentifier) {
        col.semanticType = SEMANTIC_TYPES.IDENTIFIER;
        col.confirmedType = SEMANTIC_TYPES.IDENTIFIER;
      }

      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || cell.missingState !== MISSING_STATES.PRESENT) continue;
        const raw = String(cell.raw);
        let next = raw;
        if (targetLength > 0 && next.length < targetLength) {
          next = next.padStart(targetLength, padChar);
        }
        if (prefix && !next.startsWith(prefix)) next = prefix + next;
        if (suffix && !next.endsWith(suffix)) next = next + suffix;

        if (next !== raw) {
          row.cells[col.id] = evaluateCellState(next, col, dataset.sourceMetadata?.importOptions);
          cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal: raw, newVal: next });
        }
      }
      col.provenance.push('pad_affix');
      return {
        summary: `Updated ${cellChanges.length} value(s) in "${col.displayName}" via padding/affix.`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  CHANGE_COLUMN_TYPE: {
    id: 'CHANGE_COLUMN_TYPE',
    version: '1.0.0',
    category: 'Type & Date Conversion',
    label: 'Convert Column Data Type',
    riskLevel: RISK_LEVELS.MEDIUM,
    description: 'Updates column semantic type and re-evaluates cells without silently dropping failed conversions.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const targetType = params.targetType;
      if (!Object.values(SEMANTIC_TYPES).includes(targetType)) {
        throw new Error(`Unsupported target type "${targetType}".`);
      }

      const oldType = col.confirmedType || col.semanticType;
      col.confirmedType = targetType;
      col.semanticType = targetType;
      if (params.decimalSeparator) {
        col.parsingConvention = { ...col.parsingConvention, decimalSeparator: params.decimalSeparator };
      }
      if (params.dateFormat) {
        col.parsingConvention = { ...col.parsingConvention, dateFormat: params.dateFormat };
      }
      if (params.allowedCategories) {
        col.allowedCategories = [...params.allowedCategories];
      }

      let failedConversions = 0;
      const cellChanges = [];
      for (const row of dataset.rows) {
        const prevCell = row.cells[col.id];
        const raw = prevCell ? prevCell.raw : null;
        const nextCell = evaluateCellState(raw, col, dataset.sourceMetadata?.importOptions);
        if (nextCell.missingState === MISSING_STATES.INVALID_PARSE) {
          failedConversions++;
        }
        if (prevCell && prevCell.formatted !== nextCell.formatted) {
          cellChanges.push({
            rowId: row._rowId,
            colId: col.id,
            column: col.displayName,
            oldVal: prevCell.formatted,
            newVal: nextCell.formatted
          });
        }
        row.cells[col.id] = nextCell;
      }
      col.provenance.push(`type_${oldType}_to_${targetType}`);
      return {
        summary: `Converted "${col.displayName}" from ${oldType} to ${targetType} (${failedConversions} parse failure(s) flagged, 0 silently dropped).`,
        cellChanges,
        failedConversions,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  CLEAN_NUMERIC_TEXT: {
    id: 'CLEAN_NUMERIC_TEXT',
    version: '1.0.0',
    category: 'Type & Date Conversion',
    label: 'Clean Currency / Numeric Formatting',
    riskLevel: RISK_LEVELS.MEDIUM,
    description: 'Strips currency symbols, thousands separators, and accounting parentheses to parse clean numeric values.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const decimalSep = params.decimalSeparator || col.parsingConvention?.decimalSeparator || '.';
      col.confirmedType = SEMANTIC_TYPES.DECIMAL;
      col.semanticType = SEMANTIC_TYPES.DECIMAL;

      const cellChanges = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || cell.raw === null || cell.raw === undefined) continue;
        const rawStr = String(cell.raw);
        const parsedRes = parseNumericCell(rawStr, { decimalSeparator: decimalSep });
        if (parsedRes.valid) {
          const cleanStr = String(parsedRes.value);
          row.cells[col.id] = evaluateCellState(cleanStr, col, dataset.sourceMetadata?.importOptions);
          if (cleanStr !== rawStr) {
            cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal: rawStr, newVal: cleanStr });
          }
        }
      }
      col.provenance.push('clean_numeric');
      return {
        summary: `Cleaned numeric formatting in "${col.displayName}" (${cellChanges.length} cell(s) standardized).`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  PARSE_DATES: {
    id: 'PARSE_DATES',
    version: '1.0.0',
    category: 'Type & Date Conversion',
    label: 'Resolve Date Convention to ISO 8601',
    riskLevel: RISK_LEVELS.MEDIUM,
    description: 'Parses dates using an explicit user-confirmed format (US MM/DD/YYYY vs International DD/MM/YYYY) into ISO 8601 YYYY-MM-DD.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const dateFormat = params.dateFormat || 'MDY'; // 'MDY' or 'DMY'
      col.parsingConvention = { ...col.parsingConvention, dateFormat };
      col.confirmedType = SEMANTIC_TYPES.DATE;
      col.semanticType = SEMANTIC_TYPES.DATE;

      const cellChanges = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || !cell.raw) continue;
        const dRes = detectDateAmbiguity(String(cell.raw));
        if (dRes.isDateCandidate && dRes.valid) {
          const iso = dRes.ambiguous
            ? (dateFormat === 'DMY' ? dRes.isoIfDMY : dRes.isoIfMDY)
            : dRes.isoValue;
          if (iso && iso !== cell.raw) {
            const oldVal = cell.raw;
            row.cells[col.id] = evaluateCellState(iso, col, dataset.sourceMetadata?.importOptions);
            cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: iso });
          } else {
            row.cells[col.id] = evaluateCellState(cell.raw, col, dataset.sourceMetadata?.importOptions);
          }
        }
      }
      col.provenance.push(`parse_dates_${dateFormat}`);
      return {
        summary: `Parsed dates in "${col.displayName}" using ${dateFormat} convention (${cellChanges.length} cell(s) converted to ISO 8601).`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  CONVERT_UNITS: {
    id: 'CONVERT_UNITS',
    version: '1.0.0',
    category: 'Type & Date Conversion',
    label: 'Standardize Measurement Units',
    riskLevel: RISK_LEVELS.MEDIUM,
    description: 'Converts numerical values with explicit or embedded units using the validated unit registry.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const targetUnit = String(params.targetUnit || 'kg').toLowerCase();
      const sourceUnitDefault = params.sourceUnit ? String(params.sourceUnit).toLowerCase() : null;
      const UNIT_REGEX = /^([+\-]?\d+(?:\.\d+)?)\s*(kg|lbs?|lb|g|cm|mm|m|in|inch|inches|ft|°c|c|°f|f)$/i;

      col.confirmedType = SEMANTIC_TYPES.DECIMAL;
      col.semanticType = SEMANTIC_TYPES.DECIMAL;
      col.unit = params.targetUnit || targetUnit;

      const cellChanges = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || cell.raw === null || cell.raw === undefined) continue;
        const rawStr = String(cell.raw).trim();
        const m = UNIT_REGEX.exec(rawStr);
        let numVal = null;
        let fromUnit = sourceUnitDefault;
        if (m) {
          numVal = Number(m[1]);
          fromUnit = m[2].toLowerCase();
        } else if (typeof cell.parsed === 'number' && fromUnit) {
          numVal = cell.parsed;
        }
        if (numVal !== null && Number.isFinite(numVal) && fromUnit) {
          const convKey = `${fromUnit}->${targetUnit}`;
          const fn = UNIT_CONVERSION_REGISTRY[convKey];
          if (!fn) {
            throw new Error(`Unsupported unit conversion "${convKey}" in unit registry.`);
          }
          const converted = Number(fn(numVal).toFixed(4));
          const nextStr = String(converted);
          row.cells[col.id] = evaluateCellState(nextStr, col, dataset.sourceMetadata?.importOptions);
          cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal: rawStr, newVal: nextStr });
        }
      }
      col.provenance.push(`convert_units_to_${targetUnit}`);
      return {
        summary: `Converted ${cellChanges.length} measurement(s) in "${col.displayName}" to unit "${col.unit}".`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  ADD_MISSINGNESS_INDICATOR: {
    id: 'ADD_MISSINGNESS_INDICATOR',
    version: '1.0.0',
    category: 'Missing-Data Handling',
    label: 'Add Missingness Indicator Column',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Appends a binary indicator column (1 = missing, 0 = present) preserving missingness pattern without altering original measurements.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const newColName = params.newColumnName || `${col.displayName}_is_missing`;
      const newColId = `col_${dataset.columns.length + 1}_${Date.now().toString(36).slice(-3)}`;
      const newCol = {
        id: newColId,
        index: dataset.columns.length,
        displayName: newColName,
        originalName: newColName,
        storageType: 'float64',
        semanticType: SEMANTIC_TYPES.INTEGER,
        confirmedType: SEMANTIC_TYPES.INTEGER,
        role: 'explanatory',
        nullability: false,
        unit: null,
        allowedCategories: null,
        parsingConvention: {},
        validationConstraints: [],
        originalSource: { derivedFrom: col.displayName },
        provenance: [`missingness_indicator(${col.displayName})`]
      };
      dataset.columns.push(newCol);

      let flaggedCount = 0;
      for (const row of dataset.rows) {
        const c = row.cells[col.id];
        const isMissing = !c || c.missingState !== MISSING_STATES.PRESENT;
        if (isMissing) flaggedCount++;
        row.cells[newColId] = evaluateCellState(isMissing ? '1' : '0', newCol);
      }

      return {
        summary: `Added indicator column "${newColName}" (${flaggedCount} missing observation(s) flagged as 1).`,
        cellChanges: [],
        addedColumns: [newColName],
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  IMPUTE_MISSING: {
    id: 'IMPUTE_MISSING',
    version: '1.0.0',
    category: 'Missing-Data Handling',
    label: 'Impute Missing Values (With Leakage Control)',
    riskLevel: RISK_LEVELS.HIGH,
    description: 'Replaces missing values using constant, mean, median, mode, groupwise mean/median, forward/backward fill, or linear interpolation. Supports training-split fit to prevent test leakage.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const method = params.method || 'median'; // 'constant', 'mean', 'median', 'mode', 'group_mean', 'group_median', 'ffill', 'bfill', 'linear_interp'
      const activeType = col.confirmedType || col.semanticType;
      const isQuant = activeType === SEMANTIC_TYPES.INTEGER || activeType === SEMANTIC_TYPES.DECIMAL;

      if (['mean', 'median', 'group_mean', 'group_median', 'linear_interp'].includes(method) && !isQuant) {
        throw new Error(`Method "${method}" requires a quantitative column; "${col.displayName}" is ${activeType}.`);
      }

      // Leakage protection (Part 13.5): allow fitting statistics only on training rows (e.g. splitColumn == 'train' or first trainRatio rows)
      let fitRows = dataset.rows;
      let fitScopeDescription = 'full dataset';
      if (params.useLearnedParameter && dataset.learnedParameters?.[col.displayName]?.[method] !== undefined) {
        fitScopeDescription = 'pre-fitted recipe parameter';
      } else if (params.splitColumn) {
        const splitCol = resolveColumn(dataset, params.splitColumn);
        const trainVal = String(params.trainValue || 'train').toLowerCase();
        if (splitCol) {
          fitRows = dataset.rows.filter(
            r => String(r.cells[splitCol.id]?.raw ?? '').trim().toLowerCase() === trainVal
          );
          fitScopeDescription = `training subset (${splitCol.displayName} == "${params.trainValue || 'train'}", n=${fitRows.length})`;
        }
      } else if (params.trainCutoffIndex && Number(params.trainCutoffIndex) > 0) {
        const cutoff = Number(params.trainCutoffIndex);
        fitRows = dataset.rows.slice(0, cutoff);
        fitScopeDescription = `training window (first ${cutoff} rows)`;
      }

      // Optional explicit ordering check for ffill / bfill / linear_interp
      if (['ffill', 'bfill', 'linear_interp'].includes(method)) {
        if (!params.orderByColumn && !params.confirmOrdered) {
          throw new Error(`Temporal/sequential imputation ("${method}") requires an explicit ordering column or confirmed sequence order.`);
        }
        if (params.orderByColumn) {
          const ordCol = resolveColumn(dataset, params.orderByColumn);
          if (ordCol) {
            dataset.rows.sort((a, b) => {
              const va = a.cells[ordCol.id]?.parsed ?? a.cells[ordCol.id]?.raw ?? '';
              const vb = b.cells[ordCol.id]?.parsed ?? b.cells[ordCol.id]?.raw ?? '';
              return String(va).localeCompare(String(vb), undefined, { numeric: true });
            });
          }
        }
      }

      const cellChanges = [];
      let fixedFillValue = null;

      if (method === 'constant') {
        fixedFillValue = params.constantValue ?? '0';
      } else if (method === 'mean' || method === 'median') {
        if (params.useLearnedParameter && dataset.learnedParameters?.[col.displayName]?.[method] !== undefined) {
          fixedFillValue = dataset.learnedParameters[col.displayName][method];
        } else {
          const vals = fitRows
            .map(r => r.cells[col.id])
            .filter(c => c?.missingState === MISSING_STATES.PRESENT && typeof c.parsed === 'number')
            .map(c => c.parsed);
          const stats = computeNumericStats(vals);
          if (!stats) throw new Error(`No valid numerical observations in "${col.displayName}" to compute ${method}.`);
          fixedFillValue = method === 'mean' ? Number(stats.mean.toFixed(4)) : Number(stats.median.toFixed(4));
          if (!dataset.learnedParameters[col.displayName]) dataset.learnedParameters[col.displayName] = {};
          dataset.learnedParameters[col.displayName][method] = fixedFillValue;
        }
      } else if (method === 'mode') {
        const counts = new Map();
        for (const r of fitRows) {
          const c = r.cells[col.id];
          if (c?.missingState === MISSING_STATES.PRESENT) {
            const k = String(c.parsed ?? c.raw);
            counts.set(k, (counts.get(k) || 0) + 1);
          }
        }
        let best = null;
        let bestCnt = -1;
        for (const [k, cnt] of counts.entries()) {
          if (cnt > bestCnt) { best = k; bestCnt = cnt; }
        }
        fixedFillValue = best;
      }

      if (fixedFillValue !== null) {
        for (const row of dataset.rows) {
          const c = row.cells[col.id];
          if (!c || c.missingState === MISSING_STATES.MISSING || c.missingState === MISSING_STATES.EMPTY_STRING || c.missingState === MISSING_STATES.USER_MISSING_MARKER) {
            const oldVal = c ? c.formatted : 'NULL';
            const nextCell = evaluateCellState(String(fixedFillValue), col, dataset.sourceMetadata?.importOptions);
            nextCell.isImputed = true;
            row.cells[col.id] = nextCell;
            cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: String(fixedFillValue) });
          }
        }
      } else if (method === 'group_mean' || method === 'group_median') {
        const grpCol = resolveColumn(dataset, params.groupColumn);
        if (!grpCol) throw new Error(`Groupwise imputation requires a valid groupColumn.`);
        const grpMap = new Map();
        for (const r of fitRows) {
          const gVal = String(r.cells[grpCol.id]?.parsed ?? '§MISSING');
          const c = r.cells[col.id];
          if (c?.missingState === MISSING_STATES.PRESENT && typeof c.parsed === 'number') {
            if (!grpMap.has(gVal)) grpMap.set(gVal, []);
            grpMap.get(gVal).push(c.parsed);
          }
        }
        const grpStat = new Map();
        for (const [gKey, arr] of grpMap.entries()) {
          const st = computeNumericStats(arr);
          if (st) grpStat.set(gKey, method === 'group_mean' ? Number(st.mean.toFixed(4)) : Number(st.median.toFixed(4)));
        }
        for (const row of dataset.rows) {
          const c = row.cells[col.id];
          if (!c || c.missingState === MISSING_STATES.MISSING || c.missingState === MISSING_STATES.EMPTY_STRING) {
            const gVal = String(row.cells[grpCol.id]?.parsed ?? '§MISSING');
            if (grpStat.has(gVal)) {
              const fillVal = String(grpStat.get(gVal));
              const oldVal = c ? c.formatted : 'NULL';
              const nextCell = evaluateCellState(fillVal, col, dataset.sourceMetadata?.importOptions);
              nextCell.isImputed = true;
              row.cells[col.id] = nextCell;
              cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: fillVal });
            }
          }
        }
      } else if (method === 'ffill' || method === 'bfill') {
        const indices = method === 'ffill'
          ? Array.from({ length: dataset.rows.length }, (_, i) => i)
          : Array.from({ length: dataset.rows.length }, (_, i) => dataset.rows.length - 1 - i);
        let lastValid = null;
        for (const idx of indices) {
          const row = dataset.rows[idx];
          const c = row.cells[col.id];
          if (c?.missingState === MISSING_STATES.PRESENT) {
            lastValid = c.raw;
          } else if (lastValid !== null && (!c || c.missingState === MISSING_STATES.MISSING || c.missingState === MISSING_STATES.EMPTY_STRING)) {
            const oldVal = c ? c.formatted : 'NULL';
            const nextCell = evaluateCellState(String(lastValid), col, dataset.sourceMetadata?.importOptions);
            nextCell.isImputed = true;
            row.cells[col.id] = nextCell;
            cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: String(lastValid) });
          }
        }
      } else if (method === 'linear_interp') {
        const n = dataset.rows.length;
        for (let i = 0; i < n; i++) {
          const c = dataset.rows[i].cells[col.id];
          if (!c || c.missingState === MISSING_STATES.MISSING || c.missingState === MISSING_STATES.EMPTY_STRING) {
            // Find previous and next valid numeric index
            let prevIdx = i - 1;
            while (prevIdx >= 0 && dataset.rows[prevIdx].cells[col.id]?.missingState !== MISSING_STATES.PRESENT) prevIdx--;
            let nextIdx = i + 1;
            while (nextIdx < n && dataset.rows[nextIdx].cells[col.id]?.missingState !== MISSING_STATES.PRESENT) nextIdx++;
            if (prevIdx >= 0 && nextIdx < n) {
              const y0 = Number(dataset.rows[prevIdx].cells[col.id].parsed);
              const y1 = Number(dataset.rows[nextIdx].cells[col.id].parsed);
              const interp = Number((y0 + ((y1 - y0) * (i - prevIdx)) / (nextIdx - prevIdx)).toFixed(4));
              const oldVal = c ? c.formatted : 'NULL';
              const nextCell = evaluateCellState(String(interp), col, dataset.sourceMetadata?.importOptions);
              nextCell.isImputed = true;
              dataset.rows[i].cells[col.id] = nextCell;
              cellChanges.push({ rowId: dataset.rows[i]._rowId, colId: col.id, column: col.displayName, oldVal, newVal: String(interp) });
            }
          }
        }
      }

      col.provenance.push(`impute_${method}(${fitScopeDescription})`);
      return {
        summary: `Imputed ${cellChanges.length} missing value(s) in "${col.displayName}" using ${method} (fitted on ${fitScopeDescription}). Statistical note: Imputation alters sample variance and requires disclosure.`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  DROP_MISSING_ROWS: {
    id: 'DROP_MISSING_ROWS',
    version: '1.0.0',
    category: 'Missing-Data Handling',
    label: 'Listwise Deletion of Missing Rows',
    riskLevel: RISK_LEVELS.HIGH,
    description: 'Removes rows containing missing values in the specified column(s). Discloses exact sample size reduction.',
    execute(dataset, params) {
      const targetCols = params.colId
        ? [resolveColumn(dataset, params.colId)].filter(Boolean)
        : dataset.columns;
      const rowsBefore = dataset.rows.length;
      const removedRowIds = [];
      dataset.rows = dataset.rows.filter(row => {
        const hasMissing = targetCols.some(c => {
          const cell = row.cells[c.id];
          return !cell || cell.missingState !== MISSING_STATES.PRESENT;
        });
        if (hasMissing) removedRowIds.push(row._rowId);
        return !hasMissing;
      });
      const rowsAfter = dataset.rows.length;
      return {
        summary: `Complete-case filter removed ${removedRowIds.length} row(s) (${rowsBefore} → ${rowsAfter} observations).`,
        cellChanges: [],
        removedRowIds,
        rowsBefore,
        rowsAfter
      };
    }
  },

  DEDUPLICATE_EXACT: {
    id: 'DEDUPLICATE_EXACT',
    version: '1.0.0',
    category: 'Duplicate Resolution',
    label: 'Deduplicate Records',
    riskLevel: RISK_LEVELS.HIGH,
    description: 'Resolves duplicate records using keep_first, keep_last, or keep_most_complete while recording survivor provenance.',
    execute(dataset, params) {
      const strategy = params.strategy || 'keep_first'; // 'keep_first', 'keep_last', 'keep_most_complete'
      const compareCols = params.columns && params.columns.length > 0
        ? params.columns.map(id => resolveColumn(dataset, id)).filter(Boolean)
        : dataset.columns;

      const rowsBefore = dataset.rows.length;
      const groups = new Map();

      for (const row of dataset.rows) {
        const key = compareCols
          .map(c => {
            const cell = row.cells[c.id];
            if (!cell || cell.missingState !== MISSING_STATES.PRESENT) return '§MISSING';
            return String(cell.parsed ?? cell.raw);
          })
          .join('||');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }

      const survivingRows = [];
      const removedRowIds = [];
      const resolutionLog = [];

      for (const [key, grp] of groups.entries()) {
        if (grp.length === 1) {
          survivingRows.push(grp[0]);
          continue;
        }
        let survivor = grp[0];
        if (strategy === 'keep_last') {
          survivor = grp[grp.length - 1];
        } else if (strategy === 'keep_most_complete') {
          let bestScore = -1;
          for (const cand of grp) {
            let score = 0;
            for (const c of dataset.columns) {
              if (cand.cells[c.id]?.missingState === MISSING_STATES.PRESENT) score++;
            }
            if (score > bestScore) {
              bestScore = score;
              survivor = cand;
            }
          }
        }
        const discarded = grp.filter(r => r._rowId !== survivor._rowId).map(r => r._rowId);
        removedRowIds.push(...discarded);
        survivor._lineage = [...new Set([...(survivor._lineage || []), ...discarded])];
        survivingRows.push(survivor);
        resolutionLog.push({ survivorId: survivor._rowId, discardedIds: discarded, key });
      }

      dataset.rows = survivingRows;
      const rowsAfter = dataset.rows.length;
      return {
        summary: `Deduplicated dataset using "${strategy}" on ${compareCols.length} column(s): removed ${removedRowIds.length} duplicate row(s) (${rowsBefore} → ${rowsAfter}).`,
        cellChanges: [],
        removedRowIds,
        resolutionLog,
        rowsBefore,
        rowsAfter
      };
    }
  },

  MARK_DUPLICATE_KEYS: {
    id: 'MARK_DUPLICATE_KEYS',
    version: '1.0.0',
    category: 'Duplicate Resolution',
    label: 'Flag Duplicate Keys Without Deletion',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Adds a boolean/count diagnostic column indicating whether a key column (or composite key) repeats across multiple rows.',
    execute(dataset, params) {
      const keyCols = Array.isArray(params.keyColumns) && params.keyColumns.length > 0
        ? params.keyColumns.map(k => resolveColumn(dataset, k)).filter(Boolean)
        : [resolveColumn(dataset, params.colId || params.columnName)].filter(Boolean);
      if (keyCols.length === 0) throw new Error(`Key column not found.`);
      const col = keyCols[0];
      const counts = new Map();
      for (const row of dataset.rows) {
        const k = keyCols.map(c => String(row.cells[c.id]?.raw ?? '').trim()).join('||');
        if (k && !k.startsWith('||')) counts.set(k, (counts.get(k) || 0) + 1);
      }

      const labelBase = keyCols.map(c => c.displayName).join('_');
      const newColName = `${labelBase}_dup_flag`;
      const newColId = `col_${dataset.columns.length + 1}_dup`;
      const newCol = {
        id: newColId,
        index: dataset.columns.length,
        displayName: newColName,
        originalName: newColName,
        storageType: 'string',
        semanticType: SEMANTIC_TYPES.CATEGORICAL,
        confirmedType: SEMANTIC_TYPES.CATEGORICAL,
        role: 'metadata',
        nullability: false,
        unit: null,
        allowedCategories: ['UNIQUE', 'REPEATED_KEY'],
        parsingConvention: {},
        validationConstraints: [],
        originalSource: { derivedFrom: col.displayName },
        provenance: [`mark_duplicate_keys(${col.displayName})`]
      };
      dataset.columns.push(newCol);

      let dupCount = 0;
      for (const row of dataset.rows) {
        const k = keyCols.map(c => String(row.cells[c.id]?.raw ?? '').trim()).join('||');
        const isDup = k && (counts.get(k) || 0) > 1;
        if (isDup) dupCount++;
        row.cells[newColId] = evaluateCellState(isDup ? 'REPEATED_KEY' : 'UNIQUE', newCol);
      }

      return {
        summary: `Flagged ${dupCount} row(s) with repeated keys in "${col.displayName}" into new column "${newColName}" (0 rows deleted).`,
        cellChanges: [],
        addedColumns: [newColName],
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  MAP_CATEGORIES: {
    id: 'MAP_CATEGORIES',
    version: '1.0.0',
    category: 'Category Normalization',
    label: 'Apply Canonical Category Mapping',
    riskLevel: RISK_LEVELS.MEDIUM,
    description: 'Maps source category variants and aliases into user-approved canonical labels.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const mapping = params.mapping || {};
      const lowerMap = new Map(Object.entries(mapping).map(([k, v]) => [k.trim().toLowerCase(), v]));
      const cellChanges = [];

      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (!cell || cell.missingState !== MISSING_STATES.PRESENT) continue;
        const rawTrim = String(cell.raw).trim();
        const lowerKey = rawTrim.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(mapping, rawTrim) || Object.prototype.hasOwnProperty.call(mapping, cell.raw) || lowerMap.has(lowerKey)) {
          const target = mapping[rawTrim] ?? mapping[cell.raw] ?? lowerMap.get(lowerKey);
          if (target !== cell.raw) {
            const oldVal = cell.raw;
            row.cells[col.id] = evaluateCellState(String(target), col, dataset.sourceMetadata?.importOptions);
            cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: String(target) });
          }
        }
      }
      col.provenance.push('map_categories');
      return {
        summary: `Mapped ${cellChanges.length} category value(s) in "${col.displayName}" to canonical labels.`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  FLAG_OUTLIERS: {
    id: 'FLAG_OUTLIERS',
    version: '1.0.0',
    category: 'Outliers & Anomalies',
    label: 'Flag Statistical Outliers (Non-Destructive)',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Adds a diagnostic column classifying observations against Tukey IQR fences, Z-score (>3.0), or MAD Z-score (>3.5) without deleting data.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const method = params.method || 'tukey_iqr'; // 'tukey_iqr', 'z_score', 'mad_z'
      const vals = dataset.rows
        .map(r => r.cells[col.id])
        .filter(c => c?.missingState === MISSING_STATES.PRESENT && typeof c.parsed === 'number')
        .map(c => c.parsed);
      const st = computeNumericStats(vals);
      if (!st) throw new Error(`Column "${col.displayName}" has no valid numeric values.`);

      const mult = Number(params.multiplier || 1.5);
      const lowerFence = st.q1 - mult * st.iqr;
      const upperFence = st.q3 + mult * st.iqr;

      const newColName = `${col.displayName}_outlier_flag`;
      const newColId = `col_${dataset.columns.length + 1}_out`;
      const newCol = {
        id: newColId,
        index: dataset.columns.length,
        displayName: newColName,
        originalName: newColName,
        storageType: 'string',
        semanticType: SEMANTIC_TYPES.CATEGORICAL,
        confirmedType: SEMANTIC_TYPES.CATEGORICAL,
        role: 'metadata',
        nullability: false,
        unit: null,
        allowedCategories: ['IN_RANGE', 'LOW_OUTLIER', 'HIGH_OUTLIER'],
        parsingConvention: {},
        validationConstraints: [],
        originalSource: { derivedFrom: col.displayName },
        provenance: [`flag_outliers_${method}(${col.displayName})`]
      };
      dataset.columns.push(newCol);

      let flaggedCount = 0;
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        let flag = 'IN_RANGE';
        if (cell?.missingState === MISSING_STATES.PRESENT && typeof cell.parsed === 'number') {
          const v = cell.parsed;
          if (method === 'tukey_iqr') {
            if (v < lowerFence) flag = 'LOW_OUTLIER';
            else if (v > upperFence) flag = 'HIGH_OUTLIER';
          } else if (method === 'z_score' && st.sd > 0) {
            const z = (v - st.mean) / st.sd;
            if (z < -3.0) flag = 'LOW_OUTLIER';
            else if (z > 3.0) flag = 'HIGH_OUTLIER';
          } else if (method === 'mad_z' && st.madSigma > 0) {
            const mz = (v - st.median) / st.madSigma;
            if (mz < -3.5) flag = 'LOW_OUTLIER';
            else if (mz > 3.5) flag = 'HIGH_OUTLIER';
          }
        }
        if (flag !== 'IN_RANGE') flaggedCount++;
        row.cells[newColId] = evaluateCellState(flag, newCol);
      }

      return {
        summary: `Flagged ${flaggedCount} extreme observation(s) in "${col.displayName}" using ${method} into "${newColName}".`,
        cellChanges: [],
        addedColumns: [newColName],
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  WINSORIZE_OUTLIERS: {
    id: 'WINSORIZE_OUTLIERS',
    version: '1.0.0',
    category: 'Outliers & Anomalies',
    label: 'Winsorize / Cap Extreme Values',
    riskLevel: RISK_LEVELS.HIGH,
    description: 'Caps values outside explicit bounds or Tukey fences under explicit user instruction.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const vals = dataset.rows
        .map(r => r.cells[col.id])
        .filter(c => c?.missingState === MISSING_STATES.PRESENT && typeof c.parsed === 'number')
        .map(c => c.parsed);
      const st = computeNumericStats(vals);
      if (!st) throw new Error(`No valid numeric values in "${col.displayName}".`);

      const lower = params.minBound !== undefined && params.minBound !== ''
        ? Number(params.minBound)
        : Number((st.q1 - 1.5 * st.iqr).toFixed(4));
      const upper = params.maxBound !== undefined && params.maxBound !== ''
        ? Number(params.maxBound)
        : Number((st.q3 + 1.5 * st.iqr).toFixed(4));

      const cellChanges = [];
      for (const row of dataset.rows) {
        const cell = row.cells[col.id];
        if (cell?.missingState === MISSING_STATES.PRESENT && typeof cell.parsed === 'number') {
          let capped = cell.parsed;
          if (capped < lower) capped = lower;
          else if (capped > upper) capped = upper;
          if (capped !== cell.parsed) {
            const oldVal = cell.formatted;
            const nextStr = String(capped);
            row.cells[col.id] = evaluateCellState(nextStr, col, dataset.sourceMetadata?.importOptions);
            cellChanges.push({ rowId: row._rowId, colId: col.id, column: col.displayName, oldVal, newVal: nextStr });
          }
        }
      }
      col.provenance.push(`winsorize([${lower}, ${upper}])`);
      return {
        summary: `Winsorized ${cellChanges.length} observation(s) in "${col.displayName}" to [${lower}, ${upper}].`,
        cellChanges,
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  FILTER_ROWS: {
    id: 'FILTER_ROWS',
    version: '1.0.0',
    category: 'Row & Column Operations',
    label: 'Filter Rows by Condition',
    riskLevel: RISK_LEVELS.HIGH,
    description: 'Retains rows matching a structured comparison or safe expression, reporting exact filtered-out and remaining row counts.',
    execute(dataset, params) {
      const rowsBefore = dataset.rows.length;
      const removedRowIds = [];

      if (params.expression) {
        dataset.rows = dataset.rows.filter(row => {
          const ctx = {};
          for (const c of dataset.columns) {
            ctx[c.displayName] = row.cells[c.id]?.parsed ?? row.cells[c.id]?.raw ?? null;
          }
          const keep = Boolean(evaluateSafeExpression(params.expression, ctx));
          if (!keep) removedRowIds.push(row._rowId);
          return keep;
        });
      } else {
        const col = resolveColumn(dataset, params.colId || params.columnName);
        if (!col) throw new Error(`Filter column not found.`);
        const op = params.operator || 'equals'; // 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_missing'
        const target = params.value;

        dataset.rows = dataset.rows.filter(row => {
          const cell = row.cells[col.id];
          const val = cell?.missingState === MISSING_STATES.PRESENT ? cell.parsed : null;
          let keep = true;
          if (op === 'not_missing') keep = cell?.missingState === MISSING_STATES.PRESENT;
          else if (op === 'is_missing') keep = !cell || cell.missingState !== MISSING_STATES.PRESENT;
          else if (val === null) keep = false;
          else if (op === 'equals') keep = String(val) === String(target);
          else if (op === 'not_equals') keep = String(val) !== String(target);
          else if (op === 'gt') keep = Number(val) > Number(target);
          else if (op === 'gte') keep = Number(val) >= Number(target);
          else if (op === 'lt') keep = Number(val) < Number(target);
          else if (op === 'lte') keep = Number(val) <= Number(target);
          else if (op === 'contains') keep = String(val).toLowerCase().includes(String(target).toLowerCase());
          if (!keep) removedRowIds.push(row._rowId);
          return keep;
        });
      }

      const rowsAfter = dataset.rows.length;
      return {
        summary: `Original rows: ${rowsBefore}. Filtered out: ${removedRowIds.length}. Remaining: ${rowsAfter}.`,
        cellChanges: [],
        removedRowIds,
        rowsBefore,
        rowsAfter
      };
    }
  },

  SORT_ROWS: {
    id: 'SORT_ROWS',
    version: '1.0.0',
    category: 'Row & Column Operations',
    label: 'Sort Rows',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Sorts observations by one or more columns (respecting ordered categorical levels and numeric values). Preserves exact row count.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Sort column not found.`);
      const direction = params.direction === 'desc' ? -1 : 1;
      const activeType = col.confirmedType || col.semanticType;
      const ordLevels = col.allowedCategories || null;

      dataset.rows.sort((a, b) => {
        const ca = a.cells[col.id];
        const cb = b.cells[col.id];
        const ma = !ca || ca.missingState !== MISSING_STATES.PRESENT;
        const mb = !cb || cb.missingState !== MISSING_STATES.PRESENT;
        if (ma && mb) return 0;
        if (ma) return 1; // missing always sorted to bottom
        if (mb) return -1;

        if (activeType === SEMANTIC_TYPES.ORDERED_CATEGORICAL && Array.isArray(ordLevels)) {
          const ia = ordLevels.findIndex(l => l.toLowerCase() === String(ca.parsed).toLowerCase());
          const ib = ordLevels.findIndex(l => l.toLowerCase() === String(cb.parsed).toLowerCase());
          if (ia !== -1 && ib !== -1) return (ia - ib) * direction;
        }
        if (typeof ca.parsed === 'number' && typeof cb.parsed === 'number') {
          return (ca.parsed - cb.parsed) * direction;
        }
        return String(ca.parsed).localeCompare(String(cb.parsed), undefined, { numeric: true }) * direction;
      });

      return {
        summary: `Sorted ${dataset.rows.length} rows by "${col.displayName}" (${direction === 1 ? 'ascending' : 'descending'}).`,
        cellChanges: [],
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  RENAME_COLUMN: {
    id: 'RENAME_COLUMN',
    version: '1.0.0',
    category: 'Row & Column Operations',
    label: 'Rename Column',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Renames a column display name while preserving its original source name and values.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const newName = String(params.newName || '').trim();
      if (!newName) throw new Error('New column name cannot be empty.');
      const oldName = col.displayName;
      col.displayName = newName;
      col.provenance.push(`renamed(${oldName}->${newName})`);
      return {
        summary: `Renamed column "${oldName}" to "${newName}".`,
        cellChanges: [],
        renamedColumns: [{ from: oldName, to: newName }],
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  DROP_COLUMN: {
    id: 'DROP_COLUMN',
    version: '1.0.0',
    category: 'Row & Column Operations',
    label: 'Remove Column',
    riskLevel: RISK_LEVELS.MEDIUM,
    description: 'Removes a selected column from the working dataset.',
    execute(dataset, params) {
      const col = resolveColumn(dataset, params.colId || params.columnName);
      if (!col) throw new Error(`Column not found.`);
      const removedName = col.displayName;
      dataset.columns = dataset.columns.filter(c => c.id !== col.id);
      for (const row of dataset.rows) {
        delete row.cells[col.id];
      }
      return {
        summary: `Removed column "${removedName}".`,
        cellChanges: [],
        removedColumns: [removedName],
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  },

  ADD_CALCULATED_COLUMN: {
    id: 'ADD_CALCULATED_COLUMN',
    version: '1.0.0',
    category: 'Row & Column Operations',
    label: 'Add Calculated / Window Column',
    riskLevel: RISK_LEVELS.LOW,
    description: 'Creates a derived column using the safe typed expression evaluator or window functions (rank, zscore, cumsum, lag, lead, bin).',
    execute(dataset, params) {
      const newColName = String(params.newColumnName || 'derived_col').trim();
      const calcType = params.calcType || 'expression'; // 'expression', 'zscore', 'rank', 'cumsum', 'lag', 'lead', 'bin'
      const newColId = `col_${dataset.columns.length + 1}_calc_${Date.now().toString(36).slice(-3)}`;

      const isNumericOut = ['zscore', 'rank', 'cumsum', 'lag', 'lead', 'expression'].includes(calcType);
      const newCol = {
        id: newColId,
        index: dataset.columns.length,
        displayName: newColName,
        originalName: newColName,
        storageType: isNumericOut ? 'float64' : 'string',
        semanticType: isNumericOut ? SEMANTIC_TYPES.DECIMAL : SEMANTIC_TYPES.CATEGORICAL,
        confirmedType: null,
        role: 'explanatory',
        nullability: true,
        unit: null,
        allowedCategories: null,
        parsingConvention: {},
        validationConstraints: [],
        originalSource: { derivedFrom: params.expression || calcType },
        provenance: [`calculated_${calcType}`]
      };

      if (calcType === 'expression') {
        const expr = String(params.expression || '');
        if (!expr) throw new Error('Calculated column expression cannot be empty.');
        for (const row of dataset.rows) {
          const ctx = {};
          for (const c of dataset.columns) {
            ctx[c.displayName] = row.cells[c.id]?.missingState === MISSING_STATES.PRESENT
              ? row.cells[c.id].parsed
              : null;
          }
          const val = evaluateSafeExpression(expr, ctx);
          row.cells[newColId] = evaluateCellState(val === null || val === undefined ? null : String(val), newCol);
        }
      } else {
        const srcCol = resolveColumn(dataset, params.sourceColumn || params.colId);
        if (!srcCol) throw new Error('Source column required for window calculation.');
        const vals = dataset.rows.map(r => {
          const c = r.cells[srcCol.id];
          return c?.missingState === MISSING_STATES.PRESENT && typeof c.parsed === 'number' ? c.parsed : null;
        });

        if (calcType === 'zscore') {
          const st = computeNumericStats(vals.filter(v => v !== null));
          for (let i = 0; i < dataset.rows.length; i++) {
            const v = vals[i];
            const z = v !== null && st && st.sd > 0 ? Number(((v - st.mean) / st.sd).toFixed(4)) : null;
            dataset.rows[i].cells[newColId] = evaluateCellState(z === null ? null : String(z), newCol);
          }
        } else if (calcType === 'cumsum') {
          let running = 0;
          for (let i = 0; i < dataset.rows.length; i++) {
            const v = vals[i];
            if (v !== null) running = Number((running + v).toFixed(4));
            dataset.rows[i].cells[newColId] = evaluateCellState(v === null ? null : String(running), newCol);
          }
        } else if (calcType === 'lag' || calcType === 'lead') {
          const offset = Number(params.offset || 1) * (calcType === 'lag' ? -1 : 1);
          for (let i = 0; i < dataset.rows.length; i++) {
            const targetIdx = i + offset;
            const targetVal = targetIdx >= 0 && targetIdx < dataset.rows.length ? vals[targetIdx] : null;
            dataset.rows[i].cells[newColId] = evaluateCellState(targetVal === null ? null : String(targetVal), newCol);
          }
        } else if (calcType === 'rank') {
          const indexed = vals.map((v, idx) => ({ v, idx })).filter(x => x.v !== null).sort((a, b) => a.v - b.v);
          const ranks = new Array(dataset.rows.length).fill(null);
          indexed.forEach((item, rankIdx) => { ranks[item.idx] = rankIdx + 1; });
          for (let i = 0; i < dataset.rows.length; i++) {
            dataset.rows[i].cells[newColId] = evaluateCellState(ranks[i] === null ? null : String(ranks[i]), newCol);
          }
        } else if (calcType === 'bin') {
          const st = computeNumericStats(vals.filter(v => v !== null));
          for (let i = 0; i < dataset.rows.length; i++) {
            const v = vals[i];
            let label = null;
            if (v !== null && st) {
              if (v <= st.q1) label = 'Q1 (Low)';
              else if (v <= st.median) label = 'Q2 (Lower-Mid)';
              else if (v <= st.q3) label = 'Q3 (Upper-Mid)';
              else label = 'Q4 (High)';
            }
            dataset.rows[i].cells[newColId] = evaluateCellState(label, newCol);
          }
        }
      }

      dataset.columns.push(newCol);
      return {
        summary: `Added calculated column "${newColName}" (${calcType}).`,
        cellChanges: [],
        addedColumns: [newColName],
        rowsBefore: dataset.rows.length,
        rowsAfter: dataset.rows.length
      };
    }
  }
};

/**
 * Previews an operation on a cloned copy of the dataset without mutating the active dataset.
 */
export function previewTransformation(dataset, operationType, params = {}) {
  const op = OPERATION_REGISTRY[operationType];
  if (!op) throw new Error(`Unknown operation type "${operationType}".`);

  const tempDs = {
    id: dataset.id,
    sourceMetadata: dataset.sourceMetadata,
    ...cloneWorkingState(dataset)
  };

  const result = op.execute(tempDs, params);
  return {
    operationType,
    label: op.label,
    riskLevel: op.riskLevel,
    params,
    summary: result.summary,
    cellChanges: (result.cellChanges || []).slice(0, 50),
    totalCellChanges: (result.cellChanges || []).length,
    rowsBefore: result.rowsBefore,
    rowsAfter: result.rowsAfter,
    addedColumns: result.addedColumns || [],
    removedColumns: result.removedColumns || [],
    previewColumns: tempDs.columns,
    previewRows: tempDs.rows.slice(0, 25)
  };
}

/**
 * Applies a registered operation transactionally to the dataset, pushing a snapshot to history for Undo/Redo.
 */
export function applyTransformation(dataset, operationType, params = {}) {
  const op = OPERATION_REGISTRY[operationType];
  if (!op) throw new Error(`Unknown operation type "${operationType}".`);

  const preState = cloneWorkingState(dataset);
  try {
    const result = op.execute(dataset, params);
    const stepRecord = {
      stepId: `step_${dataset.history.length + 1}_${Date.now().toString(36).slice(-4)}`,
      timestamp: new Date().toISOString(),
      operationType,
      label: op.label,
      category: op.category,
      riskLevel: op.riskLevel,
      params: structuredClone(params),
      summary: result.summary,
      rowsBefore: result.rowsBefore,
      rowsAfter: result.rowsAfter,
      cellChangeCount: (result.cellChanges || []).length,
      sampleCellChanges: (result.cellChanges || []).slice(0, 30),
      addedColumns: result.addedColumns || [],
      removedColumns: result.removedColumns || [],
      renamedColumns: result.renamedColumns || [],
      preState
    };
    dataset.history.push(stepRecord);
    dataset.redoStack = [];
    dataset.revision += 1;
    dataset.updatedAt = stepRecord.timestamp;
    return stepRecord;
  } catch (err) {
    // Transactional rollback on error
    dataset.columns = preState.columns;
    dataset.rows = preState.rows;
    dataset.learnedParameters = preState.learnedParameters;
    throw err;
  }
}

/**
 * Undo the most recent operation, restoring exact previous data state.
 */
export function undoTransformation(dataset) {
  if (!dataset.history || dataset.history.length === 0) return null;
  const lastStep = dataset.history.pop();
  const currentState = cloneWorkingState(dataset);
  dataset.columns = structuredClone(lastStep.preState.columns);
  dataset.rows = structuredClone(lastStep.preState.rows);
  dataset.learnedParameters = structuredClone(lastStep.preState.learnedParameters || {});
  dataset.redoStack.push({
    ...lastStep,
    postState: currentState
  });
  dataset.revision += 1;
  dataset.updatedAt = new Date().toISOString();
  return lastStep;
}

/**
 * Redo the most recently undone operation.
 */
export function redoTransformation(dataset) {
  if (!dataset.redoStack || dataset.redoStack.length === 0) return null;
  const nextStep = dataset.redoStack.pop();
  const preState = cloneWorkingState(dataset);
  dataset.columns = structuredClone(nextStep.postState.columns);
  dataset.rows = structuredClone(nextStep.postState.rows);
  dataset.learnedParameters = structuredClone(nextStep.postState.learnedParameters || {});
  dataset.history.push({
    ...nextStep,
    preState
  });
  dataset.revision += 1;
  dataset.updatedAt = new Date().toISOString();
  return nextStep;
}

/**
 * Fuzzy Candidate Duplicate Detection (Part 14.3).
 */
export function detectFuzzyDuplicateCandidates(dataset, colIdOrName, threshold = 2) {
  const col = resolveColumn(dataset, colIdOrName);
  if (!col) return [];
  const candidates = [];
  const rows = dataset.rows;
  const limit = Math.min(rows.length, 300);

  for (let i = 0; i < limit; i++) {
    const rawA = String(rows[i].cells[col.id]?.raw ?? '').trim();
    if (!rawA) continue;
    const normA = rawA.toLowerCase().replace(/[^a-z0-9\s]/g, '');

    for (let j = i + 1; j < limit; j++) {
      const rawB = String(rows[j].cells[col.id]?.raw ?? '').trim();
      if (!rawB || rawA === rawB) continue;
      const normB = rawB.toLowerCase().replace(/[^a-z0-9\s]/g, '');
      const dist = editDistance(normA, normB);
      if (dist <= threshold && Math.min(normA.length, normB.length) >= 4) {
        candidates.push({
          rowIdA: rows[i]._rowId,
          rowIdB: rows[j]._rowId,
          valueA: rawA,
          valueB: rawB,
          editDistance: dist,
          similarity: Number((1 - dist / Math.max(normA.length, normB.length)).toFixed(3))
        });
      }
    }
  }
  return candidates;
}
