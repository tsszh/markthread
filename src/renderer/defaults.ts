// Browser-safe review primitives shared by the extension settings and the
// standalone page. Kept free of `vscode` imports so it can be bundled for the
// browser.

export type StatusTone = 'green' | 'red' | 'amber' | 'blue' | 'neutral';

export interface ReviewStatus {
  /** Stable id stored on a comment. */
  id: string;
  /** Human-readable label shown on the chip. */
  label: string;
  /** Semantic colour family driving a consistent chip palette. */
  tone: StatusTone;
  /** A glyph paired WITH the label + colour (meaning never relies on it alone). */
  glyph: string;
}

// A single source of truth for the review verdicts. Each has a consistent
// colour (tone) + glyph + label so the meaning is conveyed three ways, not by
// an emoji alone. Quick-reply chips, inline status chips, and the inbox all
// read from this list.
export const REVIEW_STATUSES: ReviewStatus[] = [
  { id: 'looks-good', label: 'Looks good', tone: 'green', glyph: '✓' },
  { id: 'confirmed', label: 'Confirmed', tone: 'green', glyph: '✔' },
  { id: 'no', label: 'No', tone: 'red', glyph: '✕' },
  { id: 'clarify', label: 'Please clarify', tone: 'amber', glyph: '?' },
  { id: 'fix', label: 'Please fix', tone: 'red', glyph: '!' },
  { id: 'todo', label: 'TODO later', tone: 'blue', glyph: '⏱' },
];

export function findStatus(id: string | undefined): ReviewStatus | undefined {
  return id ? REVIEW_STATUSES.find((s) => s.id === id) : undefined;
}

// A configurable quick-reply pill (label + semantic tone). The standalone web
// app lets users edit these (persisted in localStorage); the defaults mirror
// the built-in review statuses.
export interface QuickReply {
  label: string;
  tone: StatusTone;
  glyph?: string;
}

const TONE_GLYPHS: Record<StatusTone, string> = {
  green: '✓',
  red: '✕',
  amber: '?',
  blue: '⏱',
  neutral: '•',
};

export function glyphForTone(tone: StatusTone): string {
  return TONE_GLYPHS[tone] ?? '•';
}

// Rich (label + tone) defaults used by the standalone quick-reply pills.
export const DEFAULT_QUICK_REPLIES_RICH: QuickReply[] = REVIEW_STATUSES.map(
  (s) => ({ label: s.label, tone: s.tone, glyph: s.glyph })
);

// Resolves a stored status value (either a legacy status id like "fix" or a
// free-text label) plus an optional tone into a renderable chip descriptor.
export function resolveStatus(
  status: string,
  tone?: StatusTone
): { label: string; tone: StatusTone; glyph: string } {
  const def = findStatus(status);
  if (def) {
    return { label: def.label, tone: def.tone, glyph: def.glyph };
  }
  const t: StatusTone = tone ?? 'neutral';
  return { label: status, tone: t, glyph: glyphForTone(t) };
}

// Backwards-compatible list of quick-reply labels (consumed by the extension
// settings). Derived from the status list so the two never drift.
export const DEFAULT_QUICK_REPLIES = REVIEW_STATUSES.map((s) => s.label);
