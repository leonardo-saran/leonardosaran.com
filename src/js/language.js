/**
 * Language Module - dynamic English + configured-code toggle.
 * Language pair = 'en' + the configured lang.code from settings (e.g. pt, de).
 * Pair and UI translations come from the settings module.
 * Persists to localStorage.
 * Static data-i18n labels rendered via renderStaticLabels.
 */

import {
  loadSettings,
  getLanguageConfig,
  getSite,
  getTranslation,
  getTranslations,
  EN_TRANSLATIONS,
} from './settings.js';
import { isSafeHrefValue } from './security.js';
import { safeGetItem, safeSetItem } from './storage.js';

const LANG_KEY = 'lang';

/**
 * Identity keys resolve from the settings site.* block FIRST in both
 * languages: editing site.name in settings.txt updates the visible About h1
 * without regenerating the site. Only 'about.name' stays an identity key :
 * a proper name does not translate; 'footer.copyright' is language-aware
 * instead (see resolveCopyrightValue). Values map translation keys to their
 * site.* settings key; a missing or empty settings value falls back to the
 * per-language resolution.
 */
const IDENTITY_KEYS = {
  'about.name': 'name',
};

/**
 * Resolve an identity key from settings site.* values.
 * @param {string} key - Translation key
 * @returns {string|null} Settings value, or null when key is not identity
 */
function resolveIdentityValue(key) {
  const siteKey = IDENTITY_KEYS[key];
  if (!siteKey) return null;
  const value = getSite()[siteKey];
  return value != null ? value : null;
}

/**
 * Language-aware copyright resolution.
 * The second-language translation wins when the second language is active
 * AND the settings value is present and non-empty; otherwise the
 * author-editable site.copyright is used in both languages (English active
 * or untranslated second language); both absent or empty → the embedded EN
 * default - never blank, never the raw key.
 * The {year} token expands to the current year in the RESOLVED value
 * whatever its source: second-language translation, site.copyright, or
 * the embedded EN default: mirroring the generator contract:
 * /\{year\}/g → String(new Date().getFullYear()). The expansion yields
 * pure digits, never markup; a value without the token is returned
 * verbatim (authored fixed-year choices preserved).
 * @returns {string} Resolved copyright
 */
function resolveCopyrightValue() {
  let value = null;
  if (getLanguage() === getSecondLanguageCode()) {
    const translation = getTranslations()['footer.copyright'];
    if (typeof translation === 'string' && translation !== '') value = translation;
  }
  if (value == null) {
    const siteValue = getSite().copyright;
    if (typeof siteValue === 'string' && siteValue !== '') value = siteValue;
  }
  if (value == null) value = EN_TRANSLATIONS['footer.copyright'];
  return value.replace(/\{year\}/g, String(new Date().getFullYear()));
}

/**
 * Shared special-key resolution used by BOTH t() and resolveStaticLabel().
 * - 'about.name' stays an identity key: site.name in both languages.
 * - 'footer.copyright' is language-aware (see resolveCopyrightValue).
 * Any other key → null: the plain translation flow applies unchanged.
 * @param {string} key - Translation key
 * @returns {string|null} Resolved value, or null for the plain flow
 */
function resolveSpecialValue(key) {
  if (key === 'about.name') return resolveIdentityValue(key);
  if (key === 'footer.copyright') return resolveCopyrightValue();
  return null;
}

/**
 * A language code is only trusted when it matches /^[a-z]{2,3}$/.
 * Anything else (path traversal, quotes, uppercase, overlong) is discarded
 * before any selector, path, or attribute usage.
 * @param {*} code - lang.code from settings
 * @returns {boolean} true when the code is safe to use
 */
function isValidLanguageCode(code) {
  return typeof code === 'string' && /^[a-z]{2,3}$/.test(code);
}

/**
 * Configured second-language code, or null when monolingual
 * (settings absent, lang.enabled = false, or invalid lang.code).
 * @returns {string|null} Configured second-language code
 */
export function getSecondLanguageCode() {
  const config = getLanguageConfig();
  if (!config.enabled) return null;
  return isValidLanguageCode(config.code) ? config.code : null;
}

/**
 * Normalize a requested language against the configured pair.
 * Only 'en' and the configured second code are accepted; anything else :
 * including unconfigured localStorage injection: falls back to 'en'.
 * @param {string} lang - Requested language
 * @returns {string} Validated language ('en' or the configured code)
 */
export function getValidatedLanguage(lang) {
  if (lang === 'en') return 'en';
  return lang === getSecondLanguageCode() ? lang : 'en';
}

/**
 * Get current language
 * @returns {string} Current language ('en' or the configured second code)
 */
export function getLanguage() {
  return document.documentElement.getAttribute('data-lang') || 'en';
}

/**
 * Detect the preferred language from browser preferences.
 * Iterates navigator.languages in user-preference order (falling back to
 * [navigator.language] when the array is absent); the FIRST entry whose
 * primary subtag ("pt-BR" → "pt", lowercased, validated /^[a-z]{2,3}$/)
 * equals 'en' or the configured second-language code wins. No match → 'en'.
 * TDS: hostile codes are discarded by the subtag validation; the final
 * result is re-validated through getValidatedLanguage() before use.
 * @returns {string} Detected language ('en' or the configured second code)
 */
export function detectBrowserLanguage() {
  const preferences =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

  const second = getSecondLanguageCode();
  for (const entry of preferences) {
    if (typeof entry !== 'string') continue;
    const subtag = entry.split('-')[0].toLowerCase();
    if (!/^[a-z]{2,3}$/.test(subtag)) continue;
    if (subtag === 'en' || (second && subtag === second)) {
      return getValidatedLanguage(subtag);
    }
  }
  return 'en';
}

/**
 * Whether the visitor has an explicit stored language choice.
 * A stored choice freezes browser-language reactivity: automatic changes
 * (languagechange) are ignored while one exists.
 * @returns {boolean} true when localStorage holds a non-null 'lang' entry
 */
export function hasStoredLanguage() {
  return safeGetItem(LANG_KEY) != null;
}

/**
 * Set language
 * @param {string} lang - 'en' or the configured lang.code
 * @param {Object} options - Options
 * @param {boolean} options.persist - When false, apply the language without
 *   writing localStorage (auto-detected values never persist)
 * @returns {string} The validated language actually applied
 *
 * NOTE: this function only refreshes the STATIC labels and
 * social links (renderStaticLabels + syncSocialLinks): it does NOT re-render
 * the active section's dynamic content (listings, post body, no-results).
 * The caller MUST invoke rerenderActiveSection() after setLanguage() so the
 * active route re-fetches and re-renders in the new language.
 */
export function setLanguage(lang, { persist = true } = {}) {
  const validated = getValidatedLanguage(lang);

  document.documentElement.setAttribute('data-lang', validated);
  document.documentElement.lang = validated;
  if (persist) safeSetItem(LANG_KEY, validated);

  syncToggleFlashLabels();
  renderStaticLabels();
  syncSocialLinks();
  return validated;
}

/**
 * Initialize language: async: loads settings first, then resolves the
 * active language. An explicit stored choice is re-validated against the
 * configured pair and persisted (normalized, as before). Without a stored
 * choice (first access), the browser preference is detected: English as
 * the universal fallback - and applied WITHOUT persisting.
 * Hides the toggle when monolingual.
 */
export async function initLanguage() {
  await loadSettings();

  syncSocialLinks();
  syncLanguageToggleVisibility();

  const stored = safeGetItem(LANG_KEY);
  if (stored != null) {
    setLanguage(getValidatedLanguage(stored));
  } else {
    setLanguage(detectBrowserLanguage(), { persist: false });
  }
}

/**
 * Translation helper: settings-driven resolution.
 * - 'about.name' (identity): settings site.name value first, in both
 *   languages
 * - 'footer.copyright' (language-aware): second-language translation when
 *   active and non-empty → site.copyright → embedded EN
 * - second language active: settings override → embedded EN → raw key
 * - English active: embedded EN dictionary → raw key
 * @param {string} key - Translation key
 * @returns {string} Translated string
 */
export function t(key) {
  const specialValue = resolveSpecialValue(key);
  if (specialValue != null) return specialValue;
  // footer.copyright never falls into the settings branch: when the special
  // resolver found neither a translation nor site.copyright, the embedded
  // EN default is final: empty settings values stay inert, never blank.
  if (key !== 'footer.copyright' && getLanguage() === getSecondLanguageCode()) {
    return getTranslation(key);
  }
  return EN_TRANSLATIONS[key] ?? key;
}

/**
 * Hide the language toggle button entirely when monolingual (settings file
 * absent or lang.enabled = false); restore visibility when bilingual.
 */
export function syncLanguageToggleVisibility() {
  const btn = document.getElementById('lang-toggle-btn');
  if (!btn) return;
  // Visibility via class: no inline style under style-src 'self'
  // (the class pattern keeps the CSP strict; style-src does not police
  // element.style mutations, so inline style mutation is avoided by
  // convention).
  btn.classList.toggle('ctrl-icon-lang--hidden', !getSecondLanguageCode());
}

/**
 * Keep the static globe-flash spans in sync with settings.
 * ALWAYS two-letter uppercase codes: second-language span shows
 * lang.code.toUpperCase() (e.g. "PT", "DE"), en span shows "EN".
 * lang.label is informational metadata only: never displayed.
 */
function syncToggleFlashLabels() {
  const secondText = document.querySelector('.lang-text-second');
  if (secondText) {
    secondText.textContent = getSecondLanguageCode()
      ? getSecondLanguageCode().toUpperCase()
      : '';
  }
  const enText = document.querySelector('.lang-text-en');
  if (enText) enText.textContent = 'EN';
}

/**
 * Resolve the label value for a data-i18n key against the active language.
 * - 'about.name' (identity): settings site.name value first, in both
 *   languages
 * - 'footer.copyright' (language-aware): second-language translation when
 *   active and non-empty → site.copyright → embedded EN
 * - English active: embedded English dictionary.
 * - Second language active: settings override, else embedded English.
 * - Key missing from both: null → caller keeps the static English text
 *   (unknown key never blanks or injects).
 * @param {string} key - Translation key
 * @returns {string|null} Resolved label, or null when unknown
 */
function resolveStaticLabel(key) {
  const specialValue = resolveSpecialValue(key);
  if (specialValue != null) return specialValue;
  // footer.copyright never falls into the settings branch: when the special
  // resolver found neither a translation nor site.copyright, the embedded
  // EN default is final: empty settings values stay inert, never blank.
  if (key !== 'footer.copyright' && getLanguage() === getSecondLanguageCode()) {
    const settingsValue = getTranslations()[key];
    if (settingsValue != null) return settingsValue;
  }
  return EN_TRANSLATIONS[key] ?? null;
}

/**
 * Render every [data-i18n] element to match the active language.
 * Called on init and on every language change. Deterministic: when English
 * is active the DOM is always re-synced from the embedded English
 * dictionary; when the second language is active, settings translations
 * are applied (with English fallback). Unknown keys keep their static
 * English text.
 * Also processes attribute labels:
 * - [data-i18n-placeholder] → element.placeholder
 * - [data-i18n-aria-label]  → aria-label attribute
 * - [data-i18n-title]       → title attribute
 * Values are assigned via textContent / element property / setAttribute
 * ONLY: settings values are never parsed as HTML, so payloads in
 * settings.txt stay inert.
 */
export function renderStaticLabels() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const value = resolveStaticLabel(key);
    if (value != null) el.textContent = value;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    const value = resolveStaticLabel(key);
    if (value != null) el.placeholder = value;
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (!key) return;
    const value = resolveStaticLabel(key);
    if (value != null) el.setAttribute('aria-label', value);
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    const value = resolveStaticLabel(key);
    if (value != null) el.setAttribute('title', value);
  });
}

/**
 * Email values must look like an email: contain '@', no whitespace, and
 * pass the protocol guard (blocks javascript: smuggling via @).
 * @param {*} value - Settings value
 * @returns {boolean} true when the value may become a mailto href
 */
function isEmailValue(value) {
  if (typeof value !== 'string') return false;
  if (!value.includes('@') || /\s/.test(value)) return false;
  return isSafeHrefValue(value);
}

/**
 * Social anchor rules: each data-social kind maps to its settings site.*
 * key, a base URL, a network domain, and a validation guard. Values may
 * be a bare handle ("my-handle"), a scheme-less network-domain value
 * ("github.com/my-handle": normalized to the base), or a full profile
 * URL ("https://github.com/my-handle": kept verbatim). Kinds and domains
 * are hardcoded: never derived from settings - so the selector below
 * cannot be injected.
 */
const SOCIAL_LINK_RULES = {
  github: { siteKey: 'github', base: 'https://github.com/', domain: 'github.com', isValid: isSafeHrefValue },
  linkedin: { siteKey: 'linkedin', base: 'https://linkedin.com/in/', domain: 'linkedin.com', isValid: isSafeHrefValue },
  email: { siteKey: 'email', base: 'mailto:', isValid: isEmailValue },
  x: { siteKey: 'x', base: 'https://x.com/', domain: 'x.com', isValid: isSafeHrefValue },
  youtube: { siteKey: 'youtube', base: 'https://www.youtube.com/@', domain: 'youtube.com', isValid: isSafeHrefValue },
  instagram: { siteKey: 'instagram', base: 'https://instagram.com/', domain: 'instagram.com', isValid: isSafeHrefValue },
};

/**
 * Build the href for a network value, or null when invalid. Three forms:
 *  1. value with an explicit http(s) scheme → verbatim (any domain);
 *  2. scheme-less value starting with the network domain (optional www.,
 *     case-insensitive) → normalized to the canonical base + remainder;
 *  3. any other scheme-less value → handle → base + value.
 * Email is always mailto: + value. TDS: validated via isSafeHrefValue, so
 * hostile values (javascript:, data:, vbscript:, newline-scheme bypasses)
 * return null and never reach an href.
 * @param {string} kind - Network kind (a SOCIAL_LINK_RULES key)
 * @param {*} value - Settings value
 * @returns {string|null} Built href, or null when invalid
 */
function buildSocialHref(kind, value) {
  const rule = SOCIAL_LINK_RULES[kind];
  if (!rule.isValid(value)) return null;
  if (rule.siteKey === 'email') return rule.base + value;
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = normalizeNetworkValue(value, rule);
  if (normalized !== null) return normalized;
  return rule.base + value;
}

/**
 * Normalize a scheme-less value that starts with the network domain.
 * An optional "www." prefix is dropped; the domain must end at a '/'
 * boundary so lookalikes ("github.comm/...") stay plain handles. The
 * canonical base is prefixed to the remainder, and a remainder that
 * repeats the base's own path segment ("/@" for YouTube, "/in/" for
 * LinkedIn) is not duplicated. Returns null when the value does not
 * start with the network domain.
 * @param {string} value - Scheme-less settings value
 * @param {object} rule - A SOCIAL_LINK_RULES entry
 * @returns {string|null} Normalized href, or null when no domain match
 */
function normalizeNetworkValue(value, rule) {
  if (typeof rule.domain !== 'string') return null;
  const rest = value.replace(/^www\./i, '');
  const domain = rule.domain.toLowerCase();
  if (!rest.toLowerCase().startsWith(domain)) return null;
  if (rest.length > domain.length && rest.charAt(domain.length) !== '/') return null;
  const basePath = basePathAfterHost(rule.base);
  let remainder = rest.slice(domain.length);
  if (basePath !== '' && remainder.startsWith(basePath)) {
    remainder = remainder.slice(basePath.length);
  } else if (remainder.startsWith('/')) {
    remainder = remainder.slice(1);
  }
  return rule.base + remainder;
}

/**
 * The path segment of a base URL that follows its host, including the
 * leading slash: "/in/" for https://linkedin.com/in/, "/@" for
 * https://www.youtube.com/@, "/" for https://github.com/.
 * @param {string} base - Canonical network base URL
 * @returns {string} Path after the host, including the leading slash
 */
function basePathAfterHost(base) {
  const schemeEnd = base.indexOf('://') + 3;
  const hostEnd = base.indexOf('/', schemeEnd);
  if (hostEnd === -1) return '';
  return base.slice(hostEnd);
}

/**
 * Whether a network is enabled. The flag is authoritative: only an
 * explicit `false` (case-insensitive) hides the network; an absent flag
 * keeps it visible: backward compatible with forks that predate the
 * enabled flags.
 * @param {string} kind - Network kind
 * @returns {boolean} true when the network may be shown
 */
function isNetworkEnabled(kind) {
  const flag = getSite()[`${kind}.enabled`];
  return typeof flag !== 'string' || flag.toLowerCase() !== 'false';
}

/**
 * Sync footer social anchors from settings: six networks, each gated by
 * its enabled flag and its validated value. Enabled + valid → href set
 * (property assignment, never innerHTML) and the footer-social--hidden
 * class removed (shown); disabled or invalid/empty value → class added
 * (hidden). The class is the static markup default for the three optional
 * networks (no broken-icon flash before the sync runs, hidden without
 * JS); the default three networks carry no hidden class in the markup :
 * visible by default. The `hidden` attribute would be overridden by
 * .footer-social { display: flex }; the class rule
 * `.footer-social--hidden { display: none; }` lives in the stylesheet, so
 * no CSSOM style assignment is needed (CSP style-src 'self' intact).
 * TDS: script-executing protocols are rejected before they reach an href.
 * Called on init and on every language change.
 */
export function syncSocialLinks() {
  for (const [kind, rule] of Object.entries(SOCIAL_LINK_RULES)) {
    const anchor = document.querySelector(`[data-social="${kind}"]`);
    if (!anchor) continue;
    const href = buildSocialHref(kind, getSite()[rule.siteKey]);
    if (isNetworkEnabled(kind) && href !== null) {
      anchor.href = href;
      anchor.classList.remove('footer-social--hidden');
    } else {
      anchor.classList.add('footer-social--hidden');
    }
  }
}
