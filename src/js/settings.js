/**
 * Settings Module - fetch and parse src/content/settings.txt
 * Format: `key = value` lines, `#` whole-line comments, blank lines ignored.
 * Inline comments: `key = value # note`: everything from the first ` #`
 * onward is stripped; `#` without a leading space stays literal.
 * The dynamic blank `post.title` may use `post.title = # Post title`;
 * its annotation is stripped and its parsed value remains empty.
 * Malformed lines (no `=`) are skipped, never throw.
 */

import { getAppBase } from './base.js';

const SETTINGS_PATH = 'src/content/settings.txt';

/**
 * Embedded English dictionary: fallback for any missing translation key.
 * Mirrors the `en` dictionary in language.js.
 */
export const EN_TRANSLATIONS = Object.freeze({
  'nav.about': 'About',
  'nav.archive': 'Archive',
  'nav.portfolio': 'Portfolio',
  'common.search': 'Search...',
  'common.orderBy': 'Order by',
  'common.newest': 'Newest',
  'common.oldest': 'Oldest',
  'common.az': 'A-Z',
  'common.za': 'Z-A',
  'common.noResults': 'No posts found matching your search.',
  'common.noPortfolioResults': 'No portfolio items found matching your search.',
  'common.loading': 'Loading...',
  'common.skipToContent': 'Skip to content',
  // 'common.page' is a static template: the page number is interpolated
  // at render ({n} → number)
  'common.prevPage': 'Previous page',
  'common.nextPage': 'Next page',
  'common.page': 'Page {n}',
  'common.copyCode': 'Copy code',
  'common.toggleTheme': 'Toggle theme',
  'common.toggleLanguage': 'Toggle language',
  // Current-language announcement on the toggle button; {label} is
  // replaced at runtime with the active language name
  'common.langToggleCurrent': 'Toggle language - current: {label}',
  // Sort-button aria-labels (static English defaults)
  'common.sortPosts': 'Sort posts',
  'common.sortPortfolio': 'Sort portfolio',
  'breadcrumb.archive': 'Archive',
  'breadcrumb.portfolio': 'Portfolio',
  'breadcrumb.post': 'Post',
  'breadcrumb.notFound': 'Not Found',
  // Blank by default: an empty string occupies no visual line
  'post.title': '',
  'post.back': 'Back',
  'post.readMore': 'Read more',
  'post.tags': 'Tags',
  'post.notFound.body': "The post you're looking for doesn't exist or has been removed.",
  // Honest message when the post exists only in the other language;
  // the runtime replaces {label} with lang.label (uppercase code fallback)
  'post.notFound.unavailable': 'This post is not available in {label} yet.',
  // Page not-found state (unknown routes AND posts missing in every
  // language): dedicated SPA section: title for the document title, body
  // for the line
  'page.notFound.title': 'Page not found',
  'page.notFound.body': 'The page you are looking for does not exist.',
  'about.name': 'Your Name',
  'tag.prompt': 'Type a tag to filter posts.',
  'loading.posts': 'Loading posts...',
  'loading.projects': 'Loading projects...',
  'error.posts': 'Failed to load posts.',
  'error.projects': 'Failed to load projects.',
  'empty.posts': 'No posts yet.',
  'empty.projects': 'No projects yet.',
  // {year} expands to the current year when the footer renders
  'footer.copyright': '© {year} Your Name - All rights reserved.',
});

/**
 * Default state: monolingual English, no site overrides, empty translations.
 * @returns {Object} Fresh default settings state
 */
function defaultState() {
  return {
    site: {},
    language: { enabled: false, code: 'en', label: '' },
    translations: {},
  };
}

let cache = null;

/**
 * Parse settings.txt text into a flat list of [key, value] pairs.
 * Skips blank lines, `#` comments, and malformed lines without `=`.
 * Values are split at the FIRST `=`, trimmed, then cut at the FIRST
 * ` #` occurrence (inline comment). The dynamic blank `post.title`
 * annotation is recognized before trimming. A `#` without a leading
 * space stays part of the value (e.g. `post.title = #1`).
 * Deliberate bounded duplication: the generator mirrors this parser in
 * scripts/generate-site.js (parseSettings) - zero-build trade-off, parity
 * contract-tested, keep both in sync.
 * @param {string} text - Raw settings file content
 * @returns {Array<[string, string]>} Parsed key/value pairs
 */
function parseEntries(text) {
  const entries = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1);
    const value = rawValue.trim();
    const isBlankPostTitleAnnotation =
      key === 'post.title' && /^\s+#(?:\s|$)/.test(rawValue);
    const inlineCommentIndex = value.indexOf(' #');
    const cleanValue = isBlankPostTitleAnnotation
      ? ''
      : inlineCommentIndex === -1
        ? value
        : value.slice(0, inlineCommentIndex).trim();
    if (key === '') continue;

    entries.push([key, cleanValue]);
  }
  return entries;
}

/**
 * Normalize a raw lang.code value from settings.txt.
 * trim → lowercase → primary subtag (split on '-' or '_') → validate
 * /^[a-z]{2,3}$/. Valid → normalized code; invalid (e.g. 'english',
 * empty, digits, path traversal) → null so the caller treats it as
 * unset: the monolingual fallback is preserved, never guessed.
 * @param {*} value - Raw lang.code value
 * @returns {string|null} Normalized code, or null when not a code
 */
function normalizeLanguageCode(value) {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/**
 * Classify parsed entries into the typed settings state.
 * @param {Array<[string, string]>} entries - Parsed key/value pairs
 * @returns {Object} Settings state
 */
function buildState(entries) {
  const state = defaultState();
  let codeDeclared = false;

  for (const [key, value] of entries) {
    if (key.startsWith('site.')) {
      state.site[key.slice('site.'.length)] = value;
    } else if (key === 'lang.enabled') {
      state.language.enabled = value.toLowerCase() === 'true';
    } else if (key === 'lang.code') {
      // Single choke point for lang.code: normalized before it enters the
      // cache, so getLanguageConfig()/getSecondLanguageCode() only ever see
      // a lowercase /^[a-z]{2,3}$/ code or null (monolingual).
      codeDeclared = true;
      state.language.code = normalizeLanguageCode(value);
    } else if (key === 'lang.label') {
      state.language.label = value;
    } else {
      // UI translation keys and any opaque unknown key: stored as inert strings, never executed
      state.translations[key] = value;
    }
  }

  // Incomplete language config guard: lang.enabled = true without a declared
  // lang.code leaves the default 'en' as the code: the toggle would cycle
  // EN→EN (silent no-op). The second language requires a declared code;
  // without one, bilingual mode is disabled (monolingual fallback).
  // defaultState keeps the runtime 'en' default for all other consumers.
  if (state.language.enabled && (!codeDeclared || !state.language.code)) {
    state.language.enabled = false;
  }

  return state;
}

/**
 * Fetch and parse src/content/settings.txt.
 * Absent file (404) or network error yields monolingual English defaults;
 * raw fetch errors are normalized, never thrown to consumers.
 * Result is cached; use resetSettings() to force a refetch.
 * @returns {Promise<Object>} Settings state
 */
export async function loadSettings() {
  if (cache) return cache;

  let text = null;
  try {
    const response = await fetch(getAppBase() + SETTINGS_PATH);
    if (response.ok) text = await response.text();
  } catch {
    // Normalize network errors to defaults: never leak raw fetch errors
  }

  cache = text == null ? defaultState() : buildState(parseEntries(text));
  return cache;
}

/**
 * Clear the cached settings state (used by tests and hot reload).
 */
export function resetSettings() {
  cache = null;
}

/**
 * Get site identity overrides (site.* keys, prefix stripped).
 * @returns {Object} Site identity map
 */
export function getSite() {
  return cache?.site ?? {};
}

/**
 * Get language configuration ({ enabled, code, label }).
 * @returns {Object} Language config
 */
export function getLanguageConfig() {
  return cache?.language ?? { enabled: false, code: 'en', label: '' };
}

/**
 * Get UI translations overrides from the settings file.
 * @returns {Object} Translation map
 */
export function getTranslations() {
  return cache?.translations ?? {};
}

/**
 * Whether the second language is enabled (lang.enabled = true).
 * @returns {boolean} true when bilingual mode is on
 */
export function isBilingual() {
  return getLanguageConfig().enabled;
}

/**
 * Resolve a translation key: settings override → embedded English → raw key.
 * @param {string} key - Translation key
 * @returns {string} Resolved translation
 */
export function getTranslation(key) {
  const settingsValue = getTranslations()[key];
  if (settingsValue != null) return settingsValue;
  return EN_TRANSLATIONS[key] ?? key;
}
