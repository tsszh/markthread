// Contract between the shared preview client and whatever hosts it (a VS Code
// webview or the standalone web page). The client never talks to VS Code or
// localStorage directly; it goes through this adapter so the same UI code runs
// in both environments.

export interface PreviewSelection {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
}

export interface PreviewComment {
  author: string;
  body: string;
  /** Epoch milliseconds the comment was authored (optional for old data). */
  createdAt?: number;
  /** Review-verdict label or legacy status id (see REVIEW_STATUSES), e.g. 'fix'. */
  status?: string;
  /** Semantic colour of a custom verdict (green/red/amber/blue/neutral). */
  statusTone?: string;
}

/** Anchors a thread to a specific table cell (row/column, zero-based). */
export interface PreviewCell {
  row: number;
  col: number;
}

export interface PreviewThread {
  id: string;
  /** Zero-based source line the thread is anchored to. */
  line: number;
  /** Source text of the anchored line, recorded for context. */
  lineText: string;
  /** Present when the thread targets a specific text selection. */
  selection?: PreviewSelection;
  /** Present when the thread targets a specific table cell. */
  cell?: PreviewCell;
  comments: PreviewComment[];
  /** Whether the thread has been resolved (review inbox state). */
  resolved?: boolean;
  /** Epoch milliseconds the thread was created. */
  createdAt?: number;
}

export interface PreviewInitData {
  markdown: string;
  threads: PreviewThread[];
  quickReplies: string[];
  /** Display name applied to newly authored comments. */
  author?: string;
  /**
   * Base URL used to resolve relative resource references (e.g. images) in the
   * rendered Markdown. In the VS Code webview this is the document folder mapped
   * through `Webview.asWebviewUri`; empty/undefined in the standalone app.
   */
  resourceBase?: string;
}

export interface HostAdapter {
  /** Provides the document, existing threads, and settings. */
  init(): PreviewInitData | Promise<PreviewInitData>;
  /** Persists the full thread set after any change. */
  saveThreads(threads: PreviewThread[]): void;
  /** Asks the host to reveal a source line (VS Code only; no-op standalone). */
  revealLine(line: number): void;
  /** Subscribes to host-driven updates (document edits, external reloads). */
  onUpdate?(callback: (data: PreviewInitData) => void): void;
}
