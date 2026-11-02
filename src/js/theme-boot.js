/**
 * Theme boot: classic script, runs synchronously in the <head> BEFORE the
 * stylesheet applies, so the first paint already carries data-theme (no
 * dark-theme flash). The dark tokens live in ONE block ([data-theme="dark"]);
 * this script is what the media-query fallback block replaced before.
 *
 * Rules:
 * - stored theme exists → it wins (explicit choice, no system consult)
 * - no stored theme → OS prefers-color-scheme is applied WITHOUT persisting
 * - any failure (localStorage denied, matchMedia missing) → light shell
 *
 * The runtime theme.js (app boot) re-applies its own resolution on top :
 * idempotent, so the pre-set attribute never double-fires. theme.js keeps
 * the live 'change' listener for OS switches while no stored choice exists.
 *
 * Direct-storage note: this classic head script runs before the module graph
 * loads, so it cannot import the safeGetItem wrapper from storage.js used by
 * the runtime modules. The direct localStorage read is deliberate; the
 * try/catch below provides the same storage-denial guarantee the wrapper
 * gives: a throwing localStorage falls back to the light shell.
 */
try {
  const stored = localStorage.getItem('theme');
  const dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
