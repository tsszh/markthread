import * as vscode from 'vscode';
import { FormatOptions, STRUCTURED_HEADER } from './core';
import { DEFAULT_QUICK_REPLIES } from './renderer/defaults';

export { DEFAULT_QUICK_REPLIES };

export interface ReviewerSettings extends FormatOptions {
  quickReplies: string[];
}

const SECTION = 'markThread';

export type UiLang = 'en' | 'zh';
export type UiTheme = 'light' | 'dark';

/** Resolved appearance preferences sent to the preview webview. */
export interface UiPrefs {
  lang: UiLang;
  theme: UiTheme;
  accent: string;
}

const ACCENTS = ['oxblood', 'ink', 'pine', 'terracotta', 'petrol'];

/** Raw (unresolved) appearance settings, as stored — used to populate the
 *  side-panel settings form (shows `auto`/`system` rather than the resolved
 *  value). */
export interface AppearancePrefs {
  language: string;
  theme: string;
  accent: string;
}

export function readAppearancePrefs(): AppearancePrefs {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    language: cfg.get<string>('appearance.language', 'auto'),
    theme: cfg.get<string>('appearance.theme', 'system'),
    accent: cfg.get<string>('appearance.accent', 'oxblood'),
  };
}

export async function writeAppearance(
  prefs: Partial<AppearancePrefs>
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const target = vscode.ConfigurationTarget.Global;
  if (prefs.language !== undefined) {
    await cfg.update('appearance.language', prefs.language, target);
  }
  if (prefs.theme !== undefined) {
    await cfg.update('appearance.theme', prefs.theme, target);
  }
  if (prefs.accent !== undefined) {
    await cfg.update('appearance.accent', prefs.accent, target);
  }
}

/**
 * Resolves the user's appearance settings into concrete values for the webview:
 * `auto` language follows VS Code's display language, and `system` theme follows
 * the active color theme (re-resolve whenever either changes).
 */
export function resolveUiPrefs(): UiPrefs {
  const cfg = vscode.workspace.getConfiguration(SECTION);

  const langPref = cfg.get<string>('appearance.language', 'auto');
  const lang: UiLang =
    langPref === 'en' || langPref === 'zh'
      ? langPref
      : /^zh/i.test(vscode.env.language)
        ? 'zh'
        : 'en';

  const themePref = cfg.get<string>('appearance.theme', 'system');
  const kind = vscode.window.activeColorTheme.kind;
  const systemDark =
    kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast;
  const theme: UiTheme =
    themePref === 'light' || themePref === 'dark'
      ? themePref
      : systemDark
        ? 'dark'
        : 'light';

  const accentPref = cfg.get<string>('appearance.accent', 'oxblood');
  const accent = ACCENTS.includes(accentPref) ? accentPref : 'oxblood';

  return { lang, theme, accent };
}

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
  'appearance.language',
  'appearance.theme',
  'appearance.accent',
];

/** Clears every stored value so the package.json defaults apply again. */
export async function resetSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  for (const key of ALL_KEYS) {
    await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
  }
}
