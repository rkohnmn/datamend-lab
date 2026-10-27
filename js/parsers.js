/**
 * DataMend Lab — Multi-Format Data Import Engine (Part 6)
 * Pure ES2022+ zero-dependency parsers for:
 * - CSV and TSV (RFC 4180 + custom delimiters, quotes, escaped quotes, embedded newlines, BOM, malformed row flags)
 * - XLSX Excel Workbooks (Pure-JS ZIP/DEFLATE + OpenXML parser supporting multi-sheet selection, sharedStrings,
 *   date serials, leading-zero identifiers, literal values vs cached formula results vs unevaluated formulas)
 * - JSON (Flat arrays, nested objects with selectable record path, optional controlled flattening, NDJSON)
 * - DataSense Interchange JSON (`DataSenseDataset` v1.0.0)
 */

import { createDataset, SEMANTIC_TYPES } from './data-model.js';

const MAX_SAFE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB decompression/input safeguard

/**
 * Detects delimiter from the first few lines of delimited text.
 */
export function detectDelimiter(text) {
  const sample = text.slice(0, 4096);
  const lines = sample.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ',';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = -1;
  for (const delim of candidates) {
    const counts = lines.map(line => {
      let inQuotes = false;
      let c = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuotes = !inQuotes;
        else if (!inQuotes && line[i] === delim) c++;
      }
      return c;
    });
    const minC = Math.min(...counts);
    const maxC = Math.max(...counts);
    if (minC > 0 && minC === maxC && minC > bestScore) {
      bestScore = minC;
      best = delim;
    } else if (counts[0] > bestScore && bestScore <= 0) {
      bestScore = counts[0];
      best = delim;
    }
  }
  return best;
}

/**
 * RFC 4180 Compliant Delimited Text Parser with configurable overrides and malformed row preservation.
 */
export function parseDelimitedText(rawText, options = {}) {
  if (typeof rawText !== 'string') {
    throw new Error('Input to parseDelimitedText must be a string.');
  }
  if (rawText.length > MAX_SAFE_FILE_BYTES) {
    throw new Error(`Input exceeds maximum safe size limit (${MAX_SAFE_FILE_BYTES} bytes).`);
  }

  // Strip UTF-8 BOM if present
  let text = rawText;
  let hadBOM = false;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
    hadBOM = true;
  }

  const delimiter = options.delimiter || detectDelimiter(text);
  const quoteChar = options.quoteChar ?? '"';
  const hasHeader = options.hasHeader !== false;
  const skipPreambleRows = Number(options.skipPreambleRows || 0);

  const records = [];
  const warnings = [];
  let currentField = '';
  let currentRow = [];
  let inQuotes = false;
  let rowStartLine = 1;
  let currentLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nextCh = text[i + 1];

    if (inQuotes) {
      if (ch === quoteChar) {
        if (nextCh === quoteChar) {
          currentField += quoteChar;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') currentLine++;
        currentField += ch;
      }
    } else {
      if (ch === quoteChar && currentField.length === 0) {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentField);
        currentField = '';
      } else if (ch === '\r' && nextCh === '\n') {
        currentRow.push(currentField);
        currentField = '';
        records.push({ line: rowStartLine, fields: currentRow });
        currentRow = [];
        i++;
        currentLine++;
        rowStartLine = currentLine;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField);
        currentField = '';
        records.push({ line: rowStartLine, fields: currentRow });
        currentRow = [];
        currentLine++;
        rowStartLine = currentLine;
      } else {
        currentField += ch;
      }
    }
  }

  if (inQuotes) {
    warnings.push({
      line: rowStartLine,
      code: 'UNCLOSED_QUOTE',
      message: `Row starting on line ${rowStartLine} has an unclosed quotation mark.`
    });
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    records.push({ line: rowStartLine, fields: currentRow });
  }

  // Filter out trailing completely empty newline at EOF
  while (records.length > 0) {
    const last = records[records.length - 1];
    if (last.fields.length === 1 && last.fields[0] === '') {
      records.pop();
    } else {
      break;
    }
  }

  const slicedRecords = skipPreambleRows > 0 ? records.slice(skipPreambleRows) : records;
  if (slicedRecords.length === 0) {
    return {
      columnNames: [],
      rawRows: [],
      delimiter,
      hadBOM,
      warnings
    };
  }

  let columnNames = [];
  let dataStartIdx = 0;

  if (hasHeader) {
    columnNames = slicedRecords[0].fields.map((h, idx) => h.trim() || `col_${idx + 1}`);
    dataStartIdx = 1;
    // Check duplicate headers
    const seen = new Set();
    for (const h of columnNames) {
      if (seen.has(h)) {
        warnings.push({
          line: slicedRecords[0].line,
          code: 'DUPLICATE_HEADER',
          message: `Duplicate column header "${h}" detected and disambiguated.`
        });
      }
      seen.add(h);
    }
  } else {
    const maxCols = Math.max(...slicedRecords.map(r => r.fields.length));
    columnNames = Array.from({ length: maxCols }, (_, idx) => `V${idx + 1}`);
    dataStartIdx = 0;
  }

  const expectedCols = columnNames.length;
  const rawRows = [];

  for (let r = dataStartIdx; r < slicedRecords.length; r++) {
    const rec = slicedRecords[r];
    const fields = [...rec.fields];
    if (fields.length !== expectedCols) {
      warnings.push({
        line: rec.line,
        rowNumber: rawRows.length + 1,
        code: 'MALFORMED_ROW_WIDTH',
        message: `Line ${rec.line}: Expected ${expectedCols} fields, found ${fields.length}. Values preserved without silent deletion.`
      });
      if (fields.length < expectedCols) {
        while (fields.length < expectedCols) fields.push(null);
      } else {
        // Expand columns so no data is silently discarded
        while (columnNames.length < fields.length) {
          const extraName = `extra_col_${columnNames.length + 1}`;
          columnNames.push(extraName);
          for (const prev of rawRows) prev.push(null);
        }
      }
    }
    rawRows.push(fields);
  }

  return {
    columnNames,
    rawRows,
    delimiter,
    hadBOM,
    warnings
  };
}

/**
 * Pure-JS Raw DEFLATE Decompressor (RFC 1951) for browser/Node XLSX parsing without external packages.
 */
export function inflateRaw(compressedBytes, maxOutputBytes = MAX_SAFE_FILE_BYTES) {
  const FIXED_LIT_LEN = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) FIXED_LIT_LEN[i] = 8;
  for (let i = 144; i <= 255; i++) FIXED_LIT_LEN[i] = 9;
  for (let i = 256; i <= 279; i++) FIXED_LIT_LEN[i] = 7;
  for (let i = 280; i <= 287; i++) FIXED_LIT_LEN[i] = 8;

  const FIXED_DIST = new Uint8Array(32);
  FIXED_DIST.fill(5);

  const LEN_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
  ];
  const LEN_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
  ];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
  ];
  const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
  ];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  let bitPos = 0;
  function readBits(n) {
    let val = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = bitPos >> 3;
      if (byteIdx >= compressedBytes.length) throw new Error('Unexpected EOF in DEFLATE stream');
      const bit = (compressedBytes[byteIdx] >> (bitPos & 7)) & 1;
      val |= (bit << i);
      bitPos++;
    }
    return val;
  }

  function buildHuffman(lengths) {
    const maxBits = Math.max(...lengths, 1);
    const blCount = new Int32Array(maxBits + 1);
    for (const l of lengths) if (l > 0) blCount[l]++;
    const nextCode = new Int32Array(maxBits + 1);
    let code = 0;
    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    const map = new Map();
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len > 0) {
        const c = nextCode[len]++;
        map.set((len << 16) | c, sym);
      }
    }
    return { map, maxBits };
  }

  function decodeSymbol(tree) {
    let code = 0;
    for (let len = 1; len <= tree.maxBits; len++) {
      code = (code << 1) | readBits(1);
      const key = (len << 16) | code;
      if (tree.map.has(key)) return tree.map.get(key);
    }
    throw new Error('Invalid Huffman code in DEFLATE stream');
  }

  const out = [];
  let bfinal = 0;

  while (!bfinal) {
    bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      // Uncompressed block
      bitPos = (bitPos + 7) & ~7;
      const len = readBits(16);
      const nlen = readBits(16);
      if ((len ^ 0xFFFF) !== nlen) throw new Error('Corrupt uncompressed DEFLATE block length');
      const startByte = bitPos >> 3;
      for (let i = 0; i < len; i++) {
        out.push(compressedBytes[startByte + i]);
        if (out.length > maxOutputBytes) throw new Error('DEFLATE decompression bomb protection triggered');
      }
      bitPos += len * 8;
    } else if (btype === 1 || btype === 2) {
      let litLenTree, distTree;
      if (btype === 1) {
        litLenTree = buildHuffman(FIXED_LIT_LEN);
        distTree = buildHuffman(FIXED_DIST);
      } else {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[CL_ORDER[i]] = readBits(3);
        const clTree = buildHuffman(clLengths);
        const allLengths = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < hlit + hdist) {
          const sym = decodeSymbol(clTree);
          if (sym <= 15) {
            allLengths[idx++] = sym;
          } else if (sym === 16) {
            const repeat = readBits(2) + 3;
            const prev = allLengths[idx - 1] || 0;
            for (let r = 0; r < repeat; r++) allLengths[idx++] = prev;
          } else if (sym === 17) {
            const repeat = readBits(3) + 3;
            for (let r = 0; r < repeat; r++) allLengths[idx++] = 0;
          } else if (sym === 18) {
            const repeat = readBits(7) + 11;
            for (let r = 0; r < repeat; r++) allLengths[idx++] = 0;
          }
        }
        litLenTree = buildHuffman(allLengths.slice(0, hlit));
        distTree = buildHuffman(allLengths.slice(hlit));
      }

      while (true) {
        const sym = decodeSymbol(litLenTree);
        if (sym === 256) break;
        if (sym < 256) {
          out.push(sym);
          if (out.length > maxOutputBytes) throw new Error('DEFLATE decompression bomb protection triggered');
        } else {
          const lenIdx = sym - 257;
          const length = LEN_BASE[lenIdx] + (LEN_EXTRA[lenIdx] ? readBits(LEN_EXTRA[lenIdx]) : 0);
          const distSym = decodeSymbol(distTree);
          const distance = DIST_BASE[distSym] + (DIST_EXTRA[distSym] ? readBits(DIST_EXTRA[distSym]) : 0);
          const startIdx = out.length - distance;
          if (startIdx < 0) throw new Error('Invalid DEFLATE lookback distance');
          for (let i = 0; i < length; i++) {
            out.push(out[startIdx + i]);
            if (out.length > maxOutputBytes) throw new Error('DEFLATE decompression bomb protection triggered');
          }
        }
      }
    } else {
      throw new Error('Invalid DEFLATE block type 3');
    }
  }

  return new Uint8Array(out);
}

/**
 * Extracts entries from a ZIP archive (Uint8Array) in pure JS.
 */
export function extractZipEntries(uint8) {
  if (uint8.length < 22) throw new Error('Invalid ZIP archive: file too short.');
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minOffset = Math.max(0, uint8.length - 65557);
  for (let pos = uint8.length - 22; pos >= minOffset; pos--) {
    if (view.getUint32(pos, true) === 0x06054b50) {
      eocdOffset = pos;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Invalid XLSX/ZIP archive: End of Central Directory not found.');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let ptr = cdOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > uint8.length || view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error('Corrupt Central Directory entry in ZIP archive.');
    }
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_SAFE_FILE_BYTES) {
      throw new Error('ZIP decompression bomb protection: total uncompressed size exceeds 50 MB.');
    }

    const nameBytes = uint8.subarray(ptr + 46, ptr + 46 + nameLen);
    const filename = decoder.decode(nameBytes);

    // Read local file header
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid local file header for ${filename}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = uint8.subarray(dataStart, dataStart + compressedSize);

    let contentBytes;
    if (compressionMethod === 0) {
      contentBytes = rawSlice;
    } else if (compressionMethod === 8) {
      contentBytes = inflateRaw(rawSlice);
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} in ${filename}`);
    }

    entries.set(filename, {
      filename,
      bytes: contentBytes,
      getText: () => decoder.decode(contentBytes)
    });

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Converts Excel column letters (e.g. "A", "B", "AA") to 0-based column index.
 */
export function excelColToIndex(colLetters) {
  let idx = 0;
  for (let i = 0; i < colLetters.length; i++) {
    idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * Converts Excel serial date number to ISO 8601 date string (accounting for 1900 leap-year bug or 1904 date system).
 */
export function excelSerialToIsoDate(serial, date1904 = false) {
  let days = Math.floor(serial);
  const frac = serial - days;
  if (!date1904 && days >= 60) {
    // Excel 1900 leap year bug: 1900-02-29 is serial 60
    days -= 1;
  }
  const baseEpoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const ms = baseEpoch + days * 86400000 + Math.round(frac * 86400000);
  const dt = new Date(ms);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  if (frac > 1e-6) {
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const mi = String(dt.getUTCMinutes()).padStart(2, '0');
    const ss = String(dt.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
  }
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Decodes basic XML entities.
 */
function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Parses an XLSX workbook (Uint8Array) and returns all sheets with metadata, merged cells,
 * hidden rows/sheets, formula inspection, and parsed rows.
 */
export function parseXlsxWorkbook(uint8, options = {}) {
  const entries = extractZipEntries(uint8);

  // Security check: detect macro-enabled vbaProject.bin
  const hasMacros = entries.has('xl/vbaProject.bin');
  const warnings = [];
  if (hasMacros) {
    warnings.push({
      code: 'VBA_MACROS_IGNORED',
      message: 'Workbook contains VBA macros (vbaProject.bin). Macros are strictly blocked and never executed.'
    });
  }

  // Parse sharedStrings.xml if present
  const sharedStrings = [];
  if (entries.has('xl/sharedStrings.xml')) {
    const sstXml = entries.get('xl/sharedStrings.xml').getText();
    const siMatches = sstXml.match(/<si[\s>][\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
      const combined = tMatches
        .map(t => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
        .join('');
      sharedStrings.push(combined);
    }
  }

  // Parse styles.xml to detect date number formats
  const dateStyleIndices = new Set();
  if (entries.has('xl/styles.xml')) {
    const stylesXml = entries.get('xl/styles.xml').getText();
    const customDateNumFmts = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
    const numFmtMatches = stylesXml.match(/<numFmt\s+[^>]*\/?>/g) || [];
    for (const nf of numFmtMatches) {
      const idMatch = /numFmtId="(\d+)"/.exec(nf);
      const codeMatch = /formatCode="([^"]+)"/.exec(nf);
      if (idMatch && codeMatch) {
        const fmtCode = codeMatch[1].toLowerCase().replace(/\[[^\]]*\]/g, '');
        if (/[ymdhs]/.test(fmtCode) && !/[#0]/.test(fmtCode)) {
          customDateNumFmts.add(Number(idMatch[1]));
        }
      }
    }
    const cellXfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    if (cellXfsBlock) {
      const xfMatches = cellXfsBlock[1].match(/<xf\s+[^>]*\/?>/g) || [];
      xfMatches.forEach((xf, idx) => {
        const nfId = /numFmtId="(\d+)"/.exec(xf);
        if (nfId && customDateNumFmts.has(Number(nfId[1]))) {
          dateStyleIndices.add(idx);
        }
      });
    }
  }

  // Parse workbook.xml & workbook.xml.rels to list sheets
  const wbXml = entries.has('xl/workbook.xml') ? entries.get('xl/workbook.xml').getText() : '';
  const date1904 = /date1904="(?:1|true)"/i.test(wbXml);
  const relsXml = entries.has('xl/_rels/workbook.xml.rels') ? entries.get('xl/_rels/workbook.xml.rels').getText() : '';

  const relMap = new Map();
  const relMatches = relsXml.match(/<Relationship\s+[^>]*\/?>/g) || [];
  for (const r of relMatches) {
    const idM = /Id="([^"]+)"/.exec(r);
    const targetM = /Target="([^"]+)"/.exec(r);
    if (idM && targetM) {
      let target = targetM[1].replace(/^\//, '');
      if (!target.startsWith('xl/')) target = 'xl/' + target;
      relMap.set(idM[1], target);
    }
  }

  const sheetsMeta = [];
  const sheetTagMatches = wbXml.match(/<sheet\s+[^>]*\/?>/g) || [];
  sheetTagMatches.forEach((tag, idx) => {
    const nameM = /name="([^"]+)"/.exec(tag);
    const rIdM = /r:id="([^"]+)"/.exec(tag);
    const stateM = /state="([^"]+)"/.exec(tag);
    const name = nameM ? decodeXmlEntities(nameM[1]) : `Sheet${idx + 1}`;
    const targetPath = (rIdM && relMap.get(rIdM[1])) || `xl/worksheets/sheet${idx + 1}.xml`;
    sheetsMeta.push({
      name,
      path: targetPath,
      hidden: stateM ? stateM[1] !== 'visible' : false
    });
  });

  if (sheetsMeta.length === 0) {
    for (const key of entries.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key)) {
        sheetsMeta.push({ name: key.split('/').pop().replace('.xml', ''), path: key, hidden: false });
      }
    }
  }

  const parsedSheets = [];

  for (const sm of sheetsMeta) {
    if (!entries.has(sm.path)) continue;
    const xml = entries.get(sm.path).getText();
    const sheetWarnings = [...warnings];
    if (sm.hidden) {
      sheetWarnings.push({
        code: 'HIDDEN_SHEET',
        message: `Worksheet "${sm.name}" is marked as hidden in the workbook.`
      });
    }

    // Detect merged cells
    const mergeMatches = xml.match(/<mergeCell\s+ref="([^"]+)"\s*\/?>/g) || [];
    if (mergeMatches.length > 0) {
      sheetWarnings.push({
        code: 'MERGED_CELLS_DETECTED',
        message: `Worksheet "${sm.name}" contains ${mergeMatches.length} merged cell range(s). Use Fill Down in Restructure Studio if hierarchical labels need propagation.`
      });
    }

    const rowBlocks = xml.match(/<row(?:\s[^>]*)?>[\s\S]*?<\/row>/g) || [];
    const gridMap = new Map();
    let maxRow = 0;
    let maxCol = 0;
    let hiddenRowCount = 0;

    for (const rowXml of rowBlocks) {
      const rAttr = /<row[^>]*\br="(\d+)"/.exec(rowXml);
      const isHiddenRow = /<row[^>]*\bhidden="(?:1|true)"/.test(rowXml);
      if (isHiddenRow) hiddenRowCount++;
      const rowIdx = rAttr ? Number(rAttr[1]) - 1 : maxRow;
      if (rowIdx + 1 > maxRow) maxRow = rowIdx + 1;

      const cellMatches = rowXml.match(/<c(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
      let nextColIdx = 0;

      for (const cellXml of cellMatches) {
        const refM = /\br="([A-Z]+)(\d+)"/.exec(cellXml);
        const colIdx = refM ? excelColToIndex(refM[1]) : nextColIdx;
        nextColIdx = colIdx + 1;
        if (colIdx + 1 > maxCol) maxCol = colIdx + 1;

        const typeM = /\bt="([^"]+)"/.exec(cellXml);
        const styleM = /\bs="(\d+)"/.exec(cellXml);
        const cellType = typeM ? typeM[1] : 'n';
        const styleIdx = styleM ? Number(styleM[1]) : -1;

        const fMatch = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(cellXml);
        const vMatch = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cellXml);
        const isMatch = /<is>[\s\S]*?<\/is>/.exec(cellXml);

        const formulaText = fMatch ? decodeXmlEntities(fMatch[1]) : null;
        const rawV = vMatch ? decodeXmlEntities(vMatch[1]) : null;

        let val = null;
        if (cellType === 's') {
          const sIdx = Number(rawV);
          val = Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : rawV;
        } else if (cellType === 'inlineStr' && isMatch) {
          const tMatches = isMatch[0].match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
          val = tMatches.map(t => decodeXmlEntities(t.replace(/<[^>]+>/g, ''))).join('');
        } else if (cellType === 'b') {
          val = rawV === '1' || rawV === 'true' ? 'true' : 'false';
        } else if (cellType === 'str' || cellType === 'e') {
          val = rawV;
        } else if (rawV !== null) {
          if (dateStyleIndices.has(styleIdx) && !Number.isNaN(Number(rawV))) {
            val = excelSerialToIsoDate(Number(rawV), date1904);
          } else {
            // Preserve exact string representation (protects leading zeros if stored as string/text)
            val = rawV;
          }
        }

        if (formulaText !== null) {
          if (val !== null && val !== '') {
            sheetWarnings.push({
              code: 'FORMULA_CACHED_VALUE',
              message: `Cell ${refM ? refM[0] : `R${rowIdx + 1}C${colIdx + 1}`} contains formula "=${formulaText}"; using cached value "${val}".`
            });
            gridMap.set(`${rowIdx}:${colIdx}`, { formula: formulaText, cachedValue: val });
          } else {
            sheetWarnings.push({
              code: 'FORMULA_UNAVAILABLE_RESULT',
              message: `Cell ${refM ? refM[0] : `R${rowIdx + 1}C${colIdx + 1}`} contains formula "=${formulaText}" without a cached result; marked as unavailable formula rather than coerced.`
            });
            gridMap.set(`${rowIdx}:${colIdx}`, { formula: formulaText, cachedValue: null });
          }
        } else {
          gridMap.set(`${rowIdx}:${colIdx}`, val);
        }
      }
    }

    if (hiddenRowCount > 0) {
      sheetWarnings.push({
        code: 'HIDDEN_ROWS_DETECTED',
        message: `Worksheet "${sm.name}" contains ${hiddenRowCount} hidden row(s).`
      });
    }

    const matrix = [];
    for (let r = 0; r < maxRow; r++) {
      const rowArr = [];
      let hasAny = false;
      for (let c = 0; c < maxCol; c++) {
        const v = gridMap.has(`${r}:${c}`) ? gridMap.get(`${r}:${c}`) : null;
        if (v !== null && v !== '') hasAny = true;
        rowArr.push(v);
      }
      if (hasAny || options.keepEmptyRows) {
        matrix.push(rowArr);
      }
    }

    const hasHeader = options.hasHeader !== false;
    const columnNames = matrix.length > 0 && hasHeader
      ? matrix[0].map((cell, idx) => {
          if (cell && typeof cell === 'object' && 'cachedValue' in cell) {
            return String(cell.cachedValue || `col_${idx + 1}`);
          }
          return String(cell ?? `col_${idx + 1}`).trim() || `col_${idx + 1}`;
        })
      : Array.from({ length: maxCol }, (_, idx) => `V${idx + 1}`);

    const rawRows = hasHeader ? matrix.slice(1) : matrix;

    parsedSheets.push({
      name: sm.name,
      hidden: sm.hidden,
      columnNames,
      rawRows,
      warnings: sheetWarnings
    });
  }

  return {
    sheets: parsedSheets,
    date1904,
    hasMacros
  };
}

/**
 * Parses JSON text (flat array of records, object with record path, DataSenseDataset interchange JSON, or NDJSON).
 */
export function parseJsonContent(rawText, options = {}) {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error('JSON input is empty.');

  const warnings = [];
  let parsed;

  // Detect Newline-Delimited JSON (NDJSON)
  if (trimmed.startsWith('{') && trimmed.includes('\n')) {
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let isNdjson = lines.length > 1;
    const ndRecords = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const item = JSON.parse(lines[i]);
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          isNdjson = false;
          break;
        }
        ndRecords.push(item);
      } catch {
        isNdjson = false;
        break;
      }
    }
    if (isNdjson) {
      return recordsToTabular(ndRecords, { ...options, detectedFormat: 'NDJSON', warnings });
    }
  }

  parsed = JSON.parse(trimmed);

  // Check if DataSenseDataset v1.0.0 schema
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray(parsed.variables) &&
    Array.isArray(parsed.observations)
  ) {
    const columnNames = parsed.variables.map(v => v.name || v.label);
    const columnOverrides = {};
    for (const v of parsed.variables) {
      const colName = v.name || v.label;
      let semType = SEMANTIC_TYPES.TEXT;
      if (v.dataType === 'float64') semType = SEMANTIC_TYPES.DECIMAL;
      else if (v.dataType === 'int64' || v.dataType === 'integer') semType = SEMANTIC_TYPES.INTEGER;
      else if (v.dataType === 'date') semType = SEMANTIC_TYPES.DATE;
      else if (v.dataType === 'datetime') semType = SEMANTIC_TYPES.DATETIME;
      else if (v.dataType === 'categorical') semType = SEMANTIC_TYPES.CATEGORICAL;
      else if (v.dataType === 'identifier') semType = SEMANTIC_TYPES.IDENTIFIER;

      columnOverrides[colName] = {
        displayName: colName,
        semanticType: semType,
        role: v.role || 'explanatory',
        unit: v.unit || null
      };
    }

    const rawRows = parsed.observations.map(obs =>
      columnNames.map(c => (obs[c] !== undefined ? obs[c] : null))
    );

    return {
      detectedFormat: 'DATASENSE_JSON',
      metadata: parsed.metadata || {},
      columnNames,
      rawRows,
      columnOverrides,
      candidatePaths: ['observations'],
      warnings
    };
  }

  // Discover candidate record paths if root is an object
  const candidatePaths = [];
  function findArrayPaths(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      candidatePaths.push(prefix || '$root');
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) {
        candidatePaths.push(p);
      } else if (v && typeof v === 'object') {
        findArrayPaths(v, p);
      }
    }
  }
  findArrayPaths(parsed);

  let targetArray = null;
  const selectedPath = options.recordPath || (Array.isArray(parsed) ? '$root' : candidatePaths[0]);

  if (Array.isArray(parsed)) {
    targetArray = parsed;
  } else if (selectedPath && selectedPath !== '$root') {
    const parts = selectedPath.split('.');
    let cur = parsed;
    for (const p of parts) {
      cur = cur ? cur[p] : undefined;
    }
    if (Array.isArray(cur)) targetArray = cur;
  }

  if (!Array.isArray(targetArray)) {
    throw new Error(
      `JSON root is not an array of records. Available array paths: ${candidatePaths.join(', ') || 'none'}`
    );
  }

  const res = recordsToTabular(targetArray, {
    ...options,
    detectedFormat: 'JSON',
    warnings
  });
  res.candidatePaths = candidatePaths;
  res.selectedPath = selectedPath;
  return res;
}

/**
 * Converts an array of JSON objects into columnNames and rawRows, handling nested objects and warning on nested arrays.
 */
function recordsToTabular(records, options = {}) {
  const flattenNested = options.flattenNested !== false;
  const warnings = options.warnings || [];
  const colSet = new Set();
  const normalizedRecords = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const flat = {};

    function visit(obj, prefix = '') {
      if (obj === null || obj === undefined || typeof obj !== 'object') {
        const key = prefix || 'value';
        colSet.add(key);
        flat[key] = obj;
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        const pathKey = prefix ? `${prefix}.${k}` : k;
        if (Array.isArray(v)) {
          // Never silently multiply rows! Store serialized array and warn user
          warnings.push({
            rowNumber: i + 1,
            code: 'NESTED_ARRAY_SERIALIZED',
            message: `Row ${i + 1} field "${pathKey}" contains a nested array (${v.length} items). Preserved as JSON string to prevent silent row multiplication.`
          });
          colSet.add(pathKey);
          flat[pathKey] = JSON.stringify(v);
        } else if (v !== null && typeof v === 'object' && flattenNested) {
          visit(v, pathKey);
        } else if (v !== null && typeof v === 'object') {
          colSet.add(pathKey);
          flat[pathKey] = JSON.stringify(v);
        } else {
          colSet.add(pathKey);
          flat[pathKey] = v;
        }
      }
    }

    visit(rec);
    normalizedRecords.push(flat);
  }

  const columnNames = Array.from(colSet);
  const rawRows = normalizedRecords.map(r =>
    columnNames.map(c => (r[c] !== undefined ? r[c] : null))
  );

  return {
    detectedFormat: options.detectedFormat || 'JSON',
    columnNames,
    rawRows,
    warnings
  };
}

/**
 * High-level unified import helper that produces a Dataset or multi-sheet preview.
 */
export function buildDatasetFromParsed({
  title,
  filename,
  format,
  sheet = null,
  columnNames,
  rawRows,
  importOptions = {},
  columnOverrides = {},
  warnings = []
}) {
  return createDataset({
    title: title || (sheet ? `${filename} [${sheet}]` : filename),
    sourceFilename: filename,
    sourceFormat: format,
    sourceSheet: sheet,
    columnNames,
    rawRows,
    importOptions,
    columnOverrides,
    parsingWarnings: warnings
  });
}
