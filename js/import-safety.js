/** Interactive import bounds shared by the independent DataSense lab releases. */
export const IMPORT_LIMITS = Object.freeze({bytes: 2 * 1024 * 1024, rows: 5000, columns: 40, cells: 100000});
export function assertInputSize(input) {
  const bytes = typeof input === 'number' ? input : new TextEncoder().encode(String(input ?? '')).length;
  if (bytes > IMPORT_LIMITS.bytes) throw new Error('Input exceeds 2 MB. Import a smaller subset; your current dataset is unchanged.');
}
export function assertTableSize(rows, columns) {
  if (rows > IMPORT_LIMITS.rows || columns > IMPORT_LIMITS.columns || rows * columns > IMPORT_LIMITS.cells) {
    throw new Error('Interactive imports allow up to 5,000 rows, 40 columns, and 100,000 cells. Import a smaller subset.');
  }
}
export function assertHeaders(headers) {
  if (!headers.length || headers.some(h => typeof h !== 'string' || !h.trim())) throw new Error('Provide a non-empty name for every column.');
  if (new Set(headers).size !== headers.length) throw new Error('Column names must be unique. Rename duplicate headers before importing.');
}
export function missingNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object') return NaN;
  if (typeof value === 'string' && (!value.trim() || /^(na|null|nan)$/i.test(value.trim()))) return NaN;
  return Number(value);
}

/** RFC-style CSV/TSV records, preserving quoted newlines and escaped quotes. */
export function readDelimitedRecords(input, delimiter = null) {
  assertInputSize(input);
  const text = String(input ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('Input is empty. Paste data or choose a file.');
  if (!delimiter) {
    const counts = new Map([[',',0],['\t',0],[';',0]]);
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') { if (quoted && text[i+1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && /[\r\n]/.test(ch)) break;
      else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)+1);
    }
    delimiter = [...counts].sort((a,b)=>b[1]-a[1])[0][0];
  }
  const records = []; let row = [], field = '', quoted = false, closed = false;
  const cell = () => { row.push(field.trim()); field = ''; closed = false; };
  const record = () => { cell(); if (row.some(v=>v !== '')) records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += ch;
    } else if (ch === delimiter) cell();
    else if (ch === '\n' || ch === '\r') { record(); if (ch === '\r' && text[i+1] === '\n') i++; }
    else if (ch === '"') {
      if (field.trim() || closed) throw new Error('Unexpected quote in a field. Quote the whole field and double any embedded quotes.');
      field = ''; quoted = true;
    } else {
      if (closed && ch.trim()) throw new Error('Unexpected text after a closing quote. Check the delimiter.');
      if (!closed) field += ch;
    }
  }
  if (quoted) throw new Error('Unclosed quotation mark. Close the quoted field before importing.');
  record();
  return {records, delimiter};
}
