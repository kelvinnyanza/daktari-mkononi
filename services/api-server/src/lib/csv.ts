/**
 * Minimal RFC 4180 CSV reading/writing for finance exports and statement
 * imports. No dependency: quoted fields, escaped quotes, CRLF/LF, BOM.
 */

/** Parse CSV text into rows of cells (quoted fields may contain commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/**
 * One CSV cell. Text that a spreadsheet would execute as a formula
 * (=, +, -, @, tab, CR at the start) is prefixed with ' — CSV injection —
 * while real numbers (including negative amounts) stay numbers.
 */
export function csvCell(value: string | number | boolean | null | undefined | Date): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text = value instanceof Date ? value.toISOString() : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: Array<string | number | boolean | null | undefined | Date>): string {
  return cells.map(csvCell).join(',');
}
