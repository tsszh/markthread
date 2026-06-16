import * as vscode from 'vscode';
import { FormatOptions, STRUCTURED_HEADER } from './core';
import { DEFAULT_QUICK_REPLIES } from './renderer/defaults';

export { DEFAULT_QUICK_REPLIES };

export interface ReviewerSettings extends FormatOptions {
  quickReplies: string[];
}

const SECTION = 'mdAiReviewer';

export function readSettings(): ReviewerSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const quickReplies = cfg
    .get<string[]>('quickReplies', DEFAULT_QUICK_REPLIES)
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);

  return {
    quickReplies,
    includeFileName: cfg.get<boolean>('copy.includeFileName', false),
    includeLineNumber: cfg.get<boolean>('copy.includeLineNumber', false),
    includeLineText: cfg.get<boolean>('copy.includeLineText', true),
    includeComment: cfg.get<boolean>('copy.includeComment', true),
    headerTemplate: cfg.get<string>('copy.headerTemplate', STRUCTURED_HEADER),
  };
}

export async function writeSettings(
  settings: Partial<ReviewerSettings>
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const target = vscode.ConfigurationTarget.Global;

  const updates: [string, unknown][] = [];
  if (settings.quickReplies !== undefined) {
    updates.push(['quickReplies', settings.quickReplies]);
  }
  if (settings.includeFileName !== undefined) {
    updates.push(['copy.includeFileName', settings.includeFileName]);
  }
  if (settings.includeLineNumber !== undefined) {
    updates.push(['copy.includeLineNumber', settings.includeLineNumber]);
  }
  if (settings.includeLineText !== undefined) {
    updates.push(['copy.includeLineText', settings.includeLineText]);
  }
  if (settings.includeComment !== undefined) {
    updates.push(['copy.includeComment', settings.includeComment]);
  }
  if (settings.headerTemplate !== undefined) {
    updates.push(['copy.headerTemplate', settings.headerTemplate]);
  }

  for (const [key, value] of updates) {
    await cfg.update(key, value, target);
  }
}

const ALL_KEYS = [
  'quickReplies',
  'copy.includeFileName',
  'copy.includeLineNumber',
  'copy.includeLineText',
  'copy.includeComment',
  'copy.headerTemplate',
];

/** Clears every stored value so the package.json defaults apply again. */
export async function resetSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  for (const key of ALL_KEYS) {
    await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
  }
}
