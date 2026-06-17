import * as vscode from 'vscode';

export interface StoredComment {
  author: string;
  body: string;
}

/** Optional text-selection anchor for comments created from the preview. */
export interface StoredSelection {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
}

export interface StoredThread {
  line: number;
  lineText: string;
  /** Present when the thread targets a selection rather than a whole line. */
  selection?: StoredSelection;
  comments: StoredComment[];
}

export interface StoredReview {
  version: number;
  comments: StoredThread[];
}

const SIDECAR_SUFFIX = '.markthread.json';

/** Sibling sidecar file that stores a Markdown file's review comments. */
export function sidecarUri(documentUri: vscode.Uri): vscode.Uri {
  return documentUri.with({ path: documentUri.path + SIDECAR_SUFFIX });
}

export function isSidecar(uri: vscode.Uri): boolean {
  return uri.path.endsWith(SIDECAR_SUFFIX);
}

/**
 * Markdown-family file extensions we treat as reviewable. Covers plain
 * Markdown plus skill/rule/doc variants (Cursor `.mdc`, MDX, R Markdown, etc.)
 * that editors don't always assign the `markdown` language id.
 */
const MARKDOWN_EXTENSIONS = [
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.mkdn',
  '.mdwn',
  '.mdx',
  '.mdc',
  '.qmd',
  '.rmd',
];

/** Whether a path ends with a recognised Markdown-family extension. */
export function hasMarkdownExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Whether a document is a Markdown file we review. Recognises any
 * Markdown-family file by language id OR extension (so skill files like
 * `SKILL.md` and Cursor `.mdc` rules count, even when the editor labels them
 * with a non-`markdown` language id). Includes unsaved (`untitled`) documents;
 * excludes the comment input box (scheme `comment`) and our own sidecar files.
 */
export function isReviewableMarkdownDocument(
  document: vscode.TextDocument
): boolean {
  if (
    document.uri.scheme !== 'file' &&
    document.uri.scheme !== 'untitled'
  ) {
    return false;
  }
  if (isSidecar(document.uri)) {
    return false;
  }
  return (
    document.languageId === 'markdown' ||
    hasMarkdownExtension(document.uri.path)
  );
}

function normalizeSelection(value: Partial<StoredSelection>): StoredSelection {
  return {
    startLine: Number(value.startLine) || 0,
    startChar: Number(value.startChar) || 0,
    endLine: Number(value.endLine) || 0,
    endChar: Number(value.endChar) || 0,
    text: String(value.text ?? ''),
  };
}

export function serializeReview(review: StoredReview): string {
  return JSON.stringify(review, null, 2) + '\n';
}

export function parseReview(json: string): StoredReview | undefined {
  try {
    const data = JSON.parse(json) as Partial<StoredReview>;
    if (!data || !Array.isArray(data.comments)) {
      return undefined;
    }
    return {
      version: typeof data.version === 'number' ? data.version : 1,
      comments: data.comments
        .filter(
          (thread): thread is StoredThread =>
            !!thread && Array.isArray(thread.comments)
        )
        .map((thread) => ({
          line: Number(thread.line) || 0,
          lineText: String(thread.lineText ?? ''),
          ...(thread.selection
            ? { selection: normalizeSelection(thread.selection) }
            : {}),
          comments: thread.comments
            .filter((c) => !!c && typeof c.body === 'string')
            .map((c) => ({
              author: String(c.author ?? 'Reviewer'),
              body: String(c.body),
            })),
        })),
    };
  } catch {
    return undefined;
  }
}

export async function readReview(
  documentUri: vscode.Uri
): Promise<StoredReview | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(sidecarUri(documentUri));
    return parseReview(Buffer.from(bytes).toString('utf8'));
  } catch {
    return undefined;
  }
}

export async function writeReview(
  documentUri: vscode.Uri,
  review: StoredReview
): Promise<void> {
  const bytes = Buffer.from(serializeReview(review), 'utf8');
  await vscode.workspace.fs.writeFile(sidecarUri(documentUri), bytes);
}

export async function deleteReview(documentUri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(sidecarUri(documentUri));
  } catch {
    // Sidecar may not exist; ignore.
  }
}
