#!/usr/bin/env node
/**
 * generate-site.js - Head/Sitemap/Robots generator for the static blog.
 *
 * Pure Node script (zero npm dependencies; only core modules fs/path).
 * Reads src/content/settings.txt (same `key = value` semantics as src/js/settings.js,
 * re-implemented here so no browser module is imported) and regenerates:
 *   1. <head> of index.html: title, meta description, Open Graph, Twitter Cards, JSON-LD Person
 *   2. sitemap.xml: section URLs + /post/{slug} per content-index slug
 *   3. robots.txt: Allow-all + sitemap URL derived from site.domain
 *   4. 404.html - GitHub Pages SPA fallback shell
 *   5. the static body fallbacks: about.name h1 + footer.copyright span
 *      + the language-toggle flash code (regenerated from settings so the
 *      publication gate needs no manual index.html body edit)
 *
 * CLI usage:
 *   node scripts/generate-site.js [--settings <path>] [--out <dir>]
 *   Defaults: settings = <project>/src/content/settings.txt, out = <project> root.
 *
 * Fails loudly (stderr + exit code 1) on missing settings file, missing <head>,
 * or missing required site.name / site.domain.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_SETTINGS_PATH = 'src/content/settings.txt';
const OG_LOCALE = 'en_US';
// Defense-in-depth: CSP for an SPA that renders markdown via innerHTML.
// Trusted constant: no user data, so no escaping needed. Tight by design:
// scripts same-origin only (no inline, no eval), styles same-origin only
// (no inline styles remain: code-copy positioning and language flash are
// class-based, so 'unsafe-inline' is unnecessary), images self/data,
// base locked, no forms. frame-ancestors 'none' blocks framing
// (anti-clickjacking); upgrade-insecure-requests coerces HTTPS.
// object-src/frame-src/worker-src are pinned to 'none': the site embeds
// no objects, frames or workers, so those resource types never fall back
// to default-src 'self'.
// connect-src 'self' is declared explicitly: fetch/XHR/WebSocket
// restrictions are inherited from default-src, but an explicit pin keeps
// the connect surface stable if default-src ever widens.
const CSP_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests; object-src 'none'; frame-src 'none'; worker-src 'none'";
// The committed static head already carries the CSP meta itself. It is
// treated as a preserved fragment (kept in its authored position) and the
// generator emits one only when the source head has none - so a fork that
// never runs the generator still ships the policy, and regeneration never
// duplicates it. Match is case-insensitive on http-equiv.
// The frame-ancestors meta-inertness note comment (authored immediately
// above the CSP meta) is captured WITH the meta fragment, so regeneration
// keeps the note exactly once in its authored position.
const CSP_META_SOURCE =
  '(?:<!--\\s*NOTE: frame-ancestors[\\s\\S]*?-->\\s*)?<meta\\b[^>]*http-equiv="Content-Security-Policy"[^>]*>';
const CSP_META_PATTERN = new RegExp(CSP_META_SOURCE, 'i');
// The committed static head already carries the canonical link itself.
// Treated as a preserved fragment (kept in its authored position) and the
// generator emits one only when the source head has none: a fork that never
// runs the generator still ships the canonical, and regeneration never
// duplicates it. Same dedupe rule as the CSP meta.
const CANONICAL_LINK_SOURCE = '<link\\b[^>]*rel="canonical"[^>]*>';
const CANONICAL_LINK_PATTERN = new RegExp(CANONICAL_LINK_SOURCE, 'i');

// A valid site.domain is a bare hostname
// (optional subdomains + TLD of 2+ letters, case-insensitive). Hostile or
// malformed values (evil.com/../../, javascript:..., newline-scheme bypasses)
// fail: the Person url is OMITTED so no silent invalid structured data is
// emitted. Mirrors the runtime's URL-gate philosophy (isSafeHrefValue).
const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
// MINIMAL meta CSP for the 404 shell. `default-src 'none'` blocks every
// resource load except the two hash-pinned inline blocks (redirect script
// + theme style), `base-uri 'none'` and `form-action 'none'` lock
// base/form behavior. Header-only directives (frame-ancestors,
// X-Content-Type-Options: nosniff) are INTENTIONALLY absent: they are
// inert when delivered via <meta>, and GitHub Pages cannot set custom
// headers: the resource-restriction portion of the policy is what a meta
// can enforce.
// The inline redirect script is pinned by its SHA-256 hash instead of
// 'unsafe-inline': per CSP3, when a hash is present it is the SOLE allowlist
// for inline scripts: a mutated/intercepted shell document can no longer
// execute arbitrary inline script. The hash is computed from the exact
// script bytes below (single source of truth): any change to the script
// content is picked up automatically on the next regeneration. Trusted
// constant: no user data interpolated, so no escaping needed.
// BEFORE the redirect, the script reads the STORED theme (the site's manual
// theme toggle persists 'dark' in localStorage['theme']) and applies the
// `dark` class to the body: the hash-pinned style block then paints the
// dark shell. The read is wrapped in its OWN try/catch (storage denial
// never aborts the class add or the redirect; same pattern as the
// sessionStorage write). classList is not CSP-restricted; the class value
// is a FIXED constant ('dark'), so the read cannot inject anything.
// The stored 'redirect' value is the FULL path: location.pathname +
// location.search + location.hash - so a deep link carrying a query string
// (?utm_..., ?ref=...) or hash (#section) survives the 404 hop intact. The
// redirect target below still derives from location.pathname only: the
// query/hash never steer the hop.
const NOT_FOUND_REDIRECT_SCRIPT =
  "try{sessionStorage.setItem('redirect',location.pathname+location.search+location.hash);}catch(e){}try{if(localStorage.getItem('theme')==='dark')document.body.classList.add('dark')}catch(e){}location.replace((function(){var s=location.pathname.split('/').filter(Boolean);return s.length>=2&&!['about','archive','portfolio','post','tag'].includes(s[0])?'/'+s[0]+'/':'/';})());";
const NOT_FOUND_SCRIPT_SHA256 = createHash('sha256')
  .update(NOT_FOUND_REDIRECT_SCRIPT)
  .digest('base64');
// The inline theme style block is pinned by its SHA-256 hash the same way:
// `style-src 'sha256-<hash>'`: per CSP3, when a hash is present it is the
// SOLE allowlist for inline styles. The block matches the site THEME so the
// shell flash (browser-default white background before the redirect lands)
// is gone: light (default) background #F5F5F5 (--color-bg light), dark
// #1A1A1A. The block is background rules ONLY: the fallback paragraph was
// REMOVED (its permanently invisible text was flagged as a cloaking
// pattern), so the `color` rules and `a{color:inherit}` are gone (no text,
// no link). The explicit `body.dark{background:#1A1A1A}` override AFTER the
// base rule (the class from the script beats the base body rule by
// specificity) keeps the stored-theme dark paint; the prefers-color-scheme
// media query stays as the no-JS/system fallback. Honest trade-off: without
// JavaScript the shell shows only the themed background: no navigation
// fallback (the site is JavaScript-required by design); the theme blending
// keeps the deep-link hop seamless. Trusted constant: no user data
// interpolated, so no escaping needed.
const NOT_FOUND_STYLE =
  'body{background:#F5F5F5}body.dark{background:#1A1A1A}@media(prefers-color-scheme:dark){body{background:#1A1A1A}}';
const NOT_FOUND_STYLE_SHA256 = createHash('sha256')
  .update(NOT_FOUND_STYLE)
  .digest('base64');
const NOT_FOUND_CSP_POLICY =
  `default-src 'none'; script-src 'sha256-${NOT_FOUND_SCRIPT_SHA256}'; style-src 'sha256-${NOT_FOUND_STYLE_SHA256}'; base-uri 'none'; form-action 'none'`;

/**
 * HTML-escape a settings value for safe injection into tags/attributes.
 * Ampersand is escaped first so previously-encoded entities are never double-decoded.
 * @param {string} value - Raw value
 * @returns {string} Escaped value
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parse settings.txt text into a flat { key: value } map.
 * Mirrors src/js/settings.js parseEntries: trims lines, skips blank lines,
 * `#` comments, lines without `=`, and empty keys. Value is split at the
 * FIRST `=` and trimmed, then cut at the FIRST ` #` occurrence (inline
 * comment). A `#` without a leading space stays part of the value (e.g.
 * `post.title = #1`). The dynamic blank `post.title` annotation
 * (`post.title = # Post title`) is stripped before trimming. Malformed
 * lines never throw.
 * @param {string} text - Raw settings file content
 * @returns {Object} Parsed key/value map
 */
function parseSettings(text) {
  const entries = {};
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

    entries[key] = cleanValue;
  }
  return entries;
}

/**
 * Build the <title> text: `{name} - {tagline}`, falling back to the bare name.
 * @param {Object} settings - Parsed settings map
 * @returns {string} Title text
 */
function buildTitle(settings) {
  const name = settings['site.name'];
  const tagline = settings['site.tagline'];
  return tagline ? `${name} - ${tagline}` : name;
}

/**
 * Normalize a raw lang.code value from settings.txt.
 * trim → lowercase → primary subtag (split on '-' or '_') → validate
 * /^[a-z]{2,3}$/. Valid → normalized code; invalid (e.g. 'english',
 * empty, digits, path traversal) → null so the caller treats it as
 * unset: the monolingual fallback is preserved, never guessed.
 * Mirrors src/js/settings.js normalizeLanguageCode.
 * @param {*} value - Raw lang.code value
 * @returns {string|null} Normalized code, or null when not a code
 */
function normalizeLanguageCode(value) {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/**
 * Derive the alternate OG locale from lang.code (`pt` → `pt_BR`, `de` → `de_DE`).
 * KEEP IN SYNC with the runtime LOCALE_MAP (src/js/app.js): it specializes
 * pt → pt-BR, zh → zh-CN, no → nb-NO; the generic derivation is wrong for
 * no (no-NO) so it is mapped explicitly here.
 * @param {string|undefined} langCode - Configured second-language code
 * @returns {string|null} Locale string, or null when code is absent
 */
function alternateLocale(langCode) {
  if (!langCode) return null;
  return langCode === 'pt'
    ? 'pt_BR'
    : langCode === 'no'
      ? 'nb_NO'
      : `${langCode}_${langCode.toUpperCase()}`;
}

/**
 * Normalize a github/linkedin settings value into a JSON-LD sameAs href,
 * replicating the runtime footer's three-form logic (src/js/language.js
 * SOCIAL_LINK_RULES / buildSocialHref / normalizeNetworkValue): (1) value
 * with an explicit http(s) scheme → verbatim; (2) scheme-less value
 * starting with the network domain (optional "www.", case-insensitive,
 * "/" boundary after the domain) → canonical base + remainder with
 * base-path dedupe ("/in/" for linkedin); (3) any other scheme-less value
 * → base + value (handle). KEEP IN SYNC with src/js/language.js
 * buildSocialHref: a fork's sameAs must equal the footer href it renders.
 * TDS: hostile values (javascript:, data:, vbscript:, newline-scheme
 * bypasses) return '' and are SKIPPED: no sameAs entry, mirroring the
 * footer's hide-on-invalid behavior.
 * @param {string} base - Canonical network base URL
 * @param {string} domain - Network domain
 * @param {*} value - Settings value
 * @returns {string} Normalized href, or '' when invalid
 */
function sameAsHref(base, domain, value) {
  if (typeof value !== 'string') return '';
  // Normalize ASCII tab/newline/CR BEFORE the scheme regexes
  // - uniform with isSafeHrefValue's DOM-level normalization.
  const normalized = value.replace(/[\t\n\r]/g, '').trim();
  if (normalized === '') return '';
  // isSafeHrefValue gate: only http(s)/mailto/tel or scheme-less pass.
  if (!/^(https?:|mailto:|tel:)/i.test(normalized) && /^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return '';
  }
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const rest = normalized.replace(/^www\./i, '');
  const dom = domain.toLowerCase();
  const isDomainStart =
    rest.toLowerCase().startsWith(dom) &&
    (rest.length === dom.length || rest.charAt(dom.length) === '/');
  if (isDomainStart) {
    const schemeEnd = base.indexOf('://') + 3;
    const hostEnd = base.indexOf('/', schemeEnd);
    const basePath = hostEnd === -1 ? '' : base.slice(hostEnd);
    let remainder = rest.slice(dom.length);
    if (basePath !== '' && remainder.startsWith(basePath)) {
      remainder = remainder.slice(basePath.length);
    } else if (remainder.startsWith('/')) {
      remainder = remainder.slice(1);
    }
    return base + remainder;
  }
  return base + normalized;
}

/**
 * Build the JSON-LD Person schema string. `<` is serialized as \u003c so
 * settings values can never terminate the surrounding <script> tag.
 * @param {Object} settings - Parsed settings map
 * @returns {string} Pretty-printed JSON (escaped for script-tag safety)
 */
function buildJsonLd(settings) {
  const sameAs = [];
  // github + linkedin sameAs replicate the runtime footer href exactly
  // (see sameAsHref above / src/js/language.js SOCIAL_LINK_RULES). Order
  // preserved: linkedin first, github second.
  const linkedin = sameAsHref('https://linkedin.com/in/', 'linkedin.com', settings['site.linkedin']);
  if (linkedin !== '') sameAs.push(linkedin);
  const github = sameAsHref('https://github.com/', 'github.com', settings['site.github']);
  if (github !== '') sameAs.push(github);

  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: settings['site.name'],
  };
  // Only a domain matching /^[a-z0-9.-]+\.[a-z]{2,}$/i yields a
  // url: hostile/malformed values OMIT the field (never a broken/hostile
  // url). Valid domains unchanged.
  const domain = settings['site.domain'];
  if (domain && DOMAIN_PATTERN.test(domain)) {
    person.url = `https://${domain}/`;
  }
  if (sameAs.length > 0) person.sameAs = sameAs;
  if (settings['site.jobTitle']) person.jobTitle = settings['site.jobTitle'];
  if (settings['site.description']) person.description = settings['site.description'];

  return JSON.stringify(person, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * Build the generated <head> fragment (title/meta/OG/Twitter/JSON-LD only).
* Preserved fragments (charset, viewport, stylesheet, theme-boot classic
* script, favicon link, module scripts, and the committed CSP meta) are
* handled by the caller via
 * rebuildHead.
 * @param {Object} settings - Parsed settings map
 * @param {Object} options - { hasProfileImage } controls og:image/twitter:image;
 *   { hasCommittedCsp } suppresses the CSP meta when the source head already
 *   carries one (keep emitting when absent);
 *   { hasCommittedCanonical } suppresses the canonical link when the source
 *   head already carries one (same dedupe rule as CSP)
 * @returns {string} Multi-line head fragment
 */
function buildHeadBlock(settings, { hasProfileImage, hasCommittedCsp = false, hasCommittedCanonical = false }) {
  const name = settings['site.name'];
  const domain = settings['site.domain'];
  const description = settings['site.description'] || settings['site.tagline'];
  const author = settings['site.author'];
  const title = buildTitle(settings);
  const imageUrl = hasProfileImage ? `https://${domain}/src/assets/profile.jpg` : null;
  // Choke point: lang.code normalized before feeding alternateLocale, so
  // raw user input (DE, pt-BR, pt_BR, english) can never emit an invalid
  // og:locale:alternate (e.g. DE_DE); invalid codes → null → monolingual head.
  // The use site still escapes (defense-in-depth beyond the validation chain).
  const alternate = alternateLocale(normalizeLanguageCode(settings['lang.code']));

  const lines = [];
  // CSP first in the generated block (preserved charset/viewport still precede
  // it): unless the source head already carries a committed CSP meta, which
  // rebuildHead preserves in place (no duplicate policy).
  if (!hasCommittedCsp) {
    lines.push(`  <meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">`);
  }
  // Canonical: the domain root is the canonical URL of every page (the SPA
  // has no per-route URLs). Escaped like every other interpolation;
  // suppressed when the source head already carries a committed link (dedupe
  // mirror of the CSP rule).
  if (!hasCommittedCanonical) {
    lines.push(`  <link rel="canonical" href="https://${escapeHtml(domain)}/">`);
  }
  lines.push(`  <title>${escapeHtml(title)}</title>`);
  if (description) lines.push(`  <meta name="description" content="${escapeHtml(description)}">`);
  if (author) lines.push(`  <meta name="author" content="${escapeHtml(author)}">`);
  lines.push('');
  lines.push(`  <meta property="og:title" content="${escapeHtml(title)}">`);
  if (description) lines.push(`  <meta property="og:description" content="${escapeHtml(description)}">`);
  if (imageUrl) lines.push(`  <meta property="og:image" content="${escapeHtml(imageUrl)}">`);
  lines.push('  <meta property="og:type" content="website">');
  lines.push(`  <meta property="og:locale" content="${OG_LOCALE}">`);
  if (alternate) lines.push(`  <meta property="og:locale:alternate" content="${escapeHtml(alternate)}">`);
  lines.push(`  <meta property="og:url" content="https://${escapeHtml(domain)}/">`);
  lines.push(`  <meta property="og:site_name" content="${escapeHtml(name)}">`);
  lines.push('');
  lines.push('  <meta name="twitter:card" content="summary">');
  lines.push(`  <meta name="twitter:title" content="${escapeHtml(title)}">`);
  if (description) lines.push(`  <meta name="twitter:description" content="${escapeHtml(description)}">`);
  if (imageUrl) lines.push(`  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">`);
  lines.push('');
  lines.push('  <script type="application/ld+json">');
  lines.push(`  ${buildJsonLd(settings).replace(/\n/g, '\n  ')}`);
  lines.push('  </script>');

  return lines.join('\n');
}

/** Static sitemap page set: real (non-hash) paths, changefreq, priority.
 *  Hash fragments are not indexable: the SPA serves real paths, so the
 *  sitemap lists the crawlable URLs directly.
 *  Tag routes (/tag/*) are INTENTIONALLY omitted: tags are dynamic (derived
 *  from post metadata at runtime), so tag URLs cannot be enumerated
 *  statically: crawlers discover them via the tag links rendered inside
 *  posts. */
const SITEMAP_PAGES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/about', changefreq: 'monthly', priority: '0.8' },
  { path: '/archive', changefreq: 'weekly', priority: '0.9' },
  { path: '/portfolio', changefreq: 'monthly', priority: '0.8' },
];

// Date prefix of a content slug: yyyy/mm/dd, digits only. Matched against
// the RAW slug before escaping; the three capture groups feed the post
// lastmod. Pattern-only validation (no month/day range check): the content
// walk emits exactly this shape, and hostile input can only produce digits :
// no XML breakout surface on the derived lastmod.
const SLUG_DATE_PATTERN = /^(\d{4})\/(\d{2})\/(\d{2})\//;

/**
 * Derive a post's lastmod from its slug date when the slug carries one
 * (yyyy/mm/dd); fall back to the regeneration date otherwise.
 * @param {string} slug - Date-prefixed post/project slug
 * @param {string} today - Regeneration date (YYYY-MM-DD)
 * @returns {string} lastmod value (YYYY-MM-DD)
 */
function postLastmod(slug, today) {
  const match = SLUG_DATE_PATTERN.exec(slug);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : today;
}

/**
 * Build sitemap.xml: the 4 section URLs plus one /post/{slug} URL per slug
 * from the content indexes (archive + portfolio). Domain and slugs are
 * XML-escaped (existing escapeHtml path: TDS: hostile slugs can never break
 * out of <loc>). Empty/missing indexes produce a section-only sitemap: the
 * template ships empty index.json arrays by default.
 * @param {Object} settings - Parsed settings map
 * @param {string} today - ISO date (YYYY-MM-DD); lastmod for section URLs
 *   and the fallback for posts without a date-prefixed slug
 * @param {string[]} slugs - Combined post/project slugs (date-prefixed paths)
 * @returns {string} sitemap.xml content
 */
function buildSitemap(settings, today, slugs = []) {
  const domain = escapeHtml(settings['site.domain']);
  const urls = SITEMAP_PAGES.map(
    (page) => [
      '  <url>',
      `    <loc>https://${domain}${page.path}</loc>`,
      `    <lastmod>${today}</lastmod>`,
      `    <changefreq>${page.changefreq}</changefreq>`,
      `    <priority>${page.priority}</priority>`,
      '  </url>',
    ].join('\n'),
  );
  const postUrls = slugs.map((slug) => {
    const escapedSlug = escapeHtml(slug);
    return [
      '  <url>',
      `    <loc>https://${domain}/post/${escapedSlug}</loc>`,
      // Posts carry the real date from their slug path; undated slugs keep
      // the regeneration date.
      `    <lastmod>${postLastmod(slug, today)}</lastmod>`,
      '    <changefreq>monthly</changefreq>',
      '    <priority>0.6</priority>',
      '  </url>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.concat(postUrls).join('\n'),
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Build the 404.html GitHub Pages SPA fallback shell.
 * GitHub Pages serves 404.html for unknown real paths; the shell stores the
 * FULL visited path (location.pathname + search + hash - so query strings
 * and hashes survive the hop) in sessionStorage and redirects to the
 * deployment root :
 * '/' for root deployments, '/<base>/' for project pages (username.github.io
 * /repo/): a first pathname segment that is a known route (about, archive,
 * portfolio, post, tag) means the app is served from the origin root, any
 * other first segment is the deployment base. The app boot (app.js
 * restoreRedirectedRoute) replaces the history entry with the stored path
 * BEFORE the router initializes, restoring the deep link.
 *
 * The storage write is best-effort: it is wrapped in try/catch :
 * Safari Private Mode denies sessionStorage, and an uncaught throw would
 * abort the script, stranding the visitor on a blank page. location.replace
 * ALWAYS runs after it, targeting a value derived only from location.pathname
 * (same-origin safe).
 *
 * MINIMAL meta CSP: `default-src 'none'; script-src 'sha256-<hash>';
 * style-src 'sha256-<hash>'; base-uri 'none'; form-action 'none'`: the
 * inline redirect script still runs (its exact bytes are pinned by the
 * sha256 hash; per CSP3 a present hash is the sole allowlist, so
 * 'unsafe-inline' is dropped), the inline theme style block runs under
 * the same hash pin, and nothing else can load (default-src 'none').
 * HONEST NOTE: frame-ancestors and X-Content-Type-Options: nosniff are
 * HEADER-ONLY directives: inert when delivered via <meta>; GitHub Pages
 * does not allow custom headers, so they cannot be enforced here. The meta
 * CSP restricts resource loading, which IS effective. The shell remains a
 * fixed, minimal, self-contained constant with no settings/paths
 * interpolated (nothing can leak into it).
  *
  * Script-only body: the fallback paragraph/link were REMOVED (the
  * permanently invisible text was flagged as a cloaking pattern). Honest
  * trade-off: without JavaScript the shell shows only the themed
  * background: no navigation fallback (the site is JavaScript-required by
  * design); with JavaScript the redirect script runs before paint in
  * working browsers, and the theme-blend style keeps the hop seamless.
  * @returns {string} 404.html content
  */
function build404Html() {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${NOT_FOUND_CSP_POLICY}">`,
    `<style>${NOT_FOUND_STYLE}</style>`,
    '<title>Redirecting...</title>',
    '</head>',
    '<body>',
    `<script>${NOT_FOUND_REDIRECT_SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Build robots.txt with the sitemap URL derived from the domain.
 * @param {Object} settings - Parsed settings map
 * @returns {string} robots.txt content
 */
function buildRobots(settings) {
  // Plain-text context: strip CR/LF/whitespace only: escapeHtml would emit
  // &amp; for a domain containing &, which crawlers may mishandle. The
  // XML-escaped form stays in buildSitemap (attribute context).
  const domain = settings['site.domain'].replace(/[\r\n\s]+/g, '').trim();
  return `User-agent: *\nAllow: /\n\nSitemap: https://${domain}/sitemap.xml\n`;
}

/**
 * Replace the inner content of <head> in an HTML document, keeping ALL
 * fragments the generator does not itself own: the preserved fragments
 * (charset meta, viewport meta, theme-color metas, stylesheet links, the
 * theme-boot classic script, the favicon link, a committed CSP meta and a
 * committed canonical link) AND any fork-custom fragment (google-site-
 * verification, preconnect, manifest, hreflang, analytics, ...): in their
 * original relative order, then appending the generated block. The generator
 * owns/rewrites exactly: <title>, meta description, meta author, OG metas,
 * Twitter metas, the JSON-LD script and the three section comments: those
 * are excluded from preservation (a fork's custom head tags survive
 * regeneration). Preserved fragments are re-indented to the generated
 * block's level (2 spaces) so the resulting head is uniformly indented.
 * Deterministic: repeated runs are byte-identical.
 * @param {string} html - Full HTML document
 * @param {string} headBlock - Generated head fragment
 * @returns {string} HTML with regenerated head
 */
function rebuildHead(html, headBlock) {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) throw new Error('index.html missing <head> block');

  // Section comments authored inside the generated block (buildHeadBlock).
  // Excluded from preservation: the generator re-emits them each run.
  const GENERATED_COMMENTS = [
    '<!-- Open Graph -->',
    '<!-- Twitter Card -->',
    '<!-- JSON-LD Structured Data -->',
  ];

  // A fragment is generator-owned (excluded from preservation) when the
  // generated block rewrites it this run: title, meta description/author,
  // OG/Twitter metas, the JSON-LD script and the three section comments.
  // Everything else: including a committed CSP meta and canonical link
  // (dedupe) and ANY fork-custom fragment: is preserved in authored order.
  const isGeneratorOwned = (fragment) => {
    if (/^<title\b[^>]*>[\s\S]*?<\/title>$/i.test(fragment)) return true;
    if (/^<meta\b[^>]*name="(?:description|author)"[^>]*>$/i.test(fragment)) return true;
    if (/^<meta\b[^>]*property="og:[^"]*"[^>]*>$/i.test(fragment)) return true;
    if (/^<meta\b[^>]*name="twitter:[^"]*"[^>]*>$/i.test(fragment)) return true;
    if (/^<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>$/i.test(fragment)) {
      return true;
    }
    return GENERATED_COMMENTS.includes(fragment.trim());
  };

  // Match every head fragment (comment, script/style/title with content,
  // self-closing, or single tag) in document order. The generic single-tag
  // alternative is QUOTE-AWARE (consumes "..." / '...' as units) so a custom
  // fragment whose attribute value contains a '>' is preserved intact, never
  // split mid-value. A well-formed head carries only these constructs; stray
  // text outside tags is dropped. The scan targets the head INNER content
  // (headMatch[1]) so the <head>/</head> tags themselves are never candidates
  // for preservation.
  const fragmentPattern =
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*\/>|<style\b[^>]*>[\s\S]*?<\/style>|<style\b[^>]*\/>|<title\b[^>]*>[\s\S]*?<\/title>|<title\b[^>]*\/>|<(?:[^>"']|"[^"]*"|'[^']*')+>/gi;

  const preserved = [];
  let match;
  while ((match = fragmentPattern.exec(headMatch[1])) !== null) {
    if (!isGeneratorOwned(match[0])) preserved.push(match[0]);
  }

  // Normalize each preserved fragment to the generated block's indentation:
  // strip original leading whitespace, re-indent every non-empty line with
  // two spaces. Deterministic, so repeated runs stay byte-identical.
  const normalizeIndent = (fragment) =>
    fragment
      .split('\n')
      .map((line) => (line.trim() === '' ? '' : `  ${line.trim()}`))
      .join('\n');

  const separator = preserved.length > 0 ? '\n' : '';
  const newHead = `${preserved.map(normalizeIndent).join('\n')}${separator}${headBlock}`;
  return html.replace(headMatch[0], `<head>\n${newHead}\n</head>`);
}

/**
 * Rewrite the static body fallbacks from settings:
 *   <h1 data-i18n="about.name">          inner text ← settings['site.name']
 *   <span data-i18n="footer.copyright">  inner text ← settings['site.copyright']
 *   <span data-flash-code>               inner text ← uppercase lang.code
 * Targeted attribute match ONLY: a blanket 'Your Name' / 'PT' replace is
 * never applied (a fork may legitimately write the name in other contexts).
 * The element tags and every other attribute are preserved verbatim; only
 * the inner text is replaced, HTML-escaped via escapeHtml (hostile settings
 * values can never break out of the element). Idempotent: replacing
 * already-replaced text with the same value is a no-op. Fallback-safe: an
 * absent key leaves the static text unchanged (no destructive rewrite). The
 * copyright value may carry a {year} token: it expands to the current year
 * before escaping (pure digits, never markup; a fixed-year value without the
 * token is written verbatim). The flash span additionally requires a
 * NORMALIZED lang.code (reusing normalizeLanguageCode: pt → PT, de → DE,
 * slips like DE/pt-BR/pt_BR normalized first) and an enabled language
 * (lang.enabled = false skips the rewrite, mirroring the runtime
 * monolingual guard).
 * @param {string} html - Full HTML document
 * @param {Object} settings - Parsed settings map
 * @returns {string} HTML with the body fragments rewritten
 */
function rewriteBodyFragments(html, settings) {
  let result = html;
  if (settings['site.name']) {
    result = result.replace(
      /<h1\b([^>]*\bdata-i18n="about\.name"[^>]*)>[\s\S]*?<\/h1>/gi,
      (_match, attrs) => `<h1${attrs}>${escapeHtml(settings['site.name'])}</h1>`,
    );
  }
  if (settings['site.copyright']) {
    // The {year} token expands to the current year so forks never ship a
    // stale copyright year. Expansion (pure digits) happens BEFORE
    // escapeHtml, so the token can never introduce markup. Idempotent:
    // expanding {year} to the same year on repeated runs is a no-op.
    // Fallback-safe: no {year} → the value is written verbatim.
    const copyrightValue = settings['site.copyright'].replace(
      /\{year\}/g,
      String(new Date().getFullYear()),
    );
    result = result.replace(
      /<span\b([^>]*\bdata-i18n="footer\.copyright"[^>]*)>[\s\S]*?<\/span>/gi,
      (_match, attrs) => `<span${attrs}>${escapeHtml(copyrightValue)}</span>`,
    );
  }
  const langEnabled = settings['lang.enabled'];
  const langCode = settings['lang.code'] ? normalizeLanguageCode(settings['lang.code']) : null;
  if (langEnabled !== 'false' && langCode) {
    result = result.replace(
      /<span\b([^>]*\bdata-flash-code[^>]*)>[\s\S]*?<\/span>/gi,
      (_match, attrs) => `<span${attrs}>${escapeHtml(langCode.toUpperCase())}</span>`,
    );
  }
  return result;
}

/**
 * Read a content index.json (archive/portfolio) as a slug array. Relative to
 * the content root the generator was pointed at (the settings file's
 * directory). Missing files, malformed JSON and non-array shapes yield [] :
 * the template ships empty indexes and the sitemap must stay section-only.
 * @param {string} indexPath - Absolute path to the index.json file
 * @returns {string[]} Slug list (string entries only)
 */
function readContentIndex(indexPath) {
  try {
    if (!fs.existsSync(indexPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch (error) {
    return [];
  }
}

/**
 * Orchestrator: read settings, regenerate head/sitemap/robots/404 in the
 * output dir. Throws on any failure so the CLI can exit non-zero.
 * @param {Object} options - { settingsPath, outDir, today }
 * @returns {Object} Paths of the regenerated artifacts
 */
function generate({ settingsPath, outDir, today }) {
  const settingsFile = path.resolve(PROJECT_ROOT, settingsPath || DEFAULT_SETTINGS_PATH);
  if (!fs.existsSync(settingsFile)) {
    throw new Error(`settings file not found: ${settingsPath || DEFAULT_SETTINGS_PATH}`);
  }
  const settings = parseSettings(fs.readFileSync(settingsFile, 'utf8'));
  if (!settings['site.name']) throw new Error('missing required setting: site.name');
  if (!settings['site.domain']) throw new Error('missing required setting: site.domain');

  const outputDir = path.resolve(PROJECT_ROOT, outDir || '.');
  const indexFile = path.join(outputDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    throw new Error(`index.html not found in output dir: ${outDir || '.'}`);
  }

  const lastmod = today || new Date().toISOString().slice(0, 10);
  const hasProfileImage = fs.existsSync(path.join(outputDir, 'src', 'assets', 'profile.jpg'));

  const html = fs.readFileSync(indexFile, 'utf8');
  const headMatch = html.match(/<head[^>]*>[\s\S]*?<\/head>/i);
  const hasCommittedCsp = headMatch ? CSP_META_PATTERN.test(headMatch[0]) : false;
  const hasCommittedCanonical = headMatch ? CANONICAL_LINK_PATTERN.test(headMatch[0]) : false;
  const headBlock = buildHeadBlock(settings, {
    hasProfileImage,
    hasCommittedCsp,
    hasCommittedCanonical,
  });
  const regeneratedHtml = rebuildHead(html, headBlock);
  // The static body fallbacks (about.name h1 + footer.copyright span + flash
  // code) are regenerated here too: the publication gate can pass via
  // settings alone, with no manual index.html body edit.
  const finalHtml = rewriteBodyFragments(regeneratedHtml, settings);

  // Content indexes live next to the settings file (src/content/{archive,portfolio}/index.json).
  const contentRoot = path.dirname(settingsFile);
  const slugs = [
    ...readContentIndex(path.join(contentRoot, 'archive', 'index.json')),
    ...readContentIndex(path.join(contentRoot, 'portfolio', 'index.json')),
  ];

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(indexFile, finalHtml);
  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), buildSitemap(settings, lastmod, slugs));
  fs.writeFileSync(path.join(outputDir, 'robots.txt'), buildRobots(settings));
  fs.writeFileSync(path.join(outputDir, '404.html'), build404Html());

  return {
    indexHtml: indexFile,
    sitemap: path.join(outputDir, 'sitemap.xml'),
    robots: path.join(outputDir, 'robots.txt'),
    notFound: path.join(outputDir, '404.html'),
  };
}

/**
 * CLI entry: parse --settings / --out flags, run generate, fail loud on error.
 */
function main(argv) {
  const args = argv.slice(2);
  let settingsPath;
  let outDir;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--settings' && args[index + 1]) {
      settingsPath = args[index + 1];
      index += 1;
    } else if (args[index] === '--out' && args[index + 1]) {
      outDir = args[index + 1];
      index += 1;
    }
  }

  try {
    const result = generate({ settingsPath, outDir });
    process.stdout.write(
      `generate-site: wrote\n  ${result.indexHtml}\n  ${result.sitemap}\n  ${result.robots}\n  ${result.notFound}\n`,
    );
  } catch (error) {
    // System errors (fs) carry absolute paths in error.message: print only
    // the code (e.g. EACCES); deliberate validation errors (no code) keep
    // their human-readable message (e.g. missing required setting).
    const detail = error.code || error.message;
    console.error(`generate-site: ${detail}`);
    process.exitCode = 1;
  }
}

// Run as CLI only when executed directly (never on import by tests).
if (require.main === module) {
  main(process.argv);
}

module.exports = {
  escapeHtml,
  parseSettings,
  buildTitle,
  buildJsonLd,
  buildHeadBlock,
  buildSitemap,
  build404Html,
  buildRobots,
  rewriteBodyFragments,
  generate,
  main,
};
