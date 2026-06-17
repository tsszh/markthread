export interface ReviewComment {
  line: number;
  lineText: string;
  comment: string;
  /**
   * Optional human-readable location reference shown instead of `Line N`
   * (e.g. a table-cell address like `Table 1 (L37), row 2, column 2 (Status)`).
   */
  locationLabel?: string;
}

export interface ReviewThread {
  file: string;
  comments: ReviewComment[];
}

/**
 * Default prefix prepended to the copied review. Must stay in sync with the
 * `markThread.copy.headerTemplate` default declared in package.json.
 */
export const STRUCTURED_HEADER = `# Review Comments

Please address the following review comments on the Markdown document below.
Each item quotes the source line it refers to.

---

`;

export interface FormatOptions {
  includeFileName: boolean;
  includeLineNumber: boolean;
  includeLineText: boolean;
  includeComment: boolean;
  headerTemplate: string;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  includeFileName: false,
  includeLineNumber: false,
  includeLineText: true,
  includeComment: true,
  headerTemplate: STRUCTURED_HEADER,
};

/** Anchors a reference to a specific table cell (zero-based row/column). */
export interface TableCellRef {
  row: number;
  col: number;
}

// A Markdown table delimiter row, e.g. `| --- | :--: |`. Used to detect where
// a table begins (the line above the delimiter is the header row).
const TABLE_DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
  let cells = line.trim();
  if (cells.startsWith('|')) {
    cells = cells.slice(1);
  }
  if (cells.endsWith('|')) {
    cells = cells.slice(0, -1);
  }
  return cells.split('|').map((cell) => cell.trim());
}

/**
 * Header-row source lines (zero-based) of every Markdown table, in document
 * order. A table is recognised by a header row immediately followed by a
 * delimiter row — matching markdown-it's `data-source-line` for the table.
 */
export function findTableHeaderLines(lines: string[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (
      lines[i].includes('|') &&
      TABLE_DELIMITER.test(lines[i + 1]) &&
      lines[i + 1].includes('-')
    ) {
      starts.push(i);
    }
  }
  return starts;
}

/**
 * Human-readable address for a table cell, e.g.
 * `Table 1 (L37), row 2, column 2 (Status)`. `tableLine` is the table's
 * header-row source line (zero-based); `cell.row` is the zero-based rendered
 * row index (header = row 0).
 */
export function describeTableCell(
  lines: string[],
  tableLine: number,
  cell: TableCellRef
): string {
  const ordinal = findTableHeaderLines(lines).indexOf(tableLine);
  const tableName = `Table ${ordinal >= 0 ? ordinal + 1 : '?'} (L${tableLine + 1})`;
  const header =
    tableLine >= 0 && tableLine < lines.length
      ? splitTableRow(lines[tableLine])[cell.col]
      : '';
  const column = `column ${cell.col + 1}${header ? ` (${header})` : ''}`;
  return `${tableName}, row ${cell.row + 1}, ${column}`;
}

export function formatStructured(
  threads: ReviewThread[],
  options?: Partial<FormatOptions>
): string {
  const opts: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };

  let header = opts.headerTemplate;
  if (header.length > 0 && !header.endsWith('\n')) {
    header += '\n\n';
  }

  if (threads.length === 0) {
    return header + '(No review comments yet.)\n';
  }

  const sections: string[] = [];

  for (const thread of threads) {
    for (const item of thread.comments) {
      const parts: string[] = [];
      if (opts.includeFileName) {
        parts.push(`file: ${thread.file}`);
      }
      if (opts.includeLineNumber) {
        parts.push(item.locationLabel ?? `Line ${item.line + 1}`);
      }
      if (opts.includeLineText) {
        parts.push(`> ${item.lineText.trim()}`);
      }
      if (opts.includeComment) {
        if (parts.length > 0) {
          parts.push('');
        }
        parts.push(item.comment);
      }
      parts.push('', '---', '');
      sections.push(parts.join('\n'));
    }
  }

  return header + sections.join('\n');
}
