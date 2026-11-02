/**
 * Base Module - application base path.
 * Deep pages at real paths (/post/{slug}) would resolve relative fetches
 * against the deep URL and 404. The base is computed from the module
 * script's own src: '/src/js/app.js' → '/', '/repo/src/js/app.js' →
 * '/repo/' - and prefixed to every runtime fetch. Root deployments keep
 * the exact pre-migration request URLs (relative 'src/content/...' from a
 * root page resolves to '/src/content/...'). TDS: the base is
 * developer-controlled markup only: never user input.
 *
 * Eager derivation: the base is computed at MODULE EVALUATION, not on
 * first call. The 404.html fallback restores a deep link by replacing the
 * URL BEFORE loadSettings() runs; a lazy first call would then derive the
 * base from the deep document.baseURI and poison every fetch (settings
 * 404, bogus route, empty content). At module evaluation the document URL
 * is still the deployment root ('/' or the subpath): the import chain
 * always runs on the page loaded there, before any restore.
 * resetAppBase() recomputes from the current DOM (tests).
 */

/**
 * Compute the application base path from the current DOM.
 * @returns {string} Base path ending with '/' ('/' for root deployments)
 */
function computeAppBase() {
  // Exact-suffix selector matches the RELATIVE 'src/js/app.js' (as shipped in
  // index.html) AND the absolute '/src/js/app.js' / subpath
  // '/repo/src/js/app.js' forms. Still excludes fork traps: 'wrap-app.js' and
  // 'app.js.map' do not end with 'src/js/app.js'. Not a bare substring match.
  const script = document.querySelector('script[src$="src/js/app.js"]');
  if (!script) return '/';
  // Resolve against baseURI: relative 'src/js/app.js' and absolute
  // '/src/js/app.js' script srcs both yield the absolute module path.
  const modulePath = new URL(script.getAttribute('src'), document.baseURI).pathname;
  const base = modulePath.replace(/\/src\/js\/app\.js$/, '');
  return base ? `${base}/` : '/';
}

// Eager: fixed at import time, when the document URL is the deployment root
// (before any deep-link restore replaces it). getAppBase() is then pure.
let appBase = computeAppBase();

/**
 * Get the application base path (computed at module evaluation).
 * @returns {string} Base path ending with '/' ('/' for root deployments)
 */
export function getAppBase() {
  return appBase;
}

/**
 * Prefix a root-relative path with the application base.
 * base '/' → '/src/content/settings.txt'; base '/repo/' → '/repo/src/...'.
 * @param {string} path - Root-relative path ('src/content/...')
 * @returns {string} Base-prefixed path
 */
export function resolveAppPath(path) {
  return getAppBase() + path;
}

/**
 * Recompute the base from the current DOM (tests and hot reload only).
 */
export function resetAppBase() {
  appBase = computeAppBase();
}
