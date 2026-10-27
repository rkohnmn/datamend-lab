/**
 * DataMend Lab — High-DPI Canvas 2D Statistical & Data-Quality Visualization Renderer
 * Adheres strictly to VISUALIZATION_STANDARDS.md and DESIGN.md:
 * - Scales internal backing store by window.devicePixelRatio (clamped to 2.5x)
 * - Uses canonical design tokens: Phosphor Emerald (#0F6E56 / #34D399), Vermilion (#D9381E / #F87171),
 *   Amber (#B45309 / #F59E0B), and Archival surfaces
 * - Never truncates bar chart zero baselines
 * - Never renders "dynamite plots" (bar charts of continuous means)
 * - Pairs color channels with geometric patterns/labels for CVD accessibility.
 */

import { MISSING_STATES, SEMANTIC_TYPES } from './data-model.js';

function getThemePalette() {
  const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    bg: isDark ? '#151921' : '#FFFFFF',
    grid: isDark ? '#2A3140' : '#E6E2D6',
    text: isDark ? '#F1F5F9' : '#141619',
    muted: isDark ? '#94A3B8' : '#525866',
    primary: isDark ? '#34D399' : '#0F6E56',
    primarySoft: isDark ? 'rgba(52, 211, 153, 0.25)' : 'rgba(15, 110, 86, 0.20)',
    secondary: isDark ? '#F87171' : '#D9381E',
    warning: isDark ? '#F59E0B' : '#B45309',
    accent: isDark ? '#60A5FA' : '#1D4ED8'
  };
}

function setupHiDPICanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2.5);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, rect.width || canvas.width || 600);
  const height = Math.max(180, rect.height || canvas.height || 240);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, palette: getThemePalette() };
}

/**
 * 1. Renders a Dataset Missingness Matrix & Completeness Overview (Part 8.4).
 */
export function renderMissingnessMatrix(canvas, dataset) {
  const env = setupHiDPICanvas(canvas);
  if (!env) return;
  const { ctx, width, height, palette } = env;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  const cols = dataset.columns;
  const rows = dataset.rows;
  if (cols.length === 0 || rows.length === 0) {
    ctx.fillStyle = palette.muted;
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('No dataset observations to display.', 20, height / 2);
    return;
  }

  const padLeft = 56;
  const padRight = 20;
  const padTop = 38;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const colW = plotW / cols.length;
  const maxSampleRows = Math.min(rows.length, 100);
  const rowH = plotH / maxSampleRows;

  // Column labels at top
  ctx.font = '600 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  cols.forEach((col, cIdx) => {
    const x = padLeft + cIdx * colW + colW / 2;
    const label = col.displayName.length > 12 ? col.displayName.slice(0, 11) + '…' : col.displayName;
    ctx.fillStyle = palette.text;
    ctx.fillText(label, x, 20);
  });

  // Matrix cells
  for (let r = 0; r < maxSampleRows; r++) {
    const rowIdx = Math.floor((r / maxSampleRows) * rows.length);
    const row = rows[rowIdx];
    const y = padTop + r * rowH;

    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const cell = row.cells[col.id];
      const x = padLeft + c * colW;

      if (!cell || cell.missingState === MISSING_STATES.MISSING || cell.missingState === MISSING_STATES.EMPTY_STRING) {
        ctx.fillStyle = palette.warning;
        ctx.fillRect(x + 1, y, Math.max(2, colW - 2), Math.max(1.5, rowH - 0.5));
      } else if (cell.missingState === MISSING_STATES.INVALID_PARSE || cell.missingState === MISSING_STATES.NONFINITE) {
        ctx.fillStyle = palette.secondary;
        ctx.fillRect(x + 1, y, Math.max(2, colW - 2), Math.max(1.5, rowH - 0.5));
      } else if (cell.isImputed) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(x + 1, y, Math.max(2, colW - 2), Math.max(1.5, rowH - 0.5));
      } else {
        ctx.fillStyle = palette.primarySoft;
        ctx.fillRect(x + 1, y, Math.max(2, colW - 2), Math.max(1.5, rowH - 0.5));
      }
    }
  }

  // Row index labels
  ctx.fillStyle = palette.muted;
  ctx.textAlign = 'right';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillText('Row 1', padLeft - 6, padTop + 10);
  ctx.fillText(`Row ${rows.length}`, padLeft - 6, padTop + plotH);

  // Legend at bottom
  ctx.textAlign = 'left';
  const legendItems = [
    { label: 'Present', color: palette.primary },
    { label: 'Missing / N/A', color: palette.warning },
    { label: 'Parse Error', color: palette.secondary },
    { label: 'Imputed', color: palette.accent }
  ];
  let lx = padLeft;
  for (const item of legendItems) {
    ctx.fillStyle = item.color;
    ctx.fillRect(lx, height - 16, 10, 10);
    ctx.fillStyle = palette.muted;
    ctx.fillText(item.label, lx + 14, height - 7);
    lx += 95;
  }
}

/**
 * 2. Renders Column Distribution (Quantitative Histogram + Boxplot crossbar, or Categorical Bar Chart from Zero Baseline).
 */
export function renderColumnDistribution(canvas, colProfile) {
  const env = setupHiDPICanvas(canvas);
  if (!env) return;
  const { ctx, width, height, palette } = env;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  if (!colProfile || colProfile.nonMissingCount === 0) {
    ctx.fillStyle = palette.muted;
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('No valid observations to plot for this column.', 20, height / 2);
    return;
  }

  const padLeft = 48;
  const padRight = 20;
  const padTop = 34;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Quantitative Variable -> Histogram + Tukey Boxplot strip at top
  if (colProfile.numericStats && colProfile.numericStats.n >= 2) {
    const st = colProfile.numericStats;
    const sorted = st.sorted;
    const min = st.min;
    const max = st.max === min ? min + 1 : st.max;
    const binCount = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(st.n))));
    const binWidth = (max - min) / binCount;
    const bins = new Int32Array(binCount);

    for (const v of sorted) {
      let b = Math.floor((v - min) / binWidth);
      if (b >= binCount) b = binCount - 1;
      if (b < 0) b = 0;
      bins[b]++;
    }

    const maxBin = Math.max(1, ...bins);

    // Top Tukey Boxplot Crossbar (y = 16)
    const toX = val => padLeft + ((val - min) / (max - min)) * plotW;
    const xQ1 = toX(st.q1);
    const xMed = toX(st.median);
    const xQ3 = toX(st.q3);
    const lowFence = Math.max(min, st.q1 - 1.5 * st.iqr);
    const highFence = Math.min(max, st.q3 + 1.5 * st.iqr);

    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(toX(lowFence), 16);
    ctx.lineTo(toX(highFence), 16);
    ctx.stroke();

    ctx.fillStyle = palette.primarySoft;
    ctx.fillRect(xQ1, 10, Math.max(2, xQ3 - xQ1), 12);
    ctx.strokeRect(xQ1, 10, Math.max(2, xQ3 - xQ1), 12);

    ctx.strokeStyle = palette.secondary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xMed, 9);
    ctx.lineTo(xMed, 23);
    ctx.stroke();

    // Histogram Bars from strict Zero Baseline (y = padTop + plotH)
    const barW = plotW / binCount;
    for (let i = 0; i < binCount; i++) {
      const h = (bins[i] / maxBin) * (plotH - 10);
      const x = padLeft + i * barW;
      const y = padTop + plotH - h;
      ctx.fillStyle = palette.primary;
      ctx.fillRect(x + 1, y, Math.max(2, barW - 2), h);
    }

    // Zero baseline & X-axis labels
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + plotH);
    ctx.lineTo(padLeft + plotW, padTop + plotH);
    ctx.stroke();

    ctx.fillStyle = palette.text;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(min.toFixed(2), padLeft, height - 10);
    ctx.textAlign = 'center';
    ctx.fillText(`Median: ${st.median.toFixed(2)} | Mean: ${st.mean.toFixed(2)}`, padLeft + plotW / 2, height - 10);
    ctx.textAlign = 'right';
    ctx.fillText(max.toFixed(2), padLeft + plotW, height - 10);
    return;
  }

  // Categorical / Identifier / Text Variable -> Horizontal Frequency Bars from Zero Baseline
  const topCats = colProfile.topValues.slice(0, 7);
  const maxFreq = Math.max(1, ...topCats.map(t => t.count));
  const rowH = plotH / Math.max(1, topCats.length);

  ctx.font = '11px "JetBrains Mono", monospace';
  topCats.forEach((item, idx) => {
    const y = padTop + idx * rowH;
    const barLen = (item.count / maxFreq) * (plotW - 110);
    const label = String(item.value).length > 14 ? String(item.value).slice(0, 13) + '…' : String(item.value);

    ctx.fillStyle = palette.text;
    ctx.textAlign = 'right';
    ctx.fillText(label, padLeft + 85, y + rowH / 2 + 4);

    ctx.fillStyle = palette.primary;
    ctx.fillRect(padLeft + 92, y + 3, Math.max(2, barLen), Math.max(6, rowH - 7));

    ctx.fillStyle = palette.muted;
    ctx.textAlign = 'left';
    ctx.fillText(`${item.count} (${(item.proportion * 100).toFixed(1)}%)`, padLeft + 98 + barLen, y + rowH / 2 + 4);
  });
}

/**
 * 3. Renders Before vs. After Quality Dimension Comparison Bar Chart (Strict Zero Baseline 0%–100%).
 */
export function renderBeforeAfterScorecardChart(canvas, comparison) {
  const env = setupHiDPICanvas(canvas);
  if (!env || !comparison) return;
  const { ctx, width, height, palette } = env;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  const dims = comparison.afterScorecard.dimensions;
  const padLeft = 175;
  const padRight = 56;
  const padTop = 26;
  const padBottom = 24;
  const plotW = Math.max(80, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;
  const rowH = plotH / dims.length;

  ctx.font = '11px "JetBrains Mono", monospace';
  dims.forEach((dim, i) => {
    const beforePct = comparison.beforeScorecard.dimensions[i].percentage;
    const afterPct = dim.percentage;
    const y = padTop + i * rowH;

    ctx.fillStyle = palette.text;
    ctx.textAlign = 'right';
    ctx.fillText(dim.name, padLeft - 10, y + rowH / 2 + 4);

    // Before bar (muted warning/gray)
    const wBefore = (beforePct / 100) * plotW;
    ctx.fillStyle = palette.grid;
    ctx.fillRect(padLeft, y + 3, Math.max(2, wBefore), Math.max(4, rowH / 2 - 4));

    // After bar (phosphor emerald)
    const wAfter = (afterPct / 100) * plotW;
    ctx.fillStyle = palette.primary;
    ctx.fillRect(padLeft, y + rowH / 2, Math.max(2, wAfter), Math.max(4, rowH / 2 - 4));

    ctx.fillStyle = palette.text;
    ctx.textAlign = 'left';
    ctx.fillText(`${afterPct.toFixed(1)}%`, padLeft + Math.max(wBefore, wAfter) + 6, y + rowH / 2 + 4);
  });
}
