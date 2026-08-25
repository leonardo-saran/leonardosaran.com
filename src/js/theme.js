/**
 * Theme Module - Light/dark mode toggle
 * Persists to localStorage; follows the system preference live
 */

import { safeGetItem, safeSetItem } from './storage.js';

const THEME_KEY = 'theme';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

// Browser chrome colors: must mirror the CSS --color-bg tokens
// (light #f5f5f5, dark #1a1a1a). Used to pin the two static `meta theme-color`
// elements to the APPLIED theme when a stored/manual choice exists: the
// static metas alone only follow the OS via their media query.
const THEME_COLORS = { light: '#f5f5f5', dark: '#1a1a1a' };

// Buttons whose icons are driven by data-theme (see .ctrl-icon-theme[data-theme="dark"])
const THEME_BUTTON_IDS = ['theme-toggle-btn'];

// Module-level system-theme state: keeps a single reference to
// the media query object and guards against duplicate listener registration
// when initTheme() is called more than once (defensive).
let systemThemeQuery = null;

/**
 * Initialize theme:
 * - stored theme exists → apply it persisted (an explicit choice freezes
 *   system reactivity; OS changes are ignored from then on)
 * - no stored theme → follow prefers-color-scheme live: the initial value
 *   is applied WITHOUT persisting and a 'change' listener re-applies the
 *   preference automatically on OS switches
 * Sets data-theme attribute on <html> element.
 */
export function initTheme() {
  const storedTheme = safeGetItem(THEME_KEY);

  if (storedTheme) {
    setTheme(storedTheme);
    return;
  }

  if (!systemThemeQuery) {
    systemThemeQuery = window.matchMedia(DARK_SCHEME_QUERY);
    systemThemeQuery.addEventListener('change', onSystemThemeChange);
  }
  setTheme(systemThemeQuery.matches ? 'dark' : 'light', { persist: false });
}

/**
 * System theme change handler: re-applies the OS preference
 * without persisting. Ignored while a stored theme exists: the explicit
 * choice freezes reactivity.
 * @param {MediaQueryListEvent} event - The media query change event
 */
function onSystemThemeChange(event) {
  if (safeGetItem(THEME_KEY) != null) return;
  setTheme(event.matches ? 'dark' : 'light', { persist: false });
}

/**
 * Toggle between light and dark themes. Explicit user action: always
 * persists to localStorage.
 * @returns {string} New theme value
 */
export function toggleTheme() {
  const currentTheme = getTheme();
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
  return newTheme;
}

/**
 * Get current theme
 * @returns {string} Current theme ('light' or 'dark')
 */
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

/**
 * Set theme attribute and optionally persist to localStorage.
 * @param {string} theme - 'light' or 'dark'
 * @param {Object} options - Options
 * @param {boolean} options.persist - When false, apply the theme without
 *   writing localStorage (auto-detected values never persist)
 */
function setTheme(theme, { persist = true } = {}) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) safeSetItem(THEME_KEY, theme);
  syncThemeButtons(theme);
  if (persist) syncThemeColor(theme);
}

/**
 * Pin the `meta[name="theme-color"]` elements to the APPLIED theme. Only
 * called for stored/manual choices: the browser chrome must follow
 * the persisted toggle, not the OS. Both metas get the applied color and drop
 * their media query so no `prefers-color-scheme` match can re-select the
 * opposite theme. Auto mode (no stored choice) never reaches here: the static
 * metas keep their OS-media behavior and follow the system live.
 * @param {string} theme - 'light' or 'dark'
 */
function syncThemeColor(theme) {
  const color = THEME_COLORS[theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', color);
    meta.removeAttribute('media');
  });
}

/**
 * Mirror data-theme onto the header/mobile toggle buttons so their
 * sun/moon icon CSS selectors (.ctrl-icon-theme[data-theme="dark"]) match
 * @param {string} theme - 'light' or 'dark'
 */
function syncThemeButtons(theme) {
  THEME_BUTTON_IDS.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.setAttribute('data-theme', theme);
  });
}
