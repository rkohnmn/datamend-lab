/**
 * DataMend Lab — Main Application Controller & 11-Workspace Interactive UI
 * Coordinates state, multi-dataset project memory, import previews, profiling,
 * diagnosis, cleaning approvals, restructuring, joins, recipe replay, validation,
 * before/after comparison, code generation, and Knowledge Atlas navigation.
 *
 * Designed for high scanability with progressive disclosure (<details class="disclosure">),
 * zero emojis, and native HTML mathematical typography (<span class="math-expr">).
 */

import {
  MISSING_STATES,
  SEMANTIC_TYPES,
  VARIABLE_ROLES,
  createDataset,
  restoreOriginalDataset
} from './data-model.js';
import {
  parseDelimitedText,
  parseJsonContent,
  parseXlsxWorkbook,
  buildDatasetFromParsed
} from './parsers.js';
import { profileDataset } from './profiler.js';
import { diagnoseDataset, RISK_LEVELS } from './diagnosis.js';
import {
  OPERATION_REGISTRY,
  previewTransformation,
  applyTransformation,
  undoTransformation,
  redoTransformation,
  detectFuzzyDuplicateCandidates,
  resolveColumn
} from './transforms.js';
import {
  inspectJoinDiagnostics,
  executeDatasetJoin,
  executeDatasetAppend
} from './restructure.js';
import {
  VALIDATION_RULE_TYPES,
  runValidationSuite,
  computeQualityScorecard,
  computeBeforeAfterComparison
} from './validation.js';
import {
  exportCleaningRecipe,
  validateRecipeCompatibility,
  replayCleaningRecipe,
  exportToDelimitedText,
  exportToXlsxBytes,
  exportToDataSenseJson,
  exportToJsonRecords,
  generateRScript,
  generatePythonScript,
  generateQualityAuditReport
} from './exporters.js';
import {
  renderMissingnessMatrix,
  renderColumnDistribution,
  renderBeforeAfterScorecardChart
} from './renderer.js';
import {
  SYNTHETIC_PRESETS,
  GUIDED_INVESTIGATIONS,
  KNOWLEDGE_ATLAS_ENTRIES
} from './presets.js';
import {
  loadSavedRecipes,
  saveRecipeToStorage,
  clearAllBrowserStorage,
  encodeWorkspaceHashState,
  decodeWorkspaceHashState
} from './storage.js';

export const APP_STATE = {
  brandName: 'DataMend Lab',
  activeView: 'home',
  explanationMode: 'standard', // 'simple', 'standard', 'technical'
  cleaningMode: 'assisted', // 'inspect', 'assisted', 'safe_batch', 'custom_recipe'
  datasets: [],
  activeDatasetId: null,
  selectedColId: null,
  selectedIssueId: null,
  selectedOperationType: 'TRIM_WHITESPACE',
  pendingImportPreview: null,
  tablePage: 0,
  tablePageSize: 50,
  tableSearchQuery: '',
  atlasSearchQuery: '',
  atlasDomainFilter: 'ALL',
  nlCommandInput: '',
  nlProposal: null,
  joinPreviewResult: null,
  recipeDriftReport: null,
  uploadedRecipe: null
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats mathematical expressions cleanly into HTML <span class="math-expr">, <sub>, <sup>, and overline
 * so zero unrendered LaTeX strings or raw backslashes ever appear in the UI.
 */
export function formatMathHtml(str) {
  let s = escapeHtml(str ?? '');
  // Convert remaining $...$ if any
  s = s.replace(/\$([^$]+)\$/g, (_, inner) => `<span class="math-expr">${inner}</span>`);
  // Convert common statistical tokens to subscript/superscript/overline HTML
  s = s
    .replace(/\bx̄_obs\b/g, '<span class="math-expr"><span class="math-overline">x</span><sub>obs</sub></span>')
    .replace(/\bx̄\b/g, '<span class="math-expr"><span class="math-overline">x</span></span>')
    .replace(/\bx̃\b/g, '<span class="math-expr">x&#771;</span>')
    .replace(/\bMAD_σ\b/g, '<span class="math-expr">MAD<sub>&sigma;</sub></span>')
    .replace(/\bs_x\b/g, '<span class="math-expr">s<sub>x</sub></span>')
    .replace(/\bs²\b/g, '<span class="math-expr">s<sup>2</sup></span>')
    .replace(/\bSS_xx\b/g, '<span class="math-expr">SS<sub>xx</sub></span>')
    .replace(/\bn_obs\b/g, '<span class="math-expr">n<sub>obs</sub></span>')
    .replace(/\bn_eff\b/g, '<span class="math-expr">n<sub>eff</sub></span>')
    .replace(/\bY_obs\b/g, '<span class="math-expr">Y<sub>obs</sub></span>')
    .replace(/\bY_mis\b/g, '<span class="math-expr">Y<sub>mis</sub></span>')
    .replace(/\bD_train\b/g, '<span class="math-expr">D<sub>train</sub></span>')
    .replace(/\bD_test\b/g, '<span class="math-expr">D<sub>test</sub></span>')
    .replace(/\bθ̂_prep\b/g, '<span class="math-expr">&theta;&#770;<sub>prep</sub></span>')
    .replace(/\bQ_1\b/g, '<span class="math-expr">Q<sub>1</sub></span>')
    .replace(/\bQ_2\b/g, '<span class="math-expr">Q<sub>2</sub></span>')
    .replace(/\bQ_3\b/g, '<span class="math-expr">Q<sub>3</sub></span>')
    .replace(/\bD_i\b/g, '<span class="math-expr">D<sub>i</sub></span>')
    .replace(/\bt_i\b/g, '<span class="math-expr">t<sub>i</sub></span>')
    .replace(/\bt_j\b/g, '<span class="math-expr">t<sub>j</sub></span>')
    .replace(/\bz_i\b/g, '<span class="math-expr">z<sub>i</sub></span>')
    .replace(/\bO_ij\b/g, '<span class="math-expr">O<sub>ij</sub></span>')
    .replace(/\bχ²\b/g, '<span class="math-expr">&chi;<sup>2</sup></span>')
    .replace(/\bρ_s\b/g, '<span class="math-expr">&rho;<sub>s</sub></span>')
    .replace(/\bd_L\b/g, '<span class="math-expr">d<sub>L</sub></span>')
    .replace(/\bs_1\b/g, '<span class="math-expr">s<sub>1</sub></span>')
    .replace(/\bs_2\b/g, '<span class="math-expr">s<sub>2</sub></span>')
    .replace(/\bt_1\b/g, '<span class="math-expr">t<sub>1</sub></span>')
    .replace(/\bt_2\b/g, '<span class="math-expr">t<sub>2</sub></span>')
    .replace(/\bt_T\b/g, '<span class="math-expr">t<sub>T</sub></span>')
    .replace(/\bX_1\b/g, '<span class="math-expr">X<sub>1</sub></span>')
    .replace(/\bX_p\b/g, '<span class="math-expr">X<sub>p</sub></span>')
    .replace(/\bR\^n\b/g, '<span class="math-expr">R<sup>n</sup></span>')
    .replace(/\bΣ_raw\b/g, '<span class="math-expr">&Sigma;<sub>raw</sub></span>')
    .replace(/\bΣ_canonical\b/g, '<span class="math-expr">&Sigma;<sub>canonical</sub></span>')
    .replace(/\bπ_K\b/g, '<span class="math-expr">&pi;<sub>K</sub></span>')
    .replace(/\bπ_¬K\b/g, '<span class="math-expr">&pi;<sub>&not;K</sub></span>');
  return s;
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'toast-error' : type === 'warning' ? 'toast-warning' : ''}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" class="btn btn-sm" aria-label="Dismiss notification">Close</button>`;
  el.querySelector('button').addEventListener('click', () => el.remove());
  container.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 4800);
}

function getActiveDataset() {
  return APP_STATE.datasets.find(d => d.id === APP_STATE.activeDatasetId) || APP_STATE.datasets[0] || null;
}

function loadPresetDataset(presetId, switchToView = null) {
  const preset = SYNTHETIC_PRESETS.find(p => p.id === presetId) || SYNTHETIC_PRESETS[0];
  if (!preset) return null;

  const existing = APP_STATE.datasets.find(d => d.id === preset.id);
  if (existing) {
    APP_STATE.activeDatasetId = existing.id;
    APP_STATE.selectedColId = existing.columns[0]?.id || null;
    if (switchToView) APP_STATE.activeView = switchToView;
    renderApp();
    return existing;
  }

  const ds = createDataset({
    id: preset.id,
    title: preset.title,
    description: preset.learningObjectives.join(' '),
    sourceFilename: `${preset.id}.csv`,
    sourceFormat: 'SYNTHETIC_PRESET',
    columnNames: preset.columnNames,
    rawRows: preset.rawRows
  });

  APP_STATE.datasets.push(ds);
  APP_STATE.activeDatasetId = ds.id;
  APP_STATE.selectedColId = ds.columns[0]?.id || null;
  if (switchToView) APP_STATE.activeView = switchToView;
  renderApp();
  return ds;
}

/**
 * Deterministic Natural-Language Command Parser (Part 29)
 */
export function parseNaturalLanguageCommand(inputStr, dataset) {
  const text = String(inputStr || '').trim();
  if (!text || !dataset) return null;
  const lower = text.toLowerCase();

  const matchedCol = dataset.columns.find(c => lower.includes(c.displayName.toLowerCase()));
  const colName = matchedCol ? matchedCol.displayName : dataset.columns[0]?.displayName;

  if (lower.includes('trim') || lower.includes('space') || lower.includes('whitespace')) {
    return {
      operationType: 'TRIM_WHITESPACE',
      params: { columnName: colName, normalizeInternal: true },
      rationale: `Whitespace normalization on "${colName}".`
    };
  }
  if (lower.includes('duplicate') && (lower.includes('remove') || lower.includes('drop') || lower.includes('dedup'))) {
    return {
      operationType: 'DEDUPLICATE_EXACT',
      params: { strategy: 'keep_first' },
      rationale: 'Remove exact duplicate records (keep first).'
    };
  }
  if (lower.includes('split') && matchedCol) {
    return {
      operationType: 'SPLIT_COLUMN',
      params: { columnName: colName, delimiter: ' ', newColumnNames: [`${colName}_first`, `${colName}_last`] },
      rationale: `Split column "${colName}" by space delimiter.`
    };
  }
  if (lower.includes('month') || lower.includes('unpivot') || lower.includes('wide to long') || lower.includes('into rows')) {
    const idCols = dataset.columns.slice(0, 2).map(c => c.displayName);
    const valCols = dataset.columns.slice(2).map(c => c.displayName);
    return {
      operationType: 'UNPIVOT_WIDE_TO_LONG',
      params: { idColumns: idCols, valueColumns: valCols, variableColumnName: 'period', valueColumnName: 'measurement' },
      rationale: `Unpivot [${valCols.join(', ')}] into rows.`
    };
  }
  if (lower.includes('date') || lower.includes('iso')) {
    return {
      operationType: 'PARSE_DATES',
      params: { columnName: colName, dateFormat: lower.includes('dmy') || lower.includes('eu') ? 'DMY' : 'MDY' },
      rationale: `Date standardization on "${colName}".`
    };
  }
  if (lower.includes('outlier') || lower.includes('anomal')) {
    return {
      operationType: 'FLAG_OUTLIERS',
      params: { columnName: colName, method: 'tukey_iqr' },
      rationale: `Non-destructive Tukey 1.5 × IQR outlier flag on "${colName}".`
    };
  }
  if (lower.includes('upper') || lower.includes('lower') || lower.includes('title') || lower.includes('case')) {
    const mode = lower.includes('upper') ? 'upper' : lower.includes('lower') ? 'lower' : 'title';
    return {
      operationType: 'STANDARDIZE_CASE',
      params: { columnName: colName, mode },
      rationale: `Case standardization (${mode}) on "${colName}".`
    };
  }
  return {
    unsupported: true,
    rationale: `No single deterministic operation matched "${text}". Select an operation from the catalog below.`
  };
}

function triggerDownload(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const safeName = filename.replace(/[^a-zA-Z0-9._\-]/g, '_');
  const blob = content instanceof Uint8Array
    ? new Blob([content], { type: mimeType })
    : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast(`Exported ${safeName}`, 'info');
}

function openPreviewModal(dataset, operationType, params) {
  const backdrop = document.getElementById('preview-modal-backdrop');
  const body = document.getElementById('preview-modal-body');
  if (!backdrop || !body) return;

  try {
    const preview = previewTransformation(dataset, operationType, params);
    const riskBadgeClass =
      preview.riskLevel === RISK_LEVELS.HIGH ? 'badge-high'
        : preview.riskLevel === RISK_LEVELS.MEDIUM ? 'badge-medium' : 'badge-low';

    const changesRowsHtml = preview.cellChanges.length > 0
      ? preview.cellChanges.slice(0, 15).map(ch => `
          <tr>
            <td><code>${escapeHtml(ch.rowId)}</code></td>
            <td><code>${escapeHtml(ch.column)}</code></td>
            <td class="cell-missing">${escapeHtml(ch.oldVal)}</td>
            <td class="cell-changed">${escapeHtml(ch.newVal)}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="4">Structural or row-level operation (${preview.rowsBefore} → ${preview.rowsAfter} rows).</td></tr>`;

    body.innerHTML = `
      <div class="metric-strip">
        <div class="metric-card">
          <div class="metric-label">Operation</div>
          <div class="metric-value" style="font-size:15px;">${escapeHtml(preview.label)}</div>
          <div class="metric-sub"><code>${escapeHtml(preview.operationType)}</code></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Risk Level</div>
          <div class="metric-value"><span class="badge ${riskBadgeClass}">${escapeHtml(preview.riskLevel)}</span></div>
          <div class="metric-sub">Reversible via Undo</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Row Impact</div>
          <div class="metric-value">${preview.rowsBefore} → ${preview.rowsAfter}</div>
          <div class="metric-sub">Delta: ${preview.rowsAfter - preview.rowsBefore} rows</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Cells Modified</div>
          <div class="metric-value">${preview.totalCellChanges}</div>
          <div class="metric-sub">Added cols: ${preview.addedColumns.length}</div>
        </div>
      </div>

      <div class="module-card">
        <div class="module-header"><div class="module-title">Impact Summary</div></div>
        <div class="module-body compact">
          <p>${escapeHtml(preview.summary)}</p>
        </div>
      </div>

      <div class="module-card">
        <div class="module-header"><div class="module-title">Sample Cell Changes (Before → After)</div></div>
        <div class="data-table-wrapper" style="max-height:220px;">
          <table class="data-table">
            <thead><tr><th>Row ID</th><th>Column</th><th>Before</th><th>After</th></tr></thead>
            <tbody>${changesRowsHtml}</tbody>
          </table>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px;">
        <button type="button" class="btn" id="btn-modal-cancel">Reject</button>
        <button type="button" class="btn btn-primary" id="btn-modal-approve">Approve &amp; Execute</button>
      </div>
    `;

    backdrop.hidden = false;

    document.getElementById('btn-modal-cancel')?.addEventListener('click', () => {
      backdrop.hidden = true;
    });
    document.getElementById('btn-modal-approve')?.addEventListener('click', () => {
      if (APP_STATE.cleaningMode === 'inspect') {
        showToast('Workspace is in "Inspect Only" mode. Switch to Assisted Cleaning to apply changes.', 'warning');
        return;
      }
      applyTransformation(dataset, operationType, params);
      backdrop.hidden = true;
      showToast(`Applied: ${preview.label}`, 'info');
      renderApp();
    });
  } catch (err) {
    showToast(`Preview Error: ${err.message}`, 'error');
  }
}

function renderWorkflowStepper() {
  const steps = [
    { view: 'home', label: 'Import' },
    { view: 'inspector', label: 'Inspect' },
    { view: 'audit', label: 'Diagnose' },
    { view: 'cleaning', label: 'Clean' },
    { view: 'restructure', label: 'Restructure' },
    { view: 'validation', label: 'Validate' },
    { view: 'comparison', label: 'Compare' },
    { view: 'export', label: 'Export' },
    { view: 'recipes', label: 'Reproduce' }
  ];
  return `
    <div class="workflow-stepper" role="navigation" aria-label="Data preparation workflow stages">
      <strong style="margin-right:4px; color:var(--color-text);">Pipeline:</strong>
      ${steps.map((s, idx) => `
        <button type="button" class="step-node ${APP_STATE.activeView === s.view ? 'active' : ''}" data-goto-view="${s.view}">
          ${idx + 1}. ${escapeHtml(s.label)}
        </button>
        ${idx < steps.length - 1 ? '<span class="step-arrow">→</span>' : ''}
      `).join('')}
    </div>
  `;
}

function renderDatasetTableHtml(dataset, maxRows = 50) {
  if (!dataset || dataset.columns.length === 0) {
    return `<p>No columns available in dataset.</p>`;
  }

  const query = APP_STATE.tableSearchQuery.trim().toLowerCase();
  const filteredRows = query
    ? dataset.rows.filter(r =>
        r._rowId.toLowerCase().includes(query) ||
        dataset.columns.some(c => String(r.cells[c.id]?.raw ?? '').toLowerCase().includes(query))
      )
    : dataset.rows;

  const totalRows = filteredRows.length;
  const pageSize = maxRows;
  const maxPage = Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  if (APP_STATE.tablePage > maxPage) APP_STATE.tablePage = maxPage;
  const start = APP_STATE.tablePage * pageSize;
  const slice = filteredRows.slice(start, start + pageSize);

  const origRowMap = new Map(dataset.originalSnapshot.rows.map(r => [r._rowId, r]));

  const ths = dataset.columns.map(col => {
    const activeType = col.confirmedType || col.semanticType;
    const isNum = activeType === SEMANTIC_TYPES.INTEGER || activeType === SEMANTIC_TYPES.DECIMAL;
    const isSelected = col.id === APP_STATE.selectedColId;
    return `
      <th class="${isNum ? 'num' : ''}" style="${isSelected ? 'background-color:var(--color-primary-soft);' : ''} cursor:pointer;" data-select-col="${col.id}" title="Inspect column ${escapeHtml(col.displayName)}">
        <div>${escapeHtml(col.displayName)} ${col.unit ? `<span class="badge badge-neutral">${escapeHtml(col.unit)}</span>` : ''}</div>
        <div style="font-size:10px; color:var(--color-text-muted); font-weight:400;">${escapeHtml(activeType)}</div>
      </th>
    `;
  }).join('');

  const trs = slice.map(row => {
    const origRow = origRowMap.get(row._rowId);
    const tds = dataset.columns.map(col => {
      const cell = row.cells[col.id];
      const activeType = col.confirmedType || col.semanticType;
      const isNum = activeType === SEMANTIC_TYPES.INTEGER || activeType === SEMANTIC_TYPES.DECIMAL;
      if (!cell) return `<td class="cell-missing"><span class="cell-tag">NULL</span></td>`;

      let cls = isNum ? 'num ' : '';
      let tagHtml = '';
      if (cell.missingState === MISSING_STATES.MISSING || cell.missingState === MISSING_STATES.EMPTY_STRING) {
        cls += 'cell-missing';
        tagHtml = '<span class="cell-tag">MISS</span>';
      } else if (cell.missingState === MISSING_STATES.NOT_APPLICABLE || cell.missingState === MISSING_STATES.WITHHELD) {
        cls += 'cell-missing';
        tagHtml = '<span class="cell-tag">N/A</span>';
      } else if (cell.missingState === MISSING_STATES.INVALID_PARSE || cell.missingState === MISSING_STATES.NONFINITE || cell.validationState === 'AMBIGUOUS_DATE') {
        cls += 'cell-invalid';
        tagHtml = '<span class="cell-tag">WARN</span>';
      } else if (cell.isImputed) {
        cls += 'cell-imputed';
        tagHtml = '<span class="cell-tag">IMP</span>';
      } else if (origRow && origRow.cells[col.id] && String(origRow.cells[col.id].raw) !== String(cell.raw)) {
        cls += 'cell-changed';
        tagHtml = '<span class="cell-tag">MOD</span>';
      }

      return `<td class="${cls}" title="Raw: ${escapeHtml(cell.raw)} | State: ${escapeHtml(cell.missingState)} | Validation: ${escapeHtml(cell.validationState)}">${tagHtml}${escapeHtml(cell.formatted)}</td>`;
    }).join('');

    return `<tr><td style="color:var(--color-text-muted); font-size:11px;">${escapeHtml(row._rowId)}</td>${tds}</tr>`;
  }).join('');

  return `
    <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <input type="search" class="input input-sm" id="table-search-input" placeholder="Filter rows…" value="${escapeHtml(APP_STATE.tableSearchQuery)}" aria-label="Search table rows">
        <span class="mono" style="font-size:12px; color:var(--color-text-muted);">
          ${totalRows === 0 ? 0 : start + 1}–${Math.min(totalRows, start + pageSize)} of ${totalRows} rows (${dataset.columns.length} cols)
        </span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <button type="button" class="btn btn-sm" id="btn-table-prev" ${APP_STATE.tablePage <= 0 ? 'disabled' : ''}>← Prev</button>
        <span class="mono" style="font-size:12px;">${APP_STATE.tablePage + 1} / ${maxPage + 1}</span>
        <button type="button" class="btn btn-sm" id="btn-table-next" ${APP_STATE.tablePage >= maxPage ? 'disabled' : ''}>Next →</button>
      </div>
    </div>
    <div class="data-table-wrapper">
      <table class="data-table" aria-label="Dataset observations table">
        <thead>
          <tr><th style="width:72px;">Row ID</th>${ths}</tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
    <div style="margin-top:6px; font-size:11px; color:var(--color-text-muted); display:flex; flex-wrap:wrap; gap:12px;">
      <span><strong>Cell Badges:</strong></span>
      <span><code>MOD</code> Modified</span>
      <span><code>IMP</code> Imputed</span>
      <span><code>MISS</code> Missing</span>
      <span><code>N/A</code> Withheld / Not Applicable</span>
      <span><code>WARN</code> Parse Error / Ambiguous Date</span>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 1: HOME & DATA IMPORT ENGINE (Parts 5.1 & 6)
// ============================================================================
function renderHomeWorkspace(ds, profile, issues) {
  const pending = APP_STATE.pendingImportPreview;
  const pendingHtml = pending ? `
    <div class="module-card" style="border:2px solid var(--color-primary);">
      <div class="module-header">
        <div class="module-title">Import Preview — ${escapeHtml(pending.filename)}</div>
        <span class="badge badge-primary">${escapeHtml(pending.format)} (${pending.sizeBytes} B)</span>
      </div>
      <div class="module-body">
        <div class="bento-grid-12">
          <div class="col-span-4">
            <div class="form-group">
              <label class="form-label" for="imp-delim">Delimiter Override</label>
              <select id="imp-delim" class="select">
                <option value="," ${pending.delimiter === ',' ? 'selected' : ''}>Comma (,)</option>
                <option value="&#9;" ${pending.delimiter === '\t' ? 'selected' : ''}>Tab (\t)</option>
                <option value=";" ${pending.delimiter === ';' ? 'selected' : ''}>Semicolon (;)</option>
                <option value="|" ${pending.delimiter === '|' ? 'selected' : ''}>Pipe (|)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="imp-decimal">Decimal Separator</label>
              <select id="imp-decimal" class="select">
                <option value=".">Period (1,234.56)</option>
                <option value=",">Comma (1.234,56)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">
                <input type="checkbox" id="imp-header" ${pending.hasHeader !== false ? 'checked' : ''}> First row has column headers
              </label>
            </div>
            ${pending.sheets ? `
              <div class="form-group">
                <label class="form-label" for="imp-sheet">Worksheet (${pending.sheets.length})</label>
                <select id="imp-sheet" class="select">
                  ${pending.sheets.map((s, idx) => `<option value="${idx}" ${idx === (pending.selectedSheetIdx || 0) ? 'selected' : ''}>${escapeHtml(s.name)} (${s.rawRows.length} rows)${s.hidden ? ' [Hidden]' : ''}</option>`).join('')}
                </select>
              </div>
            ` : ''}
            ${pending.candidatePaths && pending.candidatePaths.length > 1 ? `
              <div class="form-group">
                <label class="form-label" for="imp-json-path">JSON Record Path</label>
                <select id="imp-json-path" class="select">
                  ${pending.candidatePaths.map(p => `<option value="${escapeHtml(p)}" ${p === pending.selectedPath ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          </div>
          <div class="col-span-8">
            <p style="font-size:13px; margin-bottom:8px;">
              <strong>Dimensions:</strong> ${pending.rawRows.length} rows × ${pending.columnNames.length} cols |
              <strong>Parser Warnings:</strong> ${(pending.warnings || []).length}
            </p>
            ${(pending.warnings || []).length > 0 ? `
              <div style="background:var(--color-warning-soft); border:1px solid var(--color-warning); padding:8px; border-radius:4px; margin-bottom:8px; font-size:12px;">
                ${pending.warnings.slice(0, 4).map(w => `<div>• [${escapeHtml(w.code)}] ${escapeHtml(w.message)}</div>`).join('')}
              </div>
            ` : ''}
            <div class="data-table-wrapper" style="max-height:190px;">
              <table class="data-table">
                <thead><tr>${pending.columnNames.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                <tbody>
                  ${pending.rawRows.slice(0, 5).map(r => `<tr>${pending.columnNames.map((_, i) => `<td>${escapeHtml(typeof r[i] === 'object' && r[i] !== null ? JSON.stringify(r[i]) : r[i])}</td>`).join('')}</tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
              <button type="button" class="btn" id="btn-cancel-import">Cancel</button>
              <button type="button" class="btn btn-primary" id="btn-commit-import">Commit Dataset to Workspace</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ` : '';

  return `
    ${renderWorkflowStepper()}
    ${pendingHtml}

    <div class="bento-grid-12">
      <!-- Left 7 Columns: Quick Actions, File Import & Active Dataset Preview -->
      <div class="col-span-7">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Data Preparation Workbench</div>
            <span class="badge badge-primary">Local Browser Processing</span>
          </div>
          <div class="module-body compact">
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;">
              <button type="button" class="btn btn-sm btn-primary" data-goto-view="audit">Quality Audit (${issues.length} Findings)</button>
              <button type="button" class="btn btn-sm" data-goto-view="cleaning">Cleaning Studio</button>
              <button type="button" class="btn btn-sm" data-goto-view="restructure">Restructure &amp; Joins</button>
              <button type="button" class="btn btn-sm" data-goto-view="recipes">Recipe Builder</button>
              <button type="button" class="btn btn-sm" data-goto-view="atlas">Knowledge Atlas</button>
            </div>

            <div class="dropzone" id="file-dropzone" tabindex="0" role="button" aria-label="Upload CSV, TSV, XLSX, JSON, or NDJSON dataset file" style="padding:14px;">
              <div style="font-weight:600; font-size:14px; margin-bottom:4px;">
                Drop CSV, TSV, Excel (.xlsx), JSON, NDJSON, or DataSense JSON files here
              </div>
              <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">
                Preserves raw values, leading-zero identifiers, multi-sheet workbooks, and transformation lineage.
              </div>
              <input type="file" id="file-upload-input" accept=".csv,.tsv,.txt,.xlsx,.json,.ndjson" multiple style="display:none;">
              <button type="button" class="btn btn-sm btn-primary" id="btn-trigger-file-input">Browse Local Files</button>
              <button type="button" class="btn btn-sm" id="btn-paste-manual-data">Paste / Enter Manual Text</button>
            </div>

            <div id="manual-entry-panel" hidden style="margin-top:10px; padding:10px; border:1px solid var(--color-border); border-radius:6px;">
              <label class="form-label" for="manual-csv-textarea">Paste Delimited Text (CSV / TSV) or JSON Records</label>
              <textarea id="manual-csv-textarea" class="input mono" rows="4" placeholder="id,category,measurement&#10;001,Alpha,42.5&#10;002,Beta,51.0"></textarea>
              <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
                <button type="button" class="btn btn-sm" id="btn-cancel-manual">Cancel</button>
                <button type="button" class="btn btn-sm btn-primary" id="btn-parse-manual">Preview Manual Dataset</button>
              </div>
            </div>
          </div>
        </div>

        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Active Dataset — ${escapeHtml(ds.title)}</div>
            <span class="badge badge-neutral">Fingerprint: ${escapeHtml(ds.sourceMetadata?.fingerprint || 'N/A')}</span>
          </div>
          <div class="module-body compact">
            ${renderDatasetTableHtml(ds, 10)}
          </div>
        </div>
      </div>

      <!-- Right 5 Columns: Synthetic Example Library & Collapsible Ecosystem Info -->
      <div class="col-span-5">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Synthetic Benchmark Datasets</div>
            <span class="badge badge-warning">${SYNTHETIC_PRESETS.length} Scenarios</span>
          </div>
          <div class="module-body compact">
            ${SYNTHETIC_PRESETS.map(p => `
              <div class="issue-item ${ds.id === p.id ? 'selected' : ''}" data-load-preset="${p.id}" style="padding:7px 10px; margin-bottom:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                  <strong style="font-size:12px;">${escapeHtml(p.title)}</strong>
                  <span class="badge badge-neutral">${escapeHtml(p.category)}</span>
                </div>
                <div style="font-size:11px; color:var(--color-text-muted); margin-top:2px;">
                  ${escapeHtml(p.learningObjectives[0])}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <details class="disclosure">
          <summary>
            <span>DataSense Studio Ecosystem Interoperability</span>
            <span class="badge badge-neutral">4 Sister Tools</span>
          </summary>
          <div class="disclosure-body">
            <p style="font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">
              Exports schema-validated <code>DataSenseDataset</code> (v1.0.0) JSON packages preserving variable roles, units, and imputation flags:
            </p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:12px;">
              <div style="padding:6px; border:1px solid var(--color-border); border-radius:4px;">
                <strong>QuartetLab</strong> — OLS regression &amp; Cook's distance (<span class="math-expr">D<sub>i</sub></span>).
              </div>
              <div style="padding:6px; border:1px solid var(--color-border); border-radius:4px;">
                <strong>VisualGrammar</strong> — Chart selection &amp; encoding audit.
              </div>
              <div style="padding:6px; border:1px solid var(--color-border); border-radius:4px;">
                <strong>ResampleLab</strong> — Bootstrap intervals &amp; permutation tests.
              </div>
              <div style="padding:6px; border:1px solid var(--color-border); border-radius:4px;">
                <strong>ForecastLab</strong> — Time-series decomposition &amp; forecasts.
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 2: DATA INSPECTOR & PROFILING ENGINE (Parts 5.2, 7, 8)
// ============================================================================
function renderInspectorWorkspace(ds, profile) {
  const selectedCol = ds.columns.find(c => c.id === APP_STATE.selectedColId) || ds.columns[0];
  const colProf = profile.columnProfiles.find(cp => cp.colId === selectedCol?.id) || profile.columnProfiles[0];

  const quantStatsHtml = colProf?.numericStats ? `
    <div class="metric-strip" style="margin-top:8px;">
      <div class="metric-card"><div class="metric-label">Mean (<span class="math-expr"><span class="math-overline">x</span></span>)</div><div class="metric-value">${colProf.numericStats.mean.toFixed(4)}</div></div>
      <div class="metric-card"><div class="metric-label">Sample SD (<span class="math-expr">s</span>)</div><div class="metric-value">${colProf.numericStats.sd.toFixed(4)}</div></div>
      <div class="metric-card"><div class="metric-label">Median (<span class="math-expr">Q<sub>2</sub></span>)</div><div class="metric-value">${colProf.numericStats.median.toFixed(4)}</div></div>
      <div class="metric-card"><div class="metric-label">IQR (Type 7)</div><div class="metric-value">${colProf.numericStats.iqr.toFixed(4)}</div></div>
      <div class="metric-card"><div class="metric-label"><span class="math-expr">MAD<sub>&sigma;</sub></span></div><div class="metric-value">${colProf.numericStats.madSigma.toFixed(4)}</div></div>
      <div class="metric-card"><div class="metric-label">Min / Max</div><div class="metric-value" style="font-size:14px;">[${colProf.numericStats.min}, ${colProf.numericStats.max}]</div></div>
    </div>
  ` : `
    <div style="padding:6px 10px; background:var(--color-surface-alt); border:1px solid var(--color-border); border-radius:4px; margin-top:8px; font-size:12px;">
      <strong>Identifier / Non-Quantitative Guard:</strong> Column <code>${escapeHtml(colProf?.displayName)}</code> has type <code>${escapeHtml(colProf?.semanticType)}</code> (mean and SD omitted).
    </div>
  `;

  return `
    ${renderWorkflowStepper()}
    <div class="metric-strip">
      <div class="metric-card"><div class="metric-label">Observations (<span class="math-expr">n</span>)</div><div class="metric-value">${profile.rowCount}</div><div class="metric-sub">${profile.completeRowCount} complete</div></div>
      <div class="metric-card"><div class="metric-label">Variables (<span class="math-expr">p</span>)</div><div class="metric-value">${profile.colCount}</div><div class="metric-sub">Keys: ${profile.relationships.candidatePrimaryKeys.length}</div></div>
      <div class="metric-card"><div class="metric-label">Completeness</div><div class="metric-value">${profile.overallCompleteness.toFixed(1)}%</div><div class="metric-sub">${profile.totalMissingCells} missing cells</div></div>
      <div class="metric-card"><div class="metric-label">Exact Duplicates</div><div class="metric-value">${profile.exactDuplicateRowCount}</div><div class="metric-sub">${profile.relationships.duplicateRowGroups.length} group(s)</div></div>
      <div class="metric-card"><div class="metric-label">Parse / Ambiguous</div><div class="metric-value">${profile.totalInvalidCells + profile.totalAmbiguousCells}</div><div class="metric-sub">${profile.totalAmbiguousCells} ambiguous dates</div></div>
    </div>

    <div class="bento-grid-12">
      <div class="col-span-7">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Variable Profile — ${escapeHtml(selectedCol?.displayName)}</div>
            <select id="inspector-col-select" class="select select-sm" aria-label="Select Variable">
              ${ds.columns.map(c => `<option value="${c.id}" ${c.id === selectedCol?.id ? 'selected' : ''}>${escapeHtml(c.displayName)} (${c.confirmedType || c.semanticType})</option>`).join('')}
            </select>
          </div>
          <div class="module-body compact">
            <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; margin-bottom:8px;">
              <div>
                <label class="form-label" for="ins-type-select">Semantic Type</label>
                <select id="ins-type-select" class="select select-sm">
                  ${Object.values(SEMANTIC_TYPES).map(t => `<option value="${t}" ${(selectedCol.confirmedType || selectedCol.semanticType) === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="form-label" for="ins-role-select">Analytical Role</label>
                <select id="ins-role-select" class="select select-sm">
                  ${Object.values(VARIABLE_ROLES).map(r => `<option value="${r}" ${selectedCol.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="form-label" for="ins-unit-input">Unit</label>
                <input type="text" id="ins-unit-input" class="input input-sm" placeholder="USD, kg, cm" value="${escapeHtml(selectedCol.unit || '')}" style="width:95px;">
              </div>
              <button type="button" class="btn btn-sm btn-primary" id="btn-apply-col-meta">Update Metadata</button>
            </div>

            ${quantStatsHtml}

            <div class="canvas-frame" style="margin-top:10px;">
              <div style="font-size:11px; font-weight:600; color:var(--color-text-muted); margin-bottom:4px;">
                Distribution &amp; Frequency Plot (Zero Baseline / Tukey Boxplot Crossbar)
              </div>
              <canvas id="canvas-col-dist" class="plot-canvas" aria-label="Variable distribution plot"></canvas>
            </div>
          </div>
        </div>

        <div class="module-card">
          <div class="module-header"><div class="module-title">Dataset Observations</div></div>
          <div class="module-body compact">
            ${renderDatasetTableHtml(ds, 20)}
          </div>
        </div>
      </div>

      <div class="col-span-5">
        <div class="module-card">
          <div class="module-header"><div class="module-title">Missingness &amp; Cell State Matrix</div></div>
          <div class="module-body compact">
            <div class="canvas-frame">
              <canvas id="canvas-missing-matrix" class="plot-canvas" aria-label="Dataset missingness matrix"></canvas>
            </div>
            <details class="disclosure" style="margin-top:8px;">
              <summary>Missingness Co-Occurrence Patterns (${profile.missingnessPatterns.length})</summary>
              <div class="disclosure-body">
                <ul style="margin-left:16px; font-size:12px;">
                  ${profile.missingnessPatterns.slice(0, 6).map(p => `<li><code>${escapeHtml(p.pattern)}</code>: ${p.count} rows (${p.percentage.toFixed(1)}%)</li>`).join('')}
                </ul>
              </div>
            </details>
          </div>
        </div>

        <div class="module-card">
          <div class="module-header"><div class="module-title">Relational &amp; Key Hypotheses</div></div>
          <div class="module-body compact" style="font-size:12px;">
            <div style="margin-bottom:6px;">
              <strong>Candidate Primary Keys:</strong>
              ${profile.relationships.candidatePrimaryKeys.length > 0
                ? profile.relationships.candidatePrimaryKeys.map(k => `<span class="badge badge-primary">${escapeHtml(k)}</span>`).join(' ')
                : '<span class="badge badge-warning">None (Duplicates or nulls present)</span>'}
            </div>
            <div style="margin-bottom:6px;">
              <strong>Repeated Entity Keys:</strong>
              ${profile.relationships.repeatedIdentifierFindings.length > 0
                ? profile.relationships.repeatedIdentifierFindings.map(f => `<div style="margin-top:2px;">• <code>${escapeHtml(f.columnName)}</code>: ${f.repeatedKeyCount} repeated key(s) (${f.hasConflictingAttributes ? 'differs in attributes' : 'exact duplicate rows'}).</div>`).join('')
                : 'None.'}
            </div>
            <details class="disclosure" style="margin-top:6px;">
              <summary>Functional Dependency Hypotheses (${profile.relationships.functionalDependencies.length})</summary>
              <div class="disclosure-body">
                ${profile.relationships.functionalDependencies.length > 0
                  ? profile.relationships.functionalDependencies.slice(0, 6).map(fd => `<div>• <code>${escapeHtml(fd.determinant)} → ${escapeHtml(fd.dependent)}</code> (${fd.distinctDeterminants} levels)</div>`).join('')
                  : 'No strict nontrivial dependencies detected.'}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 3: QUALITY AUDIT & SCORECARD (Parts 5.3, 9, 22)
// ============================================================================
function renderAuditWorkspace(ds, profile, issues) {
  const scorecard = computeQualityScorecard(ds, profile);
  const expMode = APP_STATE.explanationMode;

  return `
    ${renderWorkflowStepper()}
    <div class="bento-grid-12">
      <div class="col-span-12">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">6-Dimension Data-Quality Scorecard</div>
            <span class="badge badge-neutral">Explanation Mode: ${escapeHtml(expMode.toUpperCase())}</span>
          </div>
          <div class="module-body compact">
            <div class="metric-strip" style="margin-bottom:6px;">
              ${scorecard.dimensions.map(dim => `
                <div class="metric-card" title="${escapeHtml(dim.formula)}">
                  <div class="metric-label">${escapeHtml(dim.name)}</div>
                  <div class="metric-value">${dim.percentage.toFixed(1)}%</div>
                  <div class="metric-sub">${dim.numerator}/${dim.denominator} ${escapeHtml(dim.unit)}</div>
                </div>
              `).join('')}
            </div>
            <details class="disclosure">
              <summary>View Exact Scorecard Mathematical Formulas</summary>
              <div class="disclosure-body">
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:6px; font-size:12px;">
                  ${scorecard.dimensions.map(dim => `<div><strong>${escapeHtml(dim.name)}:</strong> <code>${escapeHtml(dim.formula)}</code></div>`).join('')}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div class="col-span-12">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Diagnostic Findings (${issues.length})</div>
            <button type="button" class="btn btn-sm btn-primary" id="btn-run-safe-batch">Run Safe Low-Risk Batch</button>
          </div>
          <div class="module-body compact">
            ${issues.length === 0 ? `<p>Zero diagnostic issues detected on the current dataset.</p>` : issues.map((iss, idx) => {
              const riskCls = iss.riskClassification === RISK_LEVELS.HIGH ? 'badge-high'
                : iss.riskClassification === RISK_LEVELS.MEDIUM ? 'badge-medium'
                : iss.riskClassification === RISK_LEVELS.LOW ? 'badge-low' : 'badge-readonly';
              const explanationText = iss.explanation?.[expMode] || iss.explanation?.standard || '';
              return `
                <details class="disclosure" ${idx < 3 ? 'open' : ''}>
                  <summary>
                    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px;">
                      <span class="badge badge-accent">${escapeHtml(iss.category)}</span>
                      <span class="badge ${riskCls}">${escapeHtml(iss.riskClassification)}</span>
                      <strong>${escapeHtml(iss.finding)}</strong>
                    </div>
                    <span class="mono" style="font-size:11px;">${iss.affectedCount} obs</span>
                  </summary>
                  <div class="disclosure-body">
                    <div style="margin-bottom:4px;"><strong>Evidence:</strong> ${escapeHtml(iss.evidence)}</div>
                    <div style="color:var(--color-text-muted); margin-bottom:6px;">
                      <strong>Explanation (${escapeHtml(expMode)}):</strong> ${formatMathHtml(explanationText)}
                    </div>
                    <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; font-size:12px;">
                      <span><strong>Impact:</strong> ${escapeHtml(iss.consequences)}</span>
                      ${iss.suggestedRemedy ? `
                        <button type="button" class="btn btn-sm btn-primary" data-preview-issue="${iss.id}">
                          Preview Fix: ${escapeHtml(iss.suggestedRemedy.label)}
                        </button>
                      ` : `<span class="badge badge-neutral">Read-Only Notice</span>`}
                    </div>
                  </div>
                </details>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 4: CLEANING STUDIO (3-Panel Desktop Layout per Part 33.2)
// ============================================================================
function renderCleaningStudioWorkspace(ds, profile, issues) {
  const selectedCol = ds.columns.find(c => c.id === APP_STATE.selectedColId) || ds.columns[0];
  const opType = APP_STATE.selectedOperationType;
  const opDef = OPERATION_REGISTRY[opType] || OPERATION_REGISTRY.TRIM_WHITESPACE;
  const fuzzyCandidates = selectedCol ? detectFuzzyDuplicateCandidates(ds, selectedCol.id) : [];

  return `
    ${renderWorkflowStepper()}

    <div class="module-card">
      <div class="module-body compact" style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <strong style="font-size:12px;">Command Assistant:</strong>
        <input type="text" id="nl-command-input" class="input input-sm" style="flex:1; min-width:220px;" placeholder="e.g. &quot;Trim spaces from state&quot;, &quot;Remove exact duplicate records&quot;" value="${escapeHtml(APP_STATE.nlCommandInput)}">
        <button type="button" class="btn btn-sm btn-primary" id="btn-parse-nl">Propose Operation</button>
        <div class="segmented-control" role="group" aria-label="Automation policy mode">
          <button type="button" class="seg-btn ${APP_STATE.cleaningMode === 'inspect' ? 'active' : ''}" data-clean-mode="inspect">Inspect Only</button>
          <button type="button" class="seg-btn ${APP_STATE.cleaningMode === 'assisted' ? 'active' : ''}" data-clean-mode="assisted">Assisted Cleaning</button>
        </div>
      </div>
      ${APP_STATE.nlProposal ? `
        <div style="padding:6px 12px; border-top:1px solid var(--color-border); background:var(--color-primary-soft); font-size:12px; display:flex; justify-content:space-between; align-items:center;">
          <span><strong>Proposal:</strong> ${escapeHtml(APP_STATE.nlProposal.rationale)}</span>
          ${!APP_STATE.nlProposal.unsupported ? `<button type="button" class="btn btn-sm btn-primary" id="btn-preview-nl-proposal">Preview Proposal</button>` : ''}
        </div>
      ` : ''}
    </div>

    <div class="bento-grid-3">
      <div>
        <div class="module-card">
          <div class="module-header"><div class="module-title">1. Target Variable</div></div>
          <div class="module-body compact">
            <select id="clean-col-select" class="select" aria-label="Target variable for cleaning">
              ${ds.columns.map(c => `<option value="${c.id}" ${c.id === selectedCol?.id ? 'selected' : ''}>${escapeHtml(c.displayName)} [${c.confirmedType || c.semanticType}]</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="module-card">
          <div class="module-header"><div class="module-title">2. Operation Catalog</div></div>
          <div class="module-body compact" style="max-height:390px; overflow-y:auto;">
            ${Object.values(OPERATION_REGISTRY).map(op => `
              <div class="issue-item ${op.id === opType ? 'selected' : ''}" data-select-op="${op.id}" style="padding:6px 10px; margin-bottom:5px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <strong style="font-size:12px;">${escapeHtml(op.label)}</strong>
                  <span class="badge ${op.riskLevel === RISK_LEVELS.HIGH ? 'badge-high' : op.riskLevel === RISK_LEVELS.MEDIUM ? 'badge-medium' : 'badge-low'}" style="font-size:10px;">${escapeHtml(op.riskLevel)}</span>
                </div>
                <div style="font-size:11px; color:var(--color-text-muted);">${escapeHtml(op.category)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div>
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Working Dataset — ${escapeHtml(ds.title)}</div>
            <span class="badge badge-neutral">Rev ${ds.revision} (${ds.history.length} steps)</span>
          </div>
          <div class="module-body compact">
            ${renderDatasetTableHtml(ds, 25)}
          </div>
        </div>
      </div>

      <div class="right-inspector">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">3. Configure &amp; Preview</div>
            <span class="badge badge-primary">${escapeHtml(opDef.id)}</span>
          </div>
          <div class="module-body compact">
            <p style="font-size:12px; color:var(--color-text-muted); margin-bottom:8px;">
              ${escapeHtml(opDef.description)}
            </p>
            ${renderOperationParameterForm(ds, selectedCol, opDef)}
            <button type="button" class="btn btn-primary" style="width:100%; margin-top:10px;" id="btn-studio-preview-op">
              Preview Impact &amp; Approve
            </button>
          </div>
        </div>

        <details class="disclosure" open>
          <summary>Contextual Recommendations (${issues.filter(i => i.suggestedRemedy).length})</summary>
          <div class="disclosure-body" style="max-height:210px; overflow-y:auto;">
            ${issues.filter(i => i.suggestedRemedy).length === 0
              ? `<p style="font-size:12px; color:var(--color-text-muted);">No open automated recommendations.</p>`
              : issues.filter(i => i.suggestedRemedy).map(iss => `
                <div style="padding:6px 8px; border:1px solid var(--color-border); border-radius:4px; margin-bottom:6px; font-size:12px;">
                  <div><strong>${escapeHtml(iss.category)}:</strong> ${escapeHtml(iss.finding)}</div>
                  <button type="button" class="btn btn-sm btn-primary" style="margin-top:4px;" data-preview-issue="${iss.id}">
                    Preview: ${escapeHtml(iss.suggestedRemedy.label)}
                  </button>
                </div>
              `).join('')}
          </div>
        </details>

        ${fuzzyCandidates.length > 0 ? `
          <details class="disclosure">
            <summary>Fuzzy Near-Duplicates (${fuzzyCandidates.length})</summary>
            <div class="disclosure-body" style="font-size:12px;">
              ${fuzzyCandidates.slice(0, 5).map(fc => `
                <div style="margin-bottom:4px;">• <code>${escapeHtml(fc.valueA)}</code> (${fc.rowIdA}) ↔ <code>${escapeHtml(fc.valueB)}</code> (${fc.rowIdB}) [dist=${fc.editDistance}]</div>
              `).join('')}
            </div>
          </details>
        ` : ''}
      </div>
    </div>
  `;
}

function renderOperationParameterForm(ds, selectedCol, opDef) {
  const colName = selectedCol?.displayName || '';
  switch (opDef.id) {
    case 'TRIM_WHITESPACE':
      return `
        <div class="form-group">
          <label class="form-label" for="op-trim-mode">Trim Scope</label>
          <select id="op-trim-mode" class="select">
            <option value="both">Both leading and trailing spaces</option>
            <option value="leading">Leading spaces only</option>
            <option value="trailing">Trailing spaces only</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label"><input type="checkbox" id="op-trim-internal" checked> Collapse repeated internal spaces</label>
        </div>
      `;
    case 'STANDARDIZE_CASE':
      return `
        <div class="form-group">
          <label class="form-label" for="op-case-mode">Target Case Normalization</label>
          <select id="op-case-mode" class="select">
            <option value="canonical_most_frequent">Most Frequent Canonical Spelling</option>
            <option value="title">Title Case</option>
            <option value="lower">lowercase</option>
            <option value="upper">UPPERCASE</option>
          </select>
        </div>
      `;
    case 'FIND_REPLACE_TEXT':
      return `
        <div class="form-group">
          <label class="form-label" for="op-find-str">Find Text or Safe Pattern</label>
          <input type="text" id="op-find-str" class="input" placeholder="e.g. N.Y.">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-replace-str">Replacement Text</label>
          <input type="text" id="op-replace-str" class="input" placeholder="e.g. New York">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-match-mode">Match Mode</label>
          <select id="op-match-mode" class="select">
            <option value="exact">Exact Cell Match</option>
            <option value="substring">Substring Match</option>
            <option value="regex">Validated Safe Regular Expression</option>
          </select>
        </div>
      `;
    case 'PAD_OR_AFFIX_TEXT':
      return `
        <div class="form-group">
          <label class="form-label" for="op-pad-len">Pad Total Length (e.g. 5 for ZIP codes)</label>
          <input type="number" id="op-pad-len" class="input" value="5" min="0" max="64">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-pad-char">Pad Character</label>
          <input type="text" id="op-pad-char" class="input" value="0" maxlength="1">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-prefix">Optional Prefix</label>
          <input type="text" id="op-prefix" class="input" placeholder="e.g. ID-">
        </div>
      `;
    case 'CHANGE_COLUMN_TYPE':
      return `
        <div class="form-group">
          <label class="form-label" for="op-target-type">Target Semantic Type</label>
          <select id="op-target-type" class="select">
            ${Object.values(SEMANTIC_TYPES).map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
      `;
    case 'PARSE_DATES':
      return `
        <div class="form-group">
          <label class="form-label" for="op-date-fmt">Slash/Dash Date Convention</label>
          <select id="op-date-fmt" class="select">
            <option value="MDY">US Format (MM/DD/YYYY → YYYY-MM-DD)</option>
            <option value="DMY">International Format (DD/MM/YYYY → YYYY-MM-DD)</option>
          </select>
        </div>
      `;
    case 'CONVERT_UNITS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-target-unit">Target Standardized Physical Unit</label>
          <select id="op-target-unit" class="select">
            <option value="kg">Kilograms (kg) — from kg, g, lb, lbs</option>
            <option value="cm">Centimeters (cm) — from cm, mm, m, in, ft</option>
            <option value="m">Meters (m) — from cm, m, in</option>
            <option value="c">Celsius (°C) — from C, F</option>
          </select>
        </div>
      `;
    case 'IMPUTE_MISSING':
      return `
        <div class="form-group">
          <label class="form-label" for="op-impute-method">Imputation Method</label>
          <select id="op-impute-method" class="select">
            <option value="median">Sample Median (Robust)</option>
            <option value="mean">Arithmetic Mean (Attenuates variance)</option>
            <option value="mode">Most Frequent Mode</option>
            <option value="constant">Fixed Constant Value</option>
            <option value="group_median">Groupwise Median</option>
            <option value="group_mean">Groupwise Mean</option>
            <option value="ffill">Forward Fill (Ordered Series)</option>
            <option value="bfill">Backward Fill (Ordered Series)</option>
            <option value="linear_interp">Linear Interpolation (Ordered Series)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-impute-const">Constant Value / Group or Split Column</label>
          <input type="text" id="op-impute-const" class="input" placeholder="Constant (0) or Split Col (split)">
        </div>
        <div class="form-group">
          <label class="form-label"><input type="checkbox" id="op-impute-train-only"> Leakage Guard: Fit only where split == "train"</label>
        </div>
      `;
    case 'DEDUPLICATE_EXACT':
      return `
        <div class="form-group">
          <label class="form-label" for="op-dedup-strategy">Survivor Resolution Policy</label>
          <select id="op-dedup-strategy" class="select">
            <option value="keep_first">Keep First Occurrence</option>
            <option value="keep_last">Keep Last Occurrence</option>
            <option value="keep_most_complete">Keep Most Complete Record</option>
          </select>
        </div>
      `;
    case 'MAP_CATEGORIES':
      return `
        <div class="form-group">
          <label class="form-label" for="op-cat-map-json">Category Alias Mapping (JSON)</label>
          <textarea id="op-cat-map-json" class="input mono" rows="3">{"NY": "New York", "N.Y.": "New York", "new york": "New York", "CA": "California", "TX": "Texas", "HR": "Human Resources"}</textarea>
        </div>
      `;
    case 'FLAG_OUTLIERS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-outlier-method">Diagnostic Screening Method</label>
          <select id="op-outlier-method" class="select">
            <option value="tukey_iqr">Tukey 1.5 × IQR Fences</option>
            <option value="mad_z">Robust Median / MAD_σ (|z_MAD| &gt; 3.5)</option>
            <option value="z_score">Parametric Z-Score (|z| &gt; 3.0)</option>
          </select>
        </div>
      `;
    case 'WINSORIZE_OUTLIERS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-win-min">Lower Cap (Blank = Q1 − 1.5×IQR)</label>
          <input type="number" id="op-win-min" class="input" step="any">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-win-max">Upper Cap (Blank = Q3 + 1.5×IQR)</label>
          <input type="number" id="op-win-max" class="input" step="any">
        </div>
      `;
    case 'FILTER_ROWS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-filter-expr">Safe Filter Expression</label>
          <input type="text" id="op-filter-expr" class="input mono" value="[${escapeHtml(colName)}] != null">
        </div>
      `;
    case 'SORT_ROWS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-sort-dir">Sort Direction</label>
          <select id="op-sort-dir" class="select">
            <option value="asc">Ascending (A→Z, Low→High, Ordinal Order)</option>
            <option value="desc">Descending (Z→A, High→Low)</option>
          </select>
        </div>
      `;
    case 'RENAME_COLUMN':
      return `
        <div class="form-group">
          <label class="form-label" for="op-rename-val">New Column Name</label>
          <input type="text" id="op-rename-val" class="input" value="${escapeHtml(colName)}_clean">
        </div>
      `;
    case 'ADD_CALCULATED_COLUMN':
      return `
        <div class="form-group">
          <label class="form-label" for="op-calc-name">New Derived Column Name</label>
          <input type="text" id="op-calc-name" class="input" value="${escapeHtml(colName)}_derived">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-calc-type">Calculation / Window Type</label>
          <select id="op-calc-type" class="select">
            <option value="expression">Safe Typed Expression</option>
            <option value="zscore">Standardized Z-Score ((x − x̄)/s)</option>
            <option value="rank">Ascending Rank</option>
            <option value="cumsum">Cumulative Running Sum</option>
            <option value="lag">Lag (Previous Row t − 1)</option>
            <option value="lead">Lead (Next Row t + 1)</option>
            <option value="bin">Quartile Bins (Q1..Q4)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-calc-expr">Expression</label>
          <input type="text" id="op-calc-expr" class="input mono" value="ROUND([${escapeHtml(colName)}] * 1.0, 2)">
        </div>
      `;
    case 'NORMALIZE_UNICODE_CONTROL':
      return `
        <div class="form-group">
          <label class="form-label"><input type="checkbox" id="op-unicode-nfc" checked> Normalize Unicode to Canonical NFC &amp; strip zero-width/control chars</label>
        </div>
      `;
    case 'CLEAN_NUMERIC_TEXT':
      return `
        <div class="form-group">
          <label class="form-label" for="op-num-dec">Decimal Separator Convention</label>
          <select id="op-num-dec" class="select">
            <option value=".">Period (1,234.56 → 1234.56)</option>
            <option value=",">Comma (1.234,56 → 1234.56)</option>
          </select>
        </div>
      `;
    case 'ADD_MISSINGNESS_INDICATOR':
      return `
        <div class="form-group">
          <label class="form-label" for="op-miss-ind-name">Binary Indicator Column Name (0 / 1)</label>
          <input type="text" id="op-miss-ind-name" class="input mono" value="${escapeHtml(colName)}_is_missing">
        </div>
      `;
    case 'DROP_MISSING_ROWS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-drop-na-scope">Listwise Deletion Scope</label>
          <select id="op-drop-na-scope" class="select">
            <option value="selected">Drop rows missing in selected column (${escapeHtml(colName)})</option>
            <option value="any">Drop rows missing in ANY column</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label"><input type="checkbox" id="op-drop-na-confirm" checked> Acknowledge sample size reduction &amp; MNAR selection bias risk</label>
        </div>
      `;
    case 'MARK_DUPLICATE_KEYS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-dup-keys">Candidate Key Column(s) (comma-separated)</label>
          <input type="text" id="op-dup-keys" class="input mono" value="${escapeHtml(colName)}">
        </div>
      `;
    case 'DROP_COLUMN':
      return `
        <div class="form-group">
          <div style="font-size:12px; color:var(--color-text-muted);">Removes column <code>${escapeHtml(colName)}</code> from working dataset (reversible via Undo).</div>
        </div>
      `;
    case 'SPLIT_COLUMN':
      return `
        <div class="form-group">
          <label class="form-label" for="op-split-delim">Delimiter</label>
          <input type="text" id="op-split-delim" class="input mono" value=",">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-split-names">Output Column Names (comma-separated)</label>
          <input type="text" id="op-split-names" class="input mono" value="${escapeHtml(colName)}_part1, ${escapeHtml(colName)}_part2">
        </div>
      `;
    case 'COMBINE_COLUMNS':
      return `
        <div class="form-group">
          <label class="form-label" for="op-comb-cols">Columns to Combine (comma-separated)</label>
          <input type="text" id="op-comb-cols" class="input mono" value="${escapeHtml(ds.columns.slice(0, 2).map(c => c.displayName).join(', '))}">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-comb-delim">Join Delimiter</label>
          <input type="text" id="op-comb-delim" class="input mono" value=" - ">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-comb-name">New Combined Column Name</label>
          <input type="text" id="op-comb-name" class="input mono" value="${escapeHtml(colName)}_combined">
        </div>
      `;
    case 'UNPIVOT_WIDE_TO_LONG':
      return `
        <div class="form-group">
          <label class="form-label" for="op-unpiv-ids">Identifier Column(s) (comma-separated)</label>
          <input type="text" id="op-unpiv-ids" class="input mono" value="${escapeHtml(ds.columns.slice(0, 2).map(c => c.displayName).join(', '))}">
        </div>
        <div class="form-group">
          <label class="form-label" for="op-unpiv-vals">Measurement Columns to Unpivot (comma-separated)</label>
          <input type="text" id="op-unpiv-vals" class="input mono" value="${escapeHtml(ds.columns.slice(2).map(c => c.displayName).join(', '))}">
        </div>
      `;
    case 'PIVOT_LONG_TO_WIDE':
      return `
        <div class="form-group">
          <label class="form-label" for="op-piv-id">Row Identifier Column</label>
          <select id="op-piv-id" class="select">${ds.columns.map(c => `<option value="${escapeHtml(c.displayName)}">${escapeHtml(c.displayName)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-piv-names">Names From Column</label>
          <select id="op-piv-names" class="select">${ds.columns.map((c, i) => `<option value="${escapeHtml(c.displayName)}" ${i === 1 ? 'selected' : ''}>${escapeHtml(c.displayName)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-piv-vals">Values From Column</label>
          <select id="op-piv-vals" class="select">${ds.columns.map((c, i) => `<option value="${escapeHtml(c.displayName)}" ${i === 2 ? 'selected' : ''}>${escapeHtml(c.displayName)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-piv-conflict">Duplicate Collision Rule</label>
          <select id="op-piv-conflict" class="select">
            <option value="mean">Aggregate by Mean</option>
            <option value="sum">Aggregate by Sum</option>
            <option value="first">Keep First Value</option>
            <option value="error">Block on Collisions</option>
          </select>
        </div>
      `;
    case 'FILL_DOWN_HIERARCHICAL':
      return `
        <div class="form-group">
          <div style="font-size:12px; color:var(--color-text-muted);">Propagates non-empty top cell labels downward into blank merged cells in <code>${escapeHtml(colName)}</code>.</div>
        </div>
      `;
    case 'PROMOTE_ROW_TO_HEADER':
      return `
        <div class="form-group">
          <label class="form-label" for="op-prom-idx">Zero-Based Row Index to Promote to Header</label>
          <input type="number" id="op-prom-idx" class="input" value="0" min="0" max="${Math.max(0, ds.rows.length - 1)}">
        </div>
      `;
    case 'GROUP_AND_AGGREGATE':
      return `
        <div class="form-group">
          <label class="form-label" for="op-grp-by">Group By Column</label>
          <select id="op-grp-by" class="select">${ds.columns.map(c => `<option value="${escapeHtml(c.displayName)}" ${c.id === selectedCol?.id ? 'selected' : ''}>${escapeHtml(c.displayName)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-grp-measure">Target Measure Column</label>
          <select id="op-grp-measure" class="select">${ds.columns.map((c, i) => `<option value="${escapeHtml(c.displayName)}" ${i === ds.columns.length - 1 ? 'selected' : ''}>${escapeHtml(c.displayName)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-grp-fn">Summary Statistic</label>
          <select id="op-grp-fn" class="select">
            <option value="mean">Mean + Count</option>
            <option value="median">Median + IQR</option>
            <option value="sum">Sum + Count</option>
            <option value="sd">Standard Deviation</option>
          </select>
        </div>
      `;
    case 'TRANSPOSE_TABLE':
      return `
        <div class="form-group">
          <label class="form-label" for="op-tr-hdr">Row Label Column (becomes new column headers)</label>
          <select id="op-tr-hdr" class="select">${ds.columns.map(c => `<option value="${escapeHtml(c.displayName)}" ${c.id === selectedCol?.id ? 'selected' : ''}>${escapeHtml(c.displayName)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="op-tr-varname">Name for Transposed Variable Column</label>
          <input type="text" id="op-tr-varname" class="input mono" value="original_column">
        </div>
      `;
    default:
      return `<p style="font-size:12px;">Applies to column <code>${escapeHtml(colName)}</code>.</p>`;
  }
}

// ============================================================================
// WORKSPACE 5: RESTRUCTURE & MULTI-TABLE JOIN STUDIO (Parts 5.5, 18, 19, 20)
// ============================================================================
function renderRestructureWorkspace(ds) {
  const colOptions = ds.columns.map(c => `<option value="${escapeHtml(c.displayName)}">${escapeHtml(c.displayName)}</option>`).join('');
  const otherDatasets = APP_STATE.datasets;

  return `
    ${renderWorkflowStepper()}
    <div class="bento-grid-12">
      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Wide ↔ Long Reshaping</div>
            <span class="badge badge-warning">Changes Observational Unit</span>
          </div>
          <div class="module-body compact">
            <details class="disclosure" open>
              <summary><strong>A. Unpivot Wide to Long (Melt)</strong></summary>
              <div class="disclosure-body">
                <div class="form-group">
                  <label class="form-label" for="unpivot-ids">Identifier Column(s) (comma-separated)</label>
                  <input type="text" id="unpivot-ids" class="input mono" value="${escapeHtml(ds.columns.slice(0, 2).map(c => c.displayName).join(', '))}">
                </div>
                <div class="form-group">
                  <label class="form-label" for="unpivot-vals">Measurement Columns to Unpivot (comma-separated)</label>
                  <input type="text" id="unpivot-vals" class="input mono" value="${escapeHtml(ds.columns.slice(2).map(c => c.displayName).join(', '))}">
                </div>
                <div style="display:flex; gap:8px;">
                  <input type="text" id="unpivot-var-name" class="input input-sm" value="variable" placeholder="Variable col">
                  <input type="text" id="unpivot-val-name" class="input input-sm" value="value" placeholder="Value col">
                  <button type="button" class="btn btn-sm btn-primary" id="btn-run-unpivot">Preview Unpivot → Long</button>
                </div>
              </div>
            </details>

            <details class="disclosure" open>
              <summary><strong>B. Pivot Long to Wide (With Collision Guard)</strong></summary>
              <div class="disclosure-body">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                  <div class="form-group">
                    <label class="form-label" for="pivot-id-col">Row Identifier Column</label>
                    <select id="pivot-id-col" class="select">${colOptions}</select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="pivot-names-col">Names From Column</label>
                    <select id="pivot-names-col" class="select">${colOptions}</select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="pivot-vals-col">Values From Column</label>
                    <select id="pivot-vals-col" class="select">${colOptions}</select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="pivot-conflict">Duplicate Key Collision Rule</label>
                    <select id="pivot-conflict" class="select">
                      <option value="error">Block &amp; Warn on Collisions (Default)</option>
                      <option value="mean">Aggregate by Mean</option>
                      <option value="sum">Aggregate by Sum</option>
                      <option value="first">Keep First Value</option>
                      <option value="last">Keep Last Value</option>
                      <option value="count">Count Occurrences</option>
                    </select>
                  </div>
                </div>
                <button type="button" class="btn btn-sm btn-primary" id="btn-run-pivot-wide">Preview Pivot → Wide</button>
              </div>
            </details>

            <details class="disclosure">
              <summary><strong>C. Group &amp; Aggregate / Messy Spreadsheet Repair</strong></summary>
              <div class="disclosure-body">
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:8px;">
                  <div>
                    <label class="form-label" for="grp-by-col">Group By</label>
                    <select id="grp-by-col" class="select">${colOptions}</select>
                  </div>
                  <div>
                    <label class="form-label" for="grp-target-col">Measure</label>
                    <select id="grp-target-col" class="select">${colOptions}</select>
                  </div>
                  <div>
                    <label class="form-label" for="grp-agg-fn">Function</label>
                    <select id="grp-agg-fn" class="select">
                      <option value="mean">Mean + Count</option>
                      <option value="median">Median + IQR</option>
                      <option value="sum">Sum + Count</option>
                      <option value="sd">Standard Deviation</option>
                    </select>
                  </div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                  <button type="button" class="btn btn-sm btn-primary" id="btn-run-group-agg">Preview Aggregation</button>
                  <button type="button" class="btn btn-sm" id="btn-promote-header">Promote Row 1 to Headers</button>
                  <button type="button" class="btn btn-sm" id="btn-fill-down-col">Fill Down Blanks (Col 1)</button>
                  <button type="button" class="btn btn-sm" id="btn-transpose-table">Transpose Table (Rows ↔ Cols)</button>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Relational Join &amp; Append Workbench</div>
            <button type="button" class="btn btn-sm" id="btn-load-join-pair">Load Join Demo Pair (5A + 5B)</button>
          </div>
          <div class="module-body compact">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div class="form-group">
                <label class="form-label">Left Dataset (Active)</label>
                <input type="text" class="input" value="${escapeHtml(ds.title)} (${ds.rows.length} rows)" disabled>
              </div>
              <div class="form-group">
                <label class="form-label" for="join-right-ds">Right Lookup Dataset</label>
                <select id="join-right-ds" class="select">
                  ${otherDatasets.map(d => `<option value="${d.id}">${escapeHtml(d.title)} (${d.rows.length} rows)</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="join-left-key">Left Key Column</label>
                <select id="join-left-key" class="select">${colOptions}</select>
              </div>
              <div class="form-group">
                <label class="form-label" for="join-right-key">Right Key Column</label>
                <input type="text" id="join-right-key" class="input mono" value="${escapeHtml(ds.columns[0]?.displayName || 'account_id')}">
              </div>
              <div class="form-group">
                <label class="form-label" for="join-type-select">Join Type</label>
                <select id="join-type-select" class="select">
                  <option value="left">Left Join (Keep all Left rows)</option>
                  <option value="inner">Inner Join (Matched keys only)</option>
                  <option value="right">Right Join (Keep all Right rows)</option>
                  <option value="full">Full Outer Join (Union of keys)</option>
                  <option value="semi">Semi Join (Filter Left by Right match)</option>
                  <option value="anti">Anti Join (Unmatched Left rows only)</option>
                </select>
              </div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              <button type="button" class="btn btn-sm" id="btn-inspect-join">1. Inspect Cardinality</button>
              <button type="button" class="btn btn-sm btn-primary" id="btn-execute-join">2. Execute Join</button>
              <button type="button" class="btn btn-sm" id="btn-execute-append">Stack / Append Dataset</button>
            </div>

            ${APP_STATE.joinPreviewResult ? `
              <div style="margin-top:8px; padding:8px; border:1px solid var(--color-border); border-radius:6px; background:var(--color-surface-alt); font-size:12px;">
                <div>
                  <strong>Cardinality:</strong>
                  <span class="badge ${APP_STATE.joinPreviewResult.isManyToMany ? 'badge-high' : 'badge-primary'}">${escapeHtml(APP_STATE.joinPreviewResult.cardinality)}</span>
                  ${APP_STATE.joinPreviewResult.isManyToMany ? `<span style="color:var(--color-error); font-weight:600;">Warning: M:N duplicate keys cause Cartesian row expansion.</span>` : ''}
                </div>
                <div style="margin-top:4px;">
                  Matched keys: <code>${APP_STATE.joinPreviewResult.matchedKeyCount}</code> |
                  Left-only: <code>${APP_STATE.joinPreviewResult.leftOnlyRows}</code> |
                  Right-only: <code>${APP_STATE.joinPreviewResult.rightOnlyRows}</code> |
                  Predicted Rows: Inner=${APP_STATE.joinPreviewResult.predictedCounts.inner}, Left=${APP_STATE.joinPreviewResult.predictedCounts.left}
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="module-card">
          <div class="module-header"><div class="module-title">Current Structure Preview</div></div>
          <div class="module-body compact">
            ${renderDatasetTableHtml(ds, 8)}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 6: RECIPE BUILDER & SCHEMA-DRIFT REPLAY (Parts 5.6, 23, 25)
// ============================================================================
function renderRecipeWorkspace(ds) {
  const currentRecipe = exportCleaningRecipe(ds);
  const savedRecipes = loadSavedRecipes();
  const activeRecipe = APP_STATE.uploadedRecipe || currentRecipe;
  const compat = validateRecipeCompatibility(activeRecipe, ds);

  return `
    ${renderWorkflowStepper()}
    <div class="bento-grid-12">
      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Transformation History (${ds.history.length} Step(s))</div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn btn-sm btn-primary" id="btn-save-recipe-local">Save Recipe</button>
              <button type="button" class="btn btn-sm" id="btn-download-recipe-json">Download JSON</button>
            </div>
          </div>
          <div class="module-body compact">
            ${ds.history.length === 0 ? `<p style="font-size:12px; color:var(--color-text-muted);">No operations applied yet.</p>` : ds.history.map((h, i) => `
              <div style="padding:6px 10px; border:1px solid var(--color-border); border-radius:4px; margin-bottom:6px; font-size:12px;">
                <div style="display:flex; justify-content:space-between;">
                  <strong>${i + 1}. ${escapeHtml(h.label)} (<code>${escapeHtml(h.operationType)}</code>)</strong>
                  <span class="badge badge-neutral">${h.rowsBefore} → ${h.rowsAfter} rows</span>
                </div>
                <div style="color:var(--color-text-muted); margin-top:2px;">${escapeHtml(h.summary)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="module-card">
          <div class="module-header"><div class="module-title">Saved Browser Recipes (${savedRecipes.length})</div></div>
          <div class="module-body compact">
            ${savedRecipes.length === 0 ? `<p style="font-size:12px; color:var(--color-text-muted);">No saved recipes in localStorage.</p>` : savedRecipes.map(r => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-bottom:1px solid var(--color-border); font-size:12px;">
                <span><strong>${escapeHtml(r.title)}</strong> (${r.steps?.length || 0} steps)</span>
                <button type="button" class="btn btn-sm" data-select-saved-recipe="${escapeHtml(r.recipeId)}">Load</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Recipe Replay &amp; Schema-Drift Validator</div>
            <span class="badge ${compat.hasSchemaDrift ? 'badge-warning' : 'badge-primary'}">${compat.hasSchemaDrift ? 'Schema Drift Detected' : 'Schema Compatible'}</span>
          </div>
          <div class="module-body compact">
            <textarea id="recipe-json-editor" class="input mono" rows="8" aria-label="Recipe JSON specification">${escapeHtml(JSON.stringify(activeRecipe, null, 2))}</textarea>

            ${compat.schemaDrift.length > 0 ? `
              <div style="margin-top:8px; padding:8px; background:var(--color-warning-soft); border:1px solid var(--color-warning); border-radius:6px; font-size:12px;">
                <strong>Schema Drift Detected:</strong>
                ${compat.schemaDrift.map(d => `<div>• [${escapeHtml(d.type)}] ${escapeHtml(d.message)}</div>`).join('')}
                <div style="margin-top:6px;">
                  <label class="form-label" for="drift-col-map">Column Remapping JSON</label>
                  <input type="text" id="drift-col-map" class="input input-sm mono" style="width:100%;" value='{"annual_salary_usd": "compensation_usd"}'>
                </div>
              </div>
            ` : ''}

            <div style="display:flex; gap:8px; margin-top:10px;">
              <button type="button" class="btn btn-sm" id="btn-validate-recipe-json">Validate Compatibility</button>
              <button type="button" class="btn btn-sm btn-primary" id="btn-replay-recipe">Execute Recipe Transactionally</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 7: VALIDATION STUDIO & QUALITY GATES (Part 21)
// ============================================================================
function renderValidationWorkspace(ds) {
  const suite = runValidationSuite(ds);
  const colOptions = ds.columns.map(c => `<option value="${escapeHtml(c.displayName)}">${escapeHtml(c.displayName)}</option>`).join('');

  return `
    ${renderWorkflowStepper()}
    <div class="bento-grid-12">
      <div class="col-span-5">
        <div class="module-card">
          <div class="module-header"><div class="module-title">Add Validation Rule / Quality Gate</div></div>
          <div class="module-body compact">
            <div class="form-group">
              <label class="form-label" for="val-rule-name">Rule Name</label>
              <input type="text" id="val-rule-name" class="input" placeholder="e.g. Unique Customer ID">
            </div>
            <div class="form-group">
              <label class="form-label" for="val-rule-type">Constraint Family (16 Supported)</label>
              <select id="val-rule-type" class="select">
                <option value="nonmissing">Required / Non-Missing Field</option>
                <option value="uniqueness">Primary Key Uniqueness</option>
                <option value="data_type">Strict Type &amp; Parse Validity</option>
                <option value="inclusive_range">Numerical Inclusive Range [min, max]</option>
                <option value="min_value">Minimum Numerical Value</option>
                <option value="max_value">Maximum Numerical Value</option>
                <option value="allowed_categories">Allowed Category Set</option>
                <option value="pattern">Safe Regular Expression Pattern</option>
                <option value="string_length">String Length Bounds</option>
                <option value="Composite Uniqueness" disabled>── Multi-Column &amp; Relational ──</option>
                <option value="composite_uniqueness">Composite Key Uniqueness (comma-separated cols)</option>
                <option value="date_range">Date Range Bounds [YYYY-MM-DD, YYYY-MM-DD]</option>
                <option value="chronological_order">Monotonic Chronological Order</option>
                <option value="cross_field">Cross-Field Comparison Formula</option>
                <option value="conditional_requirement">Conditional Requirement (If Col == Val)</option>
                <option value="referential_integrity">Referential Integrity (Allowed Key Set)</option>
                <option value="custom_formula">Deterministic Custom Formula</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="val-rule-col">Target Column</label>
              <select id="val-rule-col" class="select">${colOptions}</select>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div class="form-group">
                <label class="form-label" for="val-param-min">Min / Pattern / Formula</label>
                <input type="text" id="val-param-min" class="input mono" placeholder="e.g. 0 or ^CUST-">
              </div>
              <div class="form-group">
                <label class="form-label" for="val-param-max">Max / Allowed CSV</label>
                <input type="text" id="val-param-max" class="input mono" placeholder="e.g. 1000000">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">
                <input type="checkbox" id="val-is-gate" checked> Enforce as Export Quality Gate
              </label>
            </div>
            <button type="button" class="btn btn-primary" style="width:100%;" id="btn-add-val-rule">+ Add &amp; Evaluate Rule</button>
          </div>
        </div>
      </div>

      <div class="col-span-7">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Validation Results (${suite.passingRules}/${suite.totalRules} Passing)</div>
            <span class="badge ${suite.exportBlockedByGate ? 'badge-high' : 'badge-low'}">
              ${suite.exportBlockedByGate ? `Gate Blocked (${suite.failedGates.length} Failing)` : 'Gates Passing'}
            </span>
          </div>
          <div class="module-body compact">
            <p style="font-size:11px; color:var(--color-text-muted); margin-bottom:8px;">${escapeHtml(suite.disclaimer)}</p>
            ${suite.results.length === 0 ? `<p style="font-size:12px;">No custom validation constraints added yet.</p>` : suite.results.map(r => `
              <div class="issue-item" style="cursor:default;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <span class="badge ${r.status === 'PASS' ? 'badge-low' : 'badge-high'}">${r.status}</span>
                    <strong style="margin-left:6px;">${escapeHtml(r.name)}</strong>
                    ${r.isQualityGate ? `<span class="badge badge-warning">Gate</span>` : ''}
                  </div>
                  <button type="button" class="btn btn-sm btn-danger" data-remove-rule="${escapeHtml(r.ruleId)}">Remove</button>
                </div>
                <div style="font-size:12px; margin-top:4px;">
                  Tested: <code>${r.tested}</code> | Passing: <code>${r.passing}</code> | Failing: <code>${r.failing}</code> | Inapplicable: <code>${r.inapplicable}</code>
                </div>
                ${r.failureExamples.length > 0 ? `<div style="font-size:11px; color:var(--color-error); margin-top:2px;">Violations: ${escapeHtml(r.failureExamples.join('; '))}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 8: BEFORE & AFTER COMPARISON (Part 24)
// ============================================================================
function renderComparisonWorkspace(ds) {
  const comp = computeBeforeAfterComparison(ds);

  return `
    ${renderWorkflowStepper()}
    <div class="metric-strip">
      <div class="metric-card"><div class="metric-label">Rows (Before → After)</div><div class="metric-value">${comp.rowsBefore} → ${comp.rowsAfter}</div><div class="metric-sub">−${comp.removedRowCount} / +${comp.addedRowCount}</div></div>
      <div class="metric-card"><div class="metric-label">Cols (Before → After)</div><div class="metric-value">${comp.colsBefore} → ${comp.colsAfter}</div><div class="metric-sub">+${comp.addedColumns.length} / −${comp.removedColumns.length}</div></div>
      <div class="metric-card"><div class="metric-label">Modified Cells</div><div class="metric-value">${comp.totalChangedCells}</div><div class="metric-sub">${comp.observationalUnitChanged ? 'Reshaped unit' : '1:1 lineage'}</div></div>
      <div class="metric-card"><div class="metric-label">Missing Cells</div><div class="metric-value">${comp.beforeScorecard.missingCells} → ${comp.afterScorecard.missingCells}</div></div>
      <div class="metric-card"><div class="metric-label">Exact Duplicates</div><div class="metric-value">${comp.beforeScorecard.duplicateRows} → ${comp.afterScorecard.duplicateRows}</div></div>
    </div>

    <div class="bento-grid-12">
      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header"><div class="module-title">Before vs. After Scorecard Dimensions</div></div>
          <div class="module-body compact">
            <div class="canvas-frame">
              <canvas id="canvas-before-after" class="plot-canvas" aria-label="Before and after quality comparison chart"></canvas>
            </div>
          </div>
        </div>
      </div>

      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header"><div class="module-title">Cell-Level &amp; Structural Diff Log</div></div>
          <div class="module-body compact">
            ${comp.observationalUnitChanged ? `
              <div style="padding:10px; background:var(--color-warning-soft); border:1px solid var(--color-warning); border-radius:6px; font-size:12px;">
                <strong>Observational Unit Reshaped:</strong> Because a pivot, unpivot, join, or aggregation changed the observational unit (${comp.rowsBefore} → ${comp.rowsAfter} rows), cells represent composite/grouped tuples rather than 1-to-1 original cells.
              </div>
            ` : comp.cellDiffs.length === 0 ? `<p style="font-size:12px; color:var(--color-text-muted);">No cell-level modifications recorded yet.</p>` : `
              <div class="data-table-wrapper" style="max-height:240px;">
                <table class="data-table">
                  <thead><tr><th>Row ID</th><th>Column</th><th>Original Value</th><th>Cleaned Value</th></tr></thead>
                  <tbody>
                    ${comp.cellDiffs.slice(0, 40).map(d => `
                      <tr>
                        <td><code>${escapeHtml(d.rowId)}</code></td>
                        <td><code>${escapeHtml(d.columnName)}</code></td>
                        <td class="cell-missing">${escapeHtml(d.beforeFormatted)}</td>
                        <td class="${d.isImputed ? 'cell-imputed' : 'cell-changed'}">${escapeHtml(d.afterFormatted)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 9: EXPORT & REPRODUCE (Parts 26 & 27)
// ============================================================================
function renderExportWorkspace(ds, issues) {
  const valSuite = runValidationSuite(ds);
  const rCode = generateRScript(ds);
  const pyCode = generatePythonScript(ds);
  const reportMd = generateQualityAuditReport(ds, issues);

  return `
    ${renderWorkflowStepper()}
    ${valSuite.exportBlockedByGate ? `
      <div class="module-card" style="border:2px solid var(--color-error);">
        <div class="module-header"><div class="module-title" style="color:var(--color-error);">Quality Gate Alert — ${valSuite.failedGates.length} Constraint(s) Failing</div></div>
        <div class="module-body compact" style="font-size:12px;">
          Failing Quality Gates: <strong>${valSuite.failedGates.map(g => escapeHtml(g.name)).join(', ')}</strong>. Resolve in Cleaning Studio or adjust gates in Validation Studio before exporting.
        </div>
      </div>
    ` : ''}

    <div class="bento-grid-12">
      <div class="col-span-5">
        <div class="module-card">
          <div class="module-header"><div class="module-title">Export Cleaned Dataset &amp; Artifacts</div></div>
          <div class="module-body compact">
            <div class="form-group">
              <label class="form-label" for="exp-filename">Base Filename</label>
              <input type="text" id="exp-filename" class="input mono" value="cleaned_${escapeHtml(ds.id)}">
            </div>
            <div class="form-group">
              <label class="form-label" for="exp-missing-token">Missing-Value Token (CSV/TSV)</label>
              <select id="exp-missing-token" class="select">
                <option value="">Empty field (RFC 4180 default)</option>
                <option value="NA">NA (R convention)</option>
                <option value="NULL">NULL (SQL convention)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">
                <input type="checkbox" id="exp-csv-sanitize" checked> Escape Spreadsheet Formula Triggers (<code>= + - @</code>)
              </label>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:10px;">
              <button type="button" class="btn btn-sm btn-primary" id="btn-exp-csv">Export CSV</button>
              <button type="button" class="btn btn-sm" id="btn-exp-tsv">Export TSV</button>
              <button type="button" class="btn btn-sm btn-primary" id="btn-exp-xlsx">Export Excel (.xlsx)</button>
              <button type="button" class="btn btn-sm" id="btn-exp-datasense">DataSense JSON</button>
              <button type="button" class="btn btn-sm" id="btn-exp-json">JSON Records</button>
              <button type="button" class="btn btn-sm" id="btn-exp-ndjson">NDJSON Stream</button>
              <button type="button" class="btn btn-sm" id="btn-exp-recipe">Recipe JSON</button>
              <button type="button" class="btn btn-sm" id="btn-exp-report">Quality Report (.md)</button>
              <button type="button" class="btn btn-sm" style="grid-column: span 2;" id="btn-share-state-url">Copy Shareable Workspace State URL (#state=...)</button>
            </div>
          </div>
        </div>
      </div>

      <div class="col-span-7">
        <details class="disclosure" open>
          <summary>
            <span><strong>Reproducible R Script</strong> (<code>tidyverse / dplyr / tidyr</code>)</span>
            <button type="button" class="btn btn-sm" id="btn-exp-r">Download .R</button>
          </summary>
          <div class="disclosure-body">
            <textarea class="input mono" rows="7" readonly aria-label="Generated R script">${escapeHtml(rCode)}</textarea>
          </div>
        </details>

        <details class="disclosure" open>
          <summary>
            <span><strong>Reproducible Python Script</strong> (<code>pandas / numpy</code>)</span>
            <button type="button" class="btn btn-sm" id="btn-exp-py">Download .py</button>
          </summary>
          <div class="disclosure-body">
            <textarea class="input mono" rows="7" readonly aria-label="Generated Python script">${escapeHtml(pyCode)}</textarea>
          </div>
        </details>

        <details class="disclosure">
          <summary><span><strong>Data-Quality Audit Report Preview</strong> (Markdown)</span></summary>
          <div class="disclosure-body">
            <textarea class="input mono" rows="8" readonly aria-label="Quality Audit Report Markdown">${escapeHtml(reportMd)}</textarea>
          </div>
        </details>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 10: DATA PREPARATION KNOWLEDGE ATLAS & GUIDED LABS (Parts 30 & 31)
// ============================================================================
function renderAtlasWorkspace() {
  const q = APP_STATE.atlasSearchQuery.trim().toLowerCase();
  const dom = APP_STATE.atlasDomainFilter;

  const domains = ['ALL', ...new Set(KNOWLEDGE_ATLAS_ENTRIES.map(e => e.domain))];
  const filteredAtlas = KNOWLEDGE_ATLAS_ENTRIES.filter(e => {
    if (dom !== 'ALL' && e.domain !== dom) return false;
    if (!q) return true;
    return (
      e.title.toLowerCase().includes(q) ||
      e.definition.toLowerCase().includes(q) ||
      e.plainExplanation.toLowerCase().includes(q) ||
      e.technicalExplanation.toLowerCase().includes(q)
    );
  });

  return `
    <div class="bento-grid-12">
      <!-- 14 Interactive Guided Investigations (Collapsible Accordion Grid) -->
      <div class="col-span-12">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">14 Guided Data-Preparation Investigations</div>
            <span class="badge badge-primary">Click Any Lab to Expand or Launch</span>
          </div>
          <div class="module-body compact">
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:8px;">
              ${GUIDED_INVESTIGATIONS.map((inv, idx) => `
                <details class="disclosure" ${idx < 2 ? 'open' : ''} style="margin-bottom:0;">
                  <summary>
                    <span><strong>Lab #${inv.number}:</strong> ${escapeHtml(inv.title)}</span>
                  </summary>
                  <div class="disclosure-body" style="font-size:12px;">
                    <div style="margin-bottom:4px;"><span class="badge badge-neutral">${escapeHtml(inv.concept)}</span></div>
                    <p style="color:var(--color-text-muted); margin-bottom:6px;">${escapeHtml(inv.question)}</p>
                    <p style="margin-bottom:8px;"><strong>Finding:</strong> ${formatMathHtml(inv.explanation)}</p>
                    <button type="button" class="btn btn-sm btn-primary" data-launch-investigation="${inv.id}">
                      Load Dataset &amp; Open Lab #${inv.number}
                    </button>
                  </div>
                </details>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Searchable Knowledge Atlas with Collapsible Technical Details -->
      <div class="col-span-12">
        <div class="module-card">
          <div class="module-header">
            <div class="module-title">Data Preparation Knowledge Atlas (${filteredAtlas.length} Entries)</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="search" id="atlas-search-input" class="input input-sm" placeholder="Search concepts, formulas, risks…" value="${escapeHtml(APP_STATE.atlasSearchQuery)}" aria-label="Search Knowledge Atlas">
              <select id="atlas-domain-select" class="select select-sm" aria-label="Filter Atlas by domain">
                ${domains.map(d => `<option value="${escapeHtml(d)}" ${d === dom ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="module-body compact">
            ${filteredAtlas.map((entry, idx) => `
              <details class="disclosure" ${idx < 2 ? 'open' : ''}>
                <summary>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <strong>${escapeHtml(entry.title)}</strong>
                    <span class="badge badge-primary">${escapeHtml(entry.domain)}</span>
                  </div>
                  <span class="badge badge-low">${escapeHtml(entry.capabilityStatus)}</span>
                </summary>
                <div class="disclosure-body">
                  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:8px; font-size:12px;">
                    <div><strong>1. Definition:</strong> ${formatMathHtml(entry.definition)}</div>
                    <div><strong>2. Plain Explanation:</strong> ${formatMathHtml(entry.plainExplanation)}</div>
                    <div><strong>3. Why It Matters:</strong> ${formatMathHtml(entry.whyItMatters)}</div>
                    <div><strong>4. Appropriate Use:</strong> ${formatMathHtml(entry.appropriateUse)}</div>
                    <div><strong>5. Examples:</strong> ${formatMathHtml(entry.examples)}</div>
                    <div><strong>6. Risks:</strong> ${formatMathHtml(entry.risks)}</div>
                    <div><strong>7. Statistical Implications:</strong> ${formatMathHtml(entry.statisticalImplications)}</div>
                    <div><strong>8. Tool Connections:</strong> ${escapeHtml(entry.toolConnections)}</div>
                    <div><strong>9. Related Concepts:</strong> ${escapeHtml(entry.relatedConcepts.join(', '))}</div>
                    <div><strong>10. Technical Specification:</strong> ${formatMathHtml(entry.technicalExplanation)}</div>
                  </div>
                </div>
              </details>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// WORKSPACE 11: METHODS, PRIVACY & ABOUT (Part 5.11 & Part 34)
// ============================================================================
function renderMethodsWorkspace() {
  return `
    <div class="bento-grid-12">
      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header"><div class="module-title">Mathematical &amp; Statistical Specifications</div></div>
          <div class="module-body compact" style="font-size:13px;">
            <details class="disclosure" open>
              <summary><strong>1. Two-Pass Numerically Stable Sample Moments</strong></summary>
              <div class="disclosure-body">
                Sample variance <span class="math-expr">s<sup>2</sup> = [1 / (n &minus; 1)] &Sigma;(x<sub>i</sub> &minus; <span class="math-overline">x</span>)<sup>2</sup></span> uses Bessel's correction (<span class="math-expr">df = n &minus; 1</span>) and two-pass centering to prevent catastrophic floating-point cancellation.
              </div>
            </details>
            <details class="disclosure" open>
              <summary><strong>2. Hyndman-Fan Type 7 Quantiles &amp; Robust Dispersion</strong></summary>
              <div class="disclosure-body">
                Sample quartiles (<span class="math-expr">Q<sub>1</sub>, Q<sub>2</sub>, Q<sub>3</sub></span>) and <span class="math-expr">IQR = Q<sub>3</sub> &minus; Q<sub>1</sub></span> use linear interpolation at index <span class="math-expr">k = (n &minus; 1)q + 1</span>, matching R and Python NumPy/pandas defaults. Normal-consistent Median Absolute Deviation is <span class="math-expr">MAD<sub>&sigma;</sub> = 1.4826 &middot; median|x<sub>i</sub> &minus; x&#771;|</span>.
              </div>
            </details>
            <details class="disclosure" open>
              <summary><strong>3. Scale of Measurement &amp; Leakage Prevention</strong></summary>
              <div class="disclosure-body">
                Arithmetic means and standard deviations are blocked on nominal identifiers and postal codes. Imputation rules support fitting parameters exclusively on training partitions (<span class="math-expr">D<sub>train</sub></span>) and storing them in <code>learnedParameters</code> for out-of-sample evaluation on <span class="math-expr">D<sub>test</sub></span>.
              </div>
            </details>
          </div>
        </div>
      </div>

      <div class="col-span-6">
        <div class="module-card">
          <div class="module-header"><div class="module-title">Local-First Privacy, Security &amp; Storage Control</div></div>
          <div class="module-body compact" style="font-size:13px;">
            <ul style="margin-left:18px; display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
              <li><strong>100% In-Browser Execution:</strong> Uploaded datasets never leave your device. Zero backend servers, zero telemetry scripts, and zero external API calls.</li>
              <li><strong>No Arbitrary Code Execution:</strong> Excel VBA macros (<code>vbaProject.bin</code>) are ignored, calculated columns use a constrained AST parser (never <code>dynamic-eval</code>), and regex patterns are screened against catastrophic ReDoS backtracking.</li>
              <li><strong>Spreadsheet Formula Injection Protection:</strong> CSV/TSV exports sanitize leading <code>= + - @</code> formula triggers while preserving negative numeric measurements.</li>
            </ul>
            <button type="button" class="btn btn-sm btn-danger" id="btn-clear-storage">Clear Saved Recipes &amp; Reset Browser Storage</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// MAIN RENDER & EVENT DELEGATION COORDINATOR
// ============================================================================
export function renderApp() {
  const ds = getActiveDataset();
  if (!ds) return;

  const profile = profileDataset(ds);
  const issues = diagnoseDataset(ds, profile);

  const dsSelect = document.getElementById('active-dataset-select');
  if (dsSelect) {
    dsSelect.innerHTML = APP_STATE.datasets.map(d =>
      `<option value="${escapeHtml(d.id)}" ${d.id === ds.id ? 'selected' : ''}>Dataset: ${escapeHtml(d.title)} (${d.rows.length}×${d.columns.length})</option>`
    ).join('');
  }

  const presetSelect = document.getElementById('preset-loader-select');
  if (presetSelect) {
    presetSelect.innerHTML = `<option value="">+ Load Example Dataset…</option>` +
      SYNTHETIC_PRESETS.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)}</option>`).join('');
  }

  const badgeRowsCols = document.getElementById('badge-rows-cols');
  if (badgeRowsCols) badgeRowsCols.textContent = `${profile.rowCount}×${profile.colCount}`;

  const badgeIssues = document.getElementById('badge-issue-count');
  if (badgeIssues) badgeIssues.textContent = String(issues.length);

  const badgeSteps = document.getElementById('badge-step-count');
  if (badgeSteps) badgeSteps.textContent = String(ds.history.length);

  const badgeRules = document.getElementById('badge-rule-count');
  if (badgeRules) badgeRules.textContent = String((ds.validationRules || []).length);

  const btnUndo = document.getElementById('btn-undo');
  const undoCount = document.getElementById('undo-count');
  if (btnUndo) btnUndo.disabled = ds.history.length === 0;
  if (undoCount) undoCount.textContent = String(ds.history.length);

  const btnRedo = document.getElementById('btn-redo');
  if (btnRedo) btnRedo.disabled = (ds.redoStack || []).length === 0;

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-view') === APP_STATE.activeView);
  });

  document.querySelectorAll('[data-exp-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-exp-mode') === APP_STATE.explanationMode);
  });

  const main = document.getElementById('main-workspace');
  if (!main) return;

  switch (APP_STATE.activeView) {
    case 'home':
      main.innerHTML = renderHomeWorkspace(ds, profile, issues);
      break;
    case 'inspector':
      main.innerHTML = renderInspectorWorkspace(ds, profile);
      break;
    case 'audit':
      main.innerHTML = renderAuditWorkspace(ds, profile, issues);
      break;
    case 'cleaning':
      main.innerHTML = renderCleaningStudioWorkspace(ds, profile, issues);
      break;
    case 'restructure':
      main.innerHTML = renderRestructureWorkspace(ds);
      break;
    case 'recipes':
      main.innerHTML = renderRecipeWorkspace(ds);
      break;
    case 'validation':
      main.innerHTML = renderValidationWorkspace(ds);
      break;
    case 'comparison':
      main.innerHTML = renderComparisonWorkspace(ds);
      break;
    case 'export':
      main.innerHTML = renderExportWorkspace(ds, issues);
      break;
    case 'atlas':
      main.innerHTML = renderAtlasWorkspace();
      break;
    case 'methods':
      main.innerHTML = renderMethodsWorkspace();
      break;
    default:
      main.innerHTML = renderHomeWorkspace(ds, profile, issues);
  }

  requestAnimationFrame(() => {
    const colDistCanvas = document.getElementById('canvas-col-dist');
    if (colDistCanvas) {
      const selColId = APP_STATE.selectedColId || ds.columns[0]?.id;
      const cp = profile.columnProfiles.find(p => p.colId === selColId) || profile.columnProfiles[0];
      renderColumnDistribution(colDistCanvas, cp);
    }
    const missingCanvas = document.getElementById('canvas-missing-matrix');
    if (missingCanvas) {
      renderMissingnessMatrix(missingCanvas, ds);
    }
    const baCanvas = document.getElementById('canvas-before-after');
    if (baCanvas) {
      renderBeforeAfterScorecardChart(baCanvas, computeBeforeAfterComparison(ds));
    }
  });

  bindWorkspaceEvents(ds, profile, issues);
}

function bindWorkspaceEvents(ds, profile, issues) {
  document.querySelectorAll('[data-goto-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      APP_STATE.activeView = btn.getAttribute('data-goto-view');
      renderApp();
    });
  });

  const searchInput = document.getElementById('table-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      APP_STATE.tableSearchQuery = e.target.value;
      APP_STATE.tablePage = 0;
      renderApp();
    });
  }
  document.getElementById('btn-table-prev')?.addEventListener('click', () => {
    if (APP_STATE.tablePage > 0) { APP_STATE.tablePage--; renderApp(); }
  });
  document.getElementById('btn-table-next')?.addEventListener('click', () => {
    APP_STATE.tablePage++;
    renderApp();
  });

  document.querySelectorAll('[data-select-col]').forEach(th => {
    th.addEventListener('click', () => {
      APP_STATE.selectedColId = th.getAttribute('data-select-col');
      renderApp();
    });
  });

  document.querySelectorAll('[data-load-preset]').forEach(card => {
    card.addEventListener('click', () => {
      const pid = card.getAttribute('data-load-preset');
      loadPresetDataset(pid, 'inspector');
      showToast('Loaded synthetic dataset into Data Inspector.', 'info');
    });
  });

  const fileInput = document.getElementById('file-upload-input');
  const dropzone = document.getElementById('file-dropzone');
  document.getElementById('btn-trigger-file-input')?.addEventListener('click', e => {
    e.stopPropagation();
    fileInput?.click();
  });
  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) handleFilesSelected(e.dataTransfer.files);
  });
  fileInput?.addEventListener('change', e => {
    if (e.target.files?.length) handleFilesSelected(e.target.files);
  });

  document.getElementById('btn-paste-manual-data')?.addEventListener('click', e => {
    e.stopPropagation();
    const panel = document.getElementById('manual-entry-panel');
    if (panel) panel.hidden = !panel.hidden;
  });
  document.getElementById('btn-cancel-manual')?.addEventListener('click', () => {
    const panel = document.getElementById('manual-entry-panel');
    if (panel) panel.hidden = true;
  });
  document.getElementById('btn-parse-manual')?.addEventListener('click', () => {
    const text = document.getElementById('manual-csv-textarea')?.value || '';
    if (!text.trim()) { showToast('Enter CSV or JSON data first.', 'warning'); return; }
    try {
      if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
        const jRes = parseJsonContent(text);
        APP_STATE.pendingImportPreview = {
          filename: 'manual_entry.json',
          sizeBytes: text.length,
          format: jRes.detectedFormat,
          rawText: text,
          columnNames: jRes.columnNames,
          rawRows: jRes.rawRows,
          warnings: jRes.warnings,
          candidatePaths: jRes.candidatePaths,
          selectedPath: jRes.selectedPath
        };
      } else {
        const cRes = parseDelimitedText(text);
        APP_STATE.pendingImportPreview = {
          filename: 'manual_entry.csv',
          sizeBytes: text.length,
          format: 'CSV',
          rawText: text,
          delimiter: cRes.delimiter,
          hasHeader: true,
          columnNames: cRes.columnNames,
          rawRows: cRes.rawRows,
          warnings: cRes.warnings
        };
      }
      renderApp();
    } catch (err) {
      showToast(`Parse Error: ${err.message}`, 'error');
    }
  });

  document.getElementById('imp-delim')?.addEventListener('change', e => {
    const p = APP_STATE.pendingImportPreview;
    if (!p || !p.rawText) return;
    const cRes = parseDelimitedText(p.rawText, { delimiter: e.target.value, hasHeader: p.hasHeader });
    p.delimiter = e.target.value;
    p.columnNames = cRes.columnNames;
    p.rawRows = cRes.rawRows;
    p.warnings = cRes.warnings;
    renderApp();
  });
  document.getElementById('imp-header')?.addEventListener('change', e => {
    const p = APP_STATE.pendingImportPreview;
    if (!p) return;
    p.hasHeader = e.target.checked;
    if (p.rawText) {
      const cRes = parseDelimitedText(p.rawText, { delimiter: p.delimiter, hasHeader: p.hasHeader });
      p.columnNames = cRes.columnNames;
      p.rawRows = cRes.rawRows;
    }
    renderApp();
  });
  document.getElementById('imp-sheet')?.addEventListener('change', e => {
    const p = APP_STATE.pendingImportPreview;
    if (!p || !p.sheets) return;
    const idx = Number(e.target.value);
    p.selectedSheetIdx = idx;
    p.columnNames = p.sheets[idx].columnNames;
    p.rawRows = p.sheets[idx].rawRows;
    p.warnings = p.sheets[idx].warnings;
    renderApp();
  });
  document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
    APP_STATE.pendingImportPreview = null;
    renderApp();
  });
  document.getElementById('btn-commit-import')?.addEventListener('click', () => {
    const p = APP_STATE.pendingImportPreview;
    if (!p) return;
    const decSep = document.getElementById('imp-decimal')?.value || '.';
    const sheetName = p.sheets ? p.sheets[p.selectedSheetIdx || 0]?.name : null;
    const newDs = buildDatasetFromParsed({
      title: sheetName ? `${p.filename} [${sheetName}]` : p.filename,
      filename: p.filename,
      format: p.format,
      sheet: sheetName,
      columnNames: p.columnNames,
      rawRows: p.rawRows,
      importOptions: { decimalSeparator: decSep, delimiter: p.delimiter },
      columnOverrides: p.columnOverrides || {},
      warnings: p.warnings || []
    });
    APP_STATE.datasets.push(newDs);
    APP_STATE.activeDatasetId = newDs.id;
    APP_STATE.selectedColId = newDs.columns[0]?.id || null;
    APP_STATE.pendingImportPreview = null;
    APP_STATE.activeView = 'inspector';
    showToast(`Imported "${newDs.title}" (${newDs.rows.length} rows)`, 'info');
    renderApp();
  });

  document.getElementById('inspector-col-select')?.addEventListener('change', e => {
    APP_STATE.selectedColId = e.target.value;
    renderApp();
  });
  document.getElementById('btn-apply-col-meta')?.addEventListener('click', () => {
    const col = ds.columns.find(c => c.id === APP_STATE.selectedColId) || ds.columns[0];
    if (!col) return;
    const newType = document.getElementById('ins-type-select')?.value || col.semanticType;
    const newRole = document.getElementById('ins-role-select')?.value || col.role;
    const newUnit = document.getElementById('ins-unit-input')?.value?.trim() || null;
    col.role = newRole;
    col.unit = newUnit;
    if (newType !== (col.confirmedType || col.semanticType)) {
      openPreviewModal(ds, 'CHANGE_COLUMN_TYPE', { colId: col.id, columnName: col.displayName, targetType: newType });
    } else {
      showToast(`Updated metadata for "${col.displayName}"`, 'info');
      renderApp();
    }
  });

  document.querySelectorAll('[data-preview-issue]').forEach(btn => {
    btn.addEventListener('click', () => {
      const issId = btn.getAttribute('data-preview-issue');
      const iss = issues.find(i => i.id === issId);
      if (iss && iss.suggestedRemedy) {
        openPreviewModal(ds, iss.suggestedRemedy.operationType, iss.suggestedRemedy.params);
      }
    });
  });

  document.getElementById('btn-run-safe-batch')?.addEventListener('click', () => {
    const lowRiskIssues = issues.filter(i => i.riskClassification === RISK_LEVELS.LOW && i.suggestedRemedy);
    if (lowRiskIssues.length === 0) {
      showToast('No low-risk superficial issues remain to batch-apply.', 'info');
      return;
    }
    let count = 0;
    for (const iss of lowRiskIssues) {
      applyTransformation(ds, iss.suggestedRemedy.operationType, iss.suggestedRemedy.params);
      count++;
    }
    showToast(`Executed ${count} low-risk batch operation(s).`, 'info');
    renderApp();
  });

  document.getElementById('clean-col-select')?.addEventListener('change', e => {
    APP_STATE.selectedColId = e.target.value;
    renderApp();
  });
  document.querySelectorAll('[data-select-op]').forEach(item => {
    item.addEventListener('click', () => {
      APP_STATE.selectedOperationType = item.getAttribute('data-select-op');
      renderApp();
    });
  });
  document.querySelectorAll('[data-clean-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      APP_STATE.cleaningMode = btn.getAttribute('data-clean-mode');
      renderApp();
    });
  });

  document.getElementById('btn-parse-nl')?.addEventListener('click', () => {
    const val = document.getElementById('nl-command-input')?.value || '';
    APP_STATE.nlCommandInput = val;
    APP_STATE.nlProposal = parseNaturalLanguageCommand(val, ds);
    renderApp();
  });
  document.getElementById('btn-preview-nl-proposal')?.addEventListener('click', () => {
    if (APP_STATE.nlProposal && !APP_STATE.nlProposal.unsupported) {
      openPreviewModal(ds, APP_STATE.nlProposal.operationType, APP_STATE.nlProposal.params);
    }
  });

  document.getElementById('btn-studio-preview-op')?.addEventListener('click', () => {
    const col = ds.columns.find(c => c.id === APP_STATE.selectedColId) || ds.columns[0];
    const opId = APP_STATE.selectedOperationType;
    const params = collectStudioOperationParams(opId, col);
    if (params) openPreviewModal(ds, opId, params);
  });

  document.getElementById('btn-run-unpivot')?.addEventListener('click', () => {
    const idCols = (document.getElementById('unpivot-ids')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const valCols = (document.getElementById('unpivot-vals')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const variableColumnName = document.getElementById('unpivot-var-name')?.value || 'variable';
    const valueColumnName = document.getElementById('unpivot-val-name')?.value || 'value';
    openPreviewModal(ds, 'UNPIVOT_WIDE_TO_LONG', { idColumns: idCols, valueColumns: valCols, variableColumnName, valueColumnName });
  });

  document.getElementById('btn-run-pivot-wide')?.addEventListener('click', () => {
    const idCol = document.getElementById('pivot-id-col')?.value;
    const namesFromColumn = document.getElementById('pivot-names-col')?.value;
    const valuesFromColumn = document.getElementById('pivot-vals-col')?.value;
    const conflictStrategy = document.getElementById('pivot-conflict')?.value || 'error';
    openPreviewModal(ds, 'PIVOT_LONG_TO_WIDE', {
      idColumns: [idCol],
      namesFromColumn,
      valuesFromColumn,
      conflictStrategy
    });
  });

  document.getElementById('btn-run-group-agg')?.addEventListener('click', () => {
    const grpCol = document.getElementById('grp-by-col')?.value;
    const targetCol = document.getElementById('grp-target-col')?.value;
    const fnChoice = document.getElementById('grp-agg-fn')?.value || 'mean';
    const aggregations = fnChoice === 'median'
      ? [{ columnName: targetCol, fn: 'median' }, { columnName: targetCol, fn: 'iqr' }, { columnName: targetCol, fn: 'count' }]
      : [{ columnName: targetCol, fn: fnChoice }, { columnName: targetCol, fn: 'count' }];
    openPreviewModal(ds, 'GROUP_AND_AGGREGATE', { groupColumns: [grpCol], aggregations });
  });

  document.getElementById('btn-promote-header')?.addEventListener('click', () => {
    openPreviewModal(ds, 'PROMOTE_ROW_TO_HEADER', { rowIndex: 0 });
  });
  document.getElementById('btn-fill-down-col')?.addEventListener('click', () => {
    openPreviewModal(ds, 'FILL_DOWN_HIERARCHICAL', { colId: ds.columns[0]?.id, columnName: ds.columns[0]?.displayName });
  });
  document.getElementById('btn-transpose-table')?.addEventListener('click', () => {
    openPreviewModal(ds, 'TRANSPOSE_TABLE', { headerColumn: ds.columns[0]?.displayName, variableColumnName: 'original_column' });
  });

  document.getElementById('btn-load-join-pair')?.addEventListener('click', () => {
    loadPresetDataset('preset_join_customers_right');
    loadPresetDataset('preset_join_orders_left', 'restructure');
    showToast('Loaded Orders (5A) and Customer Directory (5B) for join inspection.', 'info');
  });

  document.getElementById('btn-inspect-join')?.addEventListener('click', () => {
    const rightId = document.getElementById('join-right-ds')?.value;
    const rightDs = APP_STATE.datasets.find(d => d.id === rightId) || ds;
    const leftKey = document.getElementById('join-left-key')?.value;
    const rightKey = document.getElementById('join-right-key')?.value;
    try {
      APP_STATE.joinPreviewResult = inspectJoinDiagnostics(ds, rightDs, [{ leftKey, rightKey }]);
      renderApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-execute-join')?.addEventListener('click', () => {
    const rightId = document.getElementById('join-right-ds')?.value;
    const rightDs = APP_STATE.datasets.find(d => d.id === rightId) || ds;
    const leftKey = document.getElementById('join-left-key')?.value;
    const rightKey = document.getElementById('join-right-key')?.value;
    const joinType = document.getElementById('join-type-select')?.value || 'left';
    try {
      const preState = { columns: structuredClone(ds.columns), rows: structuredClone(ds.rows), learnedParameters: structuredClone(ds.learnedParameters || {}) };
      const rowsBefore = ds.rows.length;
      const joined = executeDatasetJoin(ds, rightDs, { joinType, leftKey, rightKey });
      ds.columns = joined.columns;
      ds.rows = joined.rows;
      ds.history.push({
        stepId: `step_${ds.history.length + 1}_join`,
        timestamp: new Date().toISOString(),
        operationType: 'RELATIONAL_JOIN',
        label: `Relational ${joinType.toUpperCase()} Join`,
        category: 'Restructuring',
        riskLevel: RISK_LEVELS.HIGH,
        params: { joinType, leftKey, rightKey, rightDatasetTitle: rightDs.title },
        summary: joined.summary,
        rowsBefore,
        rowsAfter: ds.rows.length,
        cellChangeCount: 0,
        sampleCellChanges: [],
        preState
      });
      ds.redoStack = [];
      ds.revision++;
      showToast(joined.summary, 'info');
      renderApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-execute-append')?.addEventListener('click', () => {
    const rightId = document.getElementById('join-right-ds')?.value;
    const rightDs = APP_STATE.datasets.find(d => d.id === rightId) || ds;
    try {
      const preState = { columns: structuredClone(ds.columns), rows: structuredClone(ds.rows), learnedParameters: structuredClone(ds.learnedParameters || {}) };
      const rowsBefore = ds.rows.length;
      const appended = executeDatasetAppend([ds, rightDs]);
      ds.columns = appended.columns;
      ds.rows = appended.rows;
      ds.history.push({
        stepId: `step_${ds.history.length + 1}_append`,
        timestamp: new Date().toISOString(),
        operationType: 'DATASET_APPEND',
        label: 'Append / Union Datasets',
        category: 'Restructuring',
        riskLevel: RISK_LEVELS.MEDIUM,
        params: { rightDatasetTitle: rightDs.title },
        summary: appended.summary,
        rowsBefore,
        rowsAfter: ds.rows.length,
        cellChangeCount: 0,
        sampleCellChanges: [],
        preState
      });
      ds.redoStack = [];
      ds.revision++;
      showToast(appended.summary, 'info');
      renderApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-save-recipe-local')?.addEventListener('click', () => {
    const rcp = exportCleaningRecipe(ds);
    const res = saveRecipeToStorage(rcp);
    if (res.saved) {
      showToast(`Saved recipe "${rcp.title}" to browser storage.`, 'info');
      renderApp();
    } else {
      showToast(`Could not save recipe: ${res.reason}`, 'warning');
    }
  });
  document.getElementById('btn-download-recipe-json')?.addEventListener('click', () => {
    const rcp = exportCleaningRecipe(ds);
    triggerDownload(`recipe_${ds.id}.json`, JSON.stringify(rcp, null, 2), 'application/json');
  });
  document.querySelectorAll('[data-select-saved-recipe]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.getAttribute('data-select-saved-recipe');
      const found = loadSavedRecipes().find(r => r.recipeId === rid);
      if (found) {
        APP_STATE.uploadedRecipe = found;
        renderApp();
      }
    });
  });
  document.getElementById('btn-validate-recipe-json')?.addEventListener('click', () => {
    try {
      const raw = document.getElementById('recipe-json-editor')?.value || '';
      APP_STATE.uploadedRecipe = JSON.parse(raw);
      renderApp();
      showToast('Validated recipe schema compatibility.', 'info');
    } catch (err) {
      showToast(`Invalid Recipe JSON: ${err.message}`, 'error');
    }
  });
  document.getElementById('btn-replay-recipe')?.addEventListener('click', () => {
    try {
      const raw = document.getElementById('recipe-json-editor')?.value || '';
      const recipe = JSON.parse(raw);
      const mapRaw = document.getElementById('drift-col-map')?.value || '{}';
      const columnMapping = JSON.parse(mapRaw);
      const res = replayCleaningRecipe(ds, recipe, { columnMapping, allowMappedOverride: true });
      showToast(`Replayed ${res.stepsApplied} recipe step(s) cleanly.`, 'info');
      renderApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-add-val-rule')?.addEventListener('click', () => {
    const name = document.getElementById('val-rule-name')?.value?.trim() || 'Validation Rule';
    const type = document.getElementById('val-rule-type')?.value || VALIDATION_RULE_TYPES.NONMISSING;
    const column = document.getElementById('val-rule-col')?.value;
    const minStr = document.getElementById('val-param-min')?.value?.trim() || '';
    const maxStr = document.getElementById('val-param-max')?.value?.trim() || '';
    const isQualityGate = Boolean(document.getElementById('val-is-gate')?.checked);

    const rule = {
      id: `rule_${Date.now().toString(36)}`,
      name,
      type,
      column,
      isQualityGate,
      enabled: true
    };
    if (type === VALIDATION_RULE_TYPES.MIN_VALUE || type === VALIDATION_RULE_TYPES.INCLUSIVE_RANGE) rule.min = Number(minStr || 0);
    if (type === VALIDATION_RULE_TYPES.MAX_VALUE || type === VALIDATION_RULE_TYPES.INCLUSIVE_RANGE) rule.max = Number(maxStr || 1000000);
    if (type === VALIDATION_RULE_TYPES.ALLOWED_CATEGORIES) rule.allowed = maxStr.split(',').map(s => s.trim()).filter(Boolean);
    if (type === VALIDATION_RULE_TYPES.PATTERN) rule.pattern = minStr || '.*';
    if (type === VALIDATION_RULE_TYPES.STRING_LENGTH) { rule.minLength = Number(minStr || 0); rule.maxLength = Number(maxStr || 255); }
    if (type === VALIDATION_RULE_TYPES.CUSTOM_FORMULA || type === VALIDATION_RULE_TYPES.CROSS_FIELD) rule.expression = minStr || 'true';
    if (type === VALIDATION_RULE_TYPES.COMPOSITE_UNIQUENESS) rule.columns = (minStr || column).split(',').map(s => s.trim()).filter(Boolean);
    if (type === VALIDATION_RULE_TYPES.DATE_RANGE) { rule.minDate = minStr || '1900-01-01'; rule.maxDate = maxStr || '2100-12-31'; }
    if (type === VALIDATION_RULE_TYPES.CONDITIONAL_REQUIREMENT) { rule.ifColumn = minStr || column; rule.ifEquals = maxStr || 'true'; }
    if (type === VALIDATION_RULE_TYPES.REFERENTIAL_INTEGRITY) { rule.referenceValues = (maxStr || minStr).split(',').map(s => s.trim()).filter(Boolean); }

    ds.validationRules.push(rule);
    showToast(`Added constraint "${name}"`, 'info');
    renderApp();
  });

  document.querySelectorAll('[data-remove-rule]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.getAttribute('data-remove-rule');
      ds.validationRules = ds.validationRules.filter(r => r.id !== rid);
      renderApp();
    });
  });

  const getBaseName = () => (document.getElementById('exp-filename')?.value || `cleaned_${ds.id}`).trim();
  const checkGateBeforeExport = () => {
    const suite = runValidationSuite(ds);
    if (suite.exportBlockedByGate) {
      showToast(`Export blocked by Quality Gate: ${suite.failedGates.map(g => g.name).join(', ')}`, 'error');
      return false;
    }
    return true;
  };

  document.getElementById('btn-exp-csv')?.addEventListener('click', () => {
    if (!checkGateBeforeExport()) return;
    const missingToken = document.getElementById('exp-missing-token')?.value ?? '';
    const sanitize = Boolean(document.getElementById('exp-csv-sanitize')?.checked);
    const csv = exportToDelimitedText(ds, { delimiter: ',', missingToken, sanitizeFormulaInjection: sanitize });
    triggerDownload(`${getBaseName()}.csv`, csv, 'text/csv;charset=utf-8');
  });
  document.getElementById('btn-exp-tsv')?.addEventListener('click', () => {
    if (!checkGateBeforeExport()) return;
    const missingToken = document.getElementById('exp-missing-token')?.value ?? '';
    const sanitize = Boolean(document.getElementById('exp-csv-sanitize')?.checked);
    const tsv = exportToDelimitedText(ds, { delimiter: '\t', missingToken, sanitizeFormulaInjection: sanitize });
    triggerDownload(`${getBaseName()}.tsv`, tsv, 'text/tab-separated-values;charset=utf-8');
  });
  document.getElementById('btn-exp-xlsx')?.addEventListener('click', () => {
    if (!checkGateBeforeExport()) return;
    const bytes = exportToXlsxBytes(ds);
    triggerDownload(`${getBaseName()}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
  document.getElementById('btn-exp-datasense')?.addEventListener('click', () => {
    if (!checkGateBeforeExport()) return;
    const dsJson = exportToDataSenseJson(ds);
    triggerDownload(`${getBaseName()}.datasense.json`, JSON.stringify(dsJson, null, 2), 'application/json');
  });
  document.getElementById('btn-exp-json')?.addEventListener('click', () => {
    if (!checkGateBeforeExport()) return;
    triggerDownload(`${getBaseName()}.json`, exportToJsonRecords(ds, false), 'application/json');
  });
  document.getElementById('btn-exp-ndjson')?.addEventListener('click', () => {
    if (!checkGateBeforeExport()) return;
    triggerDownload(`${getBaseName()}.ndjson`, exportToJsonRecords(ds, true), 'application/x-ndjson');
  });
  document.getElementById('btn-exp-recipe')?.addEventListener('click', () => {
    const rcp = exportCleaningRecipe(ds);
    triggerDownload(`${getBaseName()}_recipe.json`, JSON.stringify(rcp, null, 2), 'application/json');
  });
  document.getElementById('btn-exp-report')?.addEventListener('click', () => {
    const rep = generateQualityAuditReport(ds, issues);
    triggerDownload(`${getBaseName()}_quality_report.md`, rep, 'text/markdown;charset=utf-8');
  });
  document.getElementById('btn-share-state-url')?.addEventListener('click', () => {
    const hash = encodeWorkspaceHashState({
      presetId: ds.sourceMetadata?.presetId || 'preset_messy_customers',
      activeView: APP_STATE.activeView,
      explanationMode: APP_STATE.explanationMode,
      recipe: exportCleaningRecipe(ds)
    });
    if (hash) {
      window.location.hash = hash;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(window.location.href).catch(() => {});
      }
      showToast('Updated URL hash (#state=...) for reproducible workspace sharing.', 'info');
    }
  });
  document.getElementById('btn-exp-r')?.addEventListener('click', e => {
    e.stopPropagation();
    triggerDownload(`${getBaseName()}_pipeline.R`, generateRScript(ds), 'text/plain;charset=utf-8');
  });
  document.getElementById('btn-exp-py')?.addEventListener('click', e => {
    e.stopPropagation();
    triggerDownload(`${getBaseName()}_pipeline.py`, generatePythonScript(ds), 'text/plain;charset=utf-8');
  });

  document.getElementById('atlas-search-input')?.addEventListener('input', e => {
    APP_STATE.atlasSearchQuery = e.target.value;
    renderApp();
  });
  document.getElementById('atlas-domain-select')?.addEventListener('change', e => {
    APP_STATE.atlasDomainFilter = e.target.value;
    renderApp();
  });
  document.querySelectorAll('[data-launch-investigation]').forEach(btn => {
    btn.addEventListener('click', () => {
      const invId = btn.getAttribute('data-launch-investigation');
      const inv = GUIDED_INVESTIGATIONS.find(i => i.id === invId);
      if (!inv) return;
      const loadedDs = loadPresetDataset(inv.presetId, 'cleaning');
      if (loadedDs && inv.recommendedOperation) {
        APP_STATE.selectedOperationType = inv.recommendedOperation.type;
        renderApp();
        openPreviewModal(loadedDs, inv.recommendedOperation.type, inv.recommendedOperation.params);
      } else {
        showToast(`Loaded Lab #${inv.number}: ${inv.title}`, 'info');
      }
    });
  });

  document.getElementById('btn-clear-storage')?.addEventListener('click', () => {
    clearAllBrowserStorage();
    showToast('Cleared all saved recipes and reset browser localStorage.', 'info');
    renderApp();
  });
}

function collectStudioOperationParams(opId, col) {
  const base = { colId: col?.id, columnName: col?.displayName };
  switch (opId) {
    case 'TRIM_WHITESPACE':
      return {
        ...base,
        mode: document.getElementById('op-trim-mode')?.value || 'both',
        normalizeInternal: Boolean(document.getElementById('op-trim-internal')?.checked)
      };
    case 'STANDARDIZE_CASE':
      return { ...base, mode: document.getElementById('op-case-mode')?.value || 'canonical_most_frequent' };
    case 'FIND_REPLACE_TEXT':
      return {
        ...base,
        find: document.getElementById('op-find-str')?.value || '',
        replace: document.getElementById('op-replace-str')?.value || '',
        matchMode: document.getElementById('op-match-mode')?.value || 'exact'
      };
    case 'PAD_OR_AFFIX_TEXT':
      return {
        ...base,
        targetLength: Number(document.getElementById('op-pad-len')?.value || 0),
        padChar: document.getElementById('op-pad-char')?.value || '0',
        prefix: document.getElementById('op-prefix')?.value || '',
        treatAsIdentifier: true
      };
    case 'CHANGE_COLUMN_TYPE':
      return { ...base, targetType: document.getElementById('op-target-type')?.value || SEMANTIC_TYPES.TEXT };
    case 'PARSE_DATES':
      return { ...base, dateFormat: document.getElementById('op-date-fmt')?.value || 'MDY' };
    case 'CONVERT_UNITS':
      return { ...base, targetUnit: document.getElementById('op-target-unit')?.value || 'kg' };
    case 'IMPUTE_MISSING': {
      const method = document.getElementById('op-impute-method')?.value || 'median';
      const constOrCol = document.getElementById('op-impute-const')?.value?.trim() || '';
      const trainOnly = Boolean(document.getElementById('op-impute-train-only')?.checked);
      return {
        ...base,
        method,
        constantValue: constOrCol || '0',
        groupColumn: constOrCol || undefined,
        splitColumn: trainOnly ? (constOrCol || 'split') : undefined,
        trainValue: trainOnly ? 'train' : undefined,
        confirmOrdered: true
      };
    }
    case 'DEDUPLICATE_EXACT':
      return { strategy: document.getElementById('op-dedup-strategy')?.value || 'keep_first' };
    case 'MAP_CATEGORIES':
      try {
        const mapping = JSON.parse(document.getElementById('op-cat-map-json')?.value || '{}');
        return { ...base, mapping };
      } catch (err) {
        showToast(`Invalid Category Mapping JSON: ${err.message}`, 'error');
        return null;
      }
    case 'FLAG_OUTLIERS':
      return { ...base, method: document.getElementById('op-outlier-method')?.value || 'tukey_iqr' };
    case 'WINSORIZE_OUTLIERS':
      return {
        ...base,
        minBound: document.getElementById('op-win-min')?.value,
        maxBound: document.getElementById('op-win-max')?.value
      };
    case 'FILTER_ROWS':
      return { expression: document.getElementById('op-filter-expr')?.value || 'true' };
    case 'SORT_ROWS':
      return { ...base, direction: document.getElementById('op-sort-dir')?.value || 'asc' };
    case 'RENAME_COLUMN':
      return { ...base, newName: document.getElementById('op-rename-val')?.value || `${col.displayName}_clean` };
    case 'ADD_CALCULATED_COLUMN':
      return {
        ...base,
        sourceColumn: col.displayName,
        newColumnName: document.getElementById('op-calc-name')?.value || `${col.displayName}_derived`,
        calcType: document.getElementById('op-calc-type')?.value || 'expression',
        expression: document.getElementById('op-calc-expr')?.value || ''
      };
    case 'NORMALIZE_UNICODE_CONTROL':
      return { ...base, normalizeNfc: Boolean(document.getElementById('op-unicode-nfc')?.checked ?? true) };
    case 'CLEAN_NUMERIC_TEXT':
      return { ...base, decimalSeparator: document.getElementById('op-num-dec')?.value || '.' };
    case 'ADD_MISSINGNESS_INDICATOR':
      return { ...base, newColumnName: document.getElementById('op-miss-ind-name')?.value || `${col?.displayName}_is_missing` };
    case 'DROP_MISSING_ROWS': {
      const scope = document.getElementById('op-drop-na-scope')?.value || 'selected';
      return scope === 'any' ? { colId: null, columnName: null } : base;
    }
    case 'MARK_DUPLICATE_KEYS': {
      const keys = (document.getElementById('op-dup-keys')?.value || col?.displayName || '').split(',').map(s => s.trim()).filter(Boolean);
      return { ...base, columnName: keys[0] || col?.displayName, keyColumns: keys };
    }
    case 'DROP_COLUMN':
      return base;
    case 'SPLIT_COLUMN': {
      const delimiter = document.getElementById('op-split-delim')?.value || ',';
      const outputNames = (document.getElementById('op-split-names')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      return { ...base, delimiter, outputNames };
    }
    case 'COMBINE_COLUMNS': {
      const columns = (document.getElementById('op-comb-cols')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const delimiter = document.getElementById('op-comb-delim')?.value ?? ' - ';
      const newColumnName = document.getElementById('op-comb-name')?.value || `${col?.displayName}_combined`;
      return { columns, delimiter, newColumnName, dropOriginal: false };
    }
    case 'UNPIVOT_WIDE_TO_LONG': {
      const idColumns = (document.getElementById('op-unpiv-ids')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const valueColumns = (document.getElementById('op-unpiv-vals')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      return { idColumns, valueColumns, variableColumnName: 'variable', valueColumnName: 'value' };
    }
    case 'PIVOT_LONG_TO_WIDE': {
      const idCol = document.getElementById('op-piv-id')?.value || col?.displayName;
      const namesFromColumn = document.getElementById('op-piv-names')?.value || col?.displayName;
      const valuesFromColumn = document.getElementById('op-piv-vals')?.value || col?.displayName;
      const conflictStrategy = document.getElementById('op-piv-conflict')?.value || 'mean';
      return { idColumns: [idCol], namesFromColumn, valuesFromColumn, conflictStrategy };
    }
    case 'FILL_DOWN_HIERARCHICAL':
      return base;
    case 'PROMOTE_ROW_TO_HEADER':
      return { rowIndex: Number(document.getElementById('op-prom-idx')?.value || 0) };
    case 'GROUP_AND_AGGREGATE': {
      const grpCol = document.getElementById('op-grp-by')?.value || col?.displayName;
      const targetCol = document.getElementById('op-grp-measure')?.value || col?.displayName;
      const fnChoice = document.getElementById('op-grp-fn')?.value || 'mean';
      const aggregations = fnChoice === 'median'
        ? [{ columnName: targetCol, fn: 'median' }, { columnName: targetCol, fn: 'iqr' }, { columnName: targetCol, fn: 'count' }]
        : [{ columnName: targetCol, fn: fnChoice }, { columnName: targetCol, fn: 'count' }];
      return { groupColumns: [grpCol], aggregations };
    }
    case 'TRANSPOSE_TABLE':
      return {
        headerColumn: document.getElementById('op-tr-hdr')?.value || col?.displayName,
        variableColumnName: document.getElementById('op-tr-varname')?.value || 'original_column'
      };
    default:
      return base;
  }
}

function handleFilesSelected(fileList) {
  const file = fileList[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx') {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const bytes = new Uint8Array(e.target.result);
        const wb = parseXlsxWorkbook(bytes);
        if (wb.sheets.length === 0) throw new Error('No readable worksheets found in XLSX workbook.');
        APP_STATE.pendingImportPreview = {
          filename: file.name,
          sizeBytes: file.size,
          format: 'XLSX',
          sheets: wb.sheets,
          selectedSheetIdx: 0,
          columnNames: wb.sheets[0].columnNames,
          rawRows: wb.sheets[0].rawRows,
          warnings: wb.sheets[0].warnings
        };
        renderApp();
      } catch (err) {
        showToast(`XLSX Import Error: ${err.message}`, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = String(e.target.result || '');
        if (ext === 'json' || ext === 'ndjson') {
          const jRes = parseJsonContent(text);
          APP_STATE.pendingImportPreview = {
            filename: file.name,
            sizeBytes: file.size,
            format: jRes.detectedFormat,
            rawText: text,
            columnNames: jRes.columnNames,
            rawRows: jRes.rawRows,
            columnOverrides: jRes.columnOverrides,
            warnings: jRes.warnings,
            candidatePaths: jRes.candidatePaths,
            selectedPath: jRes.selectedPath
          };
        } else {
          const cRes = parseDelimitedText(text);
          APP_STATE.pendingImportPreview = {
            filename: file.name,
            sizeBytes: file.size,
            format: ext === 'tsv' ? 'TSV' : 'CSV',
            rawText: text,
            delimiter: cRes.delimiter,
            hasHeader: true,
            columnNames: cRes.columnNames,
            rawRows: cRes.rawRows,
            warnings: cRes.warnings
          };
        }
        renderApp();
      } catch (err) {
        showToast(`File Import Error: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
  }
}

export function initDataMendApp() {
  if (typeof document === 'undefined') return;

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      APP_STATE.activeView = tab.getAttribute('data-view') || 'home';
      renderApp();
    });
  });

  document.getElementById('active-dataset-select')?.addEventListener('change', e => {
    APP_STATE.activeDatasetId = e.target.value;
    const ds = getActiveDataset();
    APP_STATE.selectedColId = ds?.columns[0]?.id || null;
    renderApp();
  });

  document.getElementById('preset-loader-select')?.addEventListener('change', e => {
    if (e.target.value) {
      loadPresetDataset(e.target.value);
      e.target.value = '';
    }
  });

  document.querySelectorAll('[data-exp-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      APP_STATE.explanationMode = btn.getAttribute('data-exp-mode') || 'standard';
      renderApp();
    });
  });

  document.getElementById('btn-undo')?.addEventListener('click', () => {
    const ds = getActiveDataset();
    if (ds && undoTransformation(ds)) {
      showToast('Undid last operation and restored previous dataset snapshot.', 'info');
      renderApp();
    }
  });
  document.getElementById('btn-redo')?.addEventListener('click', () => {
    const ds = getActiveDataset();
    if (ds && redoTransformation(ds)) {
      showToast('Redid operation.', 'info');
      renderApp();
    }
  });
  document.getElementById('btn-restore-original')?.addEventListener('click', () => {
    const ds = getActiveDataset();
    if (ds) {
      restoreOriginalDataset(ds);
      showToast('Restored dataset to exact imported state.', 'info');
      renderApp();
    }
  });

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    renderApp();
  });

  document.getElementById('btn-close-preview-modal')?.addEventListener('click', () => {
    const backdrop = document.getElementById('preview-modal-backdrop');
    if (backdrop) backdrop.hidden = true;
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const backdrop = document.getElementById('preview-modal-backdrop');
      if (backdrop && !backdrop.hidden) backdrop.hidden = true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      const ds = getActiveDataset();
      if (ds && undoTransformation(ds)) renderApp();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      const ds = getActiveDataset();
      if (ds && redoTransformation(ds)) renderApp();
    }
  });

  window.addEventListener('resize', () => {
    renderApp();
  });

  loadPresetDataset('preset_join_customers_right');
  loadPresetDataset('preset_join_orders_left');
  loadPresetDataset('preset_messy_customers', 'home');

  if (window.location.hash && window.location.hash.startsWith('#state=')) {
    const restored = decodeWorkspaceHashState(window.location.hash);
    if (restored) {
      if (restored.explanationMode) APP_STATE.explanationMode = restored.explanationMode;
      const targetDs = restored.presetId ? loadPresetDataset(restored.presetId, restored.activeView || 'home') : getActiveDataset();
      if (targetDs && restored.recipe && Array.isArray(restored.recipe.steps) && restored.recipe.steps.length > 0) {
        try { replayCleaningRecipe(targetDs, restored.recipe, { allowMappedOverride: true }); } catch {}
      }
      renderApp();
    }
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDataMendApp);
  } else {
    initDataMendApp();
  }
}
