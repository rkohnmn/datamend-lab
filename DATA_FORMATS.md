# DataMend Lab — Supported Data & Interchange Formats (`DATA_FORMATS.md`)

## 1. Import Formats (`js/parsers.js`)

- **CSV & TSV**: RFC 4180 compliant with overrides for delimiter (`,`, `\t`, `;`, `|`), decimal separator (`.` vs `,`), header presence, and UTF-8 BOM stripping. Malformed rows with extra fields expand the column schema rather than silently dropping data.
- **Excel Workbooks (`.xlsx`)**: Pure-JS ZIP/DEFLATE + OpenXML parser supporting multi-sheet selection, `sharedStrings.xml`, inline strings, Excel 1900/1904 serial dates, merged cell warnings, hidden row/sheet flags, and literal vs. cached formula value separation. VBA macros (`vbaProject.bin`) are strictly ignored.
- **JSON & NDJSON**: Supports flat arrays of objects, nested objects with selectable record paths, controlled flattening (serializing nested arrays with a warning rather than silently multiplying rows), and Newline-Delimited JSON streams.
- **DataSense Interchange JSON (`DataSenseDataset` v1.0.0)**: Preserves variable roles, physical units, semantic types, and `is_imputed` cell flags across DataSense Studio applications.

## 2. Export Formats (`js/exporters.js`)

- **RFC 4180 CSV & TSV**: Configurable missing-value tokens and automatic CSV formula-injection sanitization.
- **Excel Workbook (`.xlsx`)**: Generates a valid OpenXML `.xlsx` archive preserving numeric (`t="n"`), boolean (`t="b"`), and string/identifier (`t="inlineStr"`) types.
- **JSON, NDJSON & `DataSenseDataset` v1.0.0 JSON**.
- **Reproducible R (`tidyverse`) & Python (`pandas`) Scripts**.
- **Markdown Data-Quality & Provenance Audit Report**.
