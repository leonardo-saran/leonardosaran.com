/**
 * App Module - Main entry point
 * Initializes all modules and wires up event listeners
 */

import { initRouter, getRoute, isValidRoute, SLUG_PATTERN } from './router.js';
import { getAppBase } from './base.js';
import { initTheme, toggleTheme } from './theme.js';
import {
  initLanguage,
  setLanguage,
  getLanguage,
  getValidatedLanguage,
  getSecondLanguageCode,
  detectBrowserLanguage,
  hasStoredLanguage,
  t,
  renderStaticLabels,
} from './language.js';
import { isSafeHrefValue } from './security.js';
import { safeGetItem, safeRemoveItem } from './storage.js';
import { EN_TRANSLATIONS, getLanguageConfig, getSite } from './settings.js';
import { parseFrontmatter, renderMarkdown, enhanceMath } from './markdown.js';
import { escapeHtml, escapeAttr } from './utils/escape.js';
import { filterPosts, filterProjects, filterPostsByTag } from './search.js';
import { CHEVRON_LEFT, CHEVRON_RIGHT, COPY_SVG, CHECKMARK_SVG, ERROR_SVG } from './icons.js';

let cachedPosts = [];
let cachedProjects = [];
let langFlashTimer = null;
let archivePage = 1;
let portfolioPage = 1;

let isTagPage = false;
let allTagPagePosts = [];
let tagSearchWasCleared = false;

// Navigation sequence tokens: every loader invocation bumps its surface
// counter; loaders re-check the captured seq after EVERY await and discard
// themselves (silent return) when a newer invocation superseded them.
// Archive and tag SHARE a counter: the tag view renders INTO the archive
// surface (#post-list, search input, pagination, isTagPage): a newer
// invocation of either invalidates in-flight loads of both. The quiet
// language-toggle re-render goes through the same loaders, so a quiet
// re-render racing a navigation is covered by the same tokens.
let archiveLoadSeq = 0;
let portfolioLoadSeq = 0;
let postLoadSeq = 0;

const LANG_FLASH_DURATION = 1000;
const PAGE_SIZE = 5;
const EXCERPT_MAX_CHARS = 150;
// Compile-time constant for the About profile photo: never derived from input.
// The base prefix comes from the module script src: developer markup only.
const PROFILE_PHOTO_PATH = 'src/assets/profile.jpg';

// Profile-photo probe cache: the probe RESULT: present OR absent: is
// cached for the page session. A missing photo is probed once, never
// re-probed on subsequent About re-renders; a loaded photo is already in
// the DOM (idempotence guard) and short-circuits via photoLoaded.
let photoProbed = false;
let photoLoaded = false;

// Static head title captured at boot: restored when a route yields no
// title value (empty post title).
const DEFAULT_DOCUMENT_TITLE = document.title;

/**
 * Restore a deep-linked path saved by the 404.html fallback.
 * GitHub Pages serves 404.html for unknown real paths; the shell stores the
 * FULL visited path (location.pathname + search + hash - so query strings
 * and hashes survive the hop) in sessionStorage ('redirect') and redirects
 * to '/'. On boot this runs BEFORE the router initializes: it replaces the
 * history entry with the stored path so the pathname-based router boots on
 * the deep-linked route instead of the default section. Only same-origin
 * absolute paths are accepted: a leading '/' without a second '/' (the 404
 * shell only ever writes the same-origin location; sessionStorage is
 * per-origin, so a foreign page cannot forge the value). The value is always
 * cleared once read.
 * Threat model: the validation assumes the site CSP (script-src 'self') as
 * a requirement: without CSP, an injected same-origin script could forge
 * the 'redirect' value; the regex and try/catch are second-layer guards,
 * not the primary defense.
 */
export function restoreRedirectedRoute() {
  const redirectPath = safeGetItem('redirect', 'session');
  if (redirectPath === null) return;
  // Always clear once read: including stale/invalid values ('' or
  // non-path payloads) so a repeated boot never re-processes them.
  safeRemoveItem('redirect', 'session');
  // Hostile tokens rejected ANYWHERE in the value: the value now carries the
  // query/hash suffix (pathname + search + hash), so the rejection scans
  // every component - backslash, dot-dot traversal, script-scheme text and
  // angle brackets would otherwise pass inside the trailing '?...'/'#...'
  // and reach replaceState. They cannot appear in a legitimate deep link
  // (the browser percent-encodes them).
  if (/[\\]|\.\.|javascript:|<|>/i.test(redirectPath)) return;
  // Same-origin absolute path only: leading '/', no protocol-relative '//'.
  // A '?'/'#' suffix is allowed: inert for replaceState (same-origin
  // query/hash) and the deep-link query/hash fidelity feature.
  if (!/^\/(?!\/)/.test(redirectPath)) return;
  try {
    history.replaceState({}, '', redirectPath);
  } catch (error) {
    // SecurityError (malformed path): boot at '/': navigation must never
    // fail because of a stale or hostile sessionStorage value.
  }
}

/**
 * Initialize the application
 */
export async function initApp() {
  // Deep-link restore from the 404 fallback: first statement, before
  // initRouter: the restored path becomes the boot route.
  restoreRedirectedRoute();

  initTheme();

  // Await language init before any navigation: section loaders read the
  // active language (data-lang), which is only set once settings load.
  // Without the await the initial route races ahead and renders English.
  await initLanguage();
  // Announce the settled language on the toggle button: after
  // initLanguage so the settings pair and translations are resolved.
  updateLangToggleAriaLabel();

  initRouter(handleNavigation);

  setupEventListeners();

  // Browser language reactivity: silent re-detection on languagechange
  // while the visitor has no stored choice
  setupLanguageReactivity();

  setupSearchSortControls();

  // The initial route is already handled by initRouter above (initRouter →
  // handleRoute → navigation callback): no second navigation at boot, or
  // the default section would fetch its content twice. With the pathname
  // router the boot route comes from location.pathname: '/' boots the
  // default about section, and a deep link (or the 404-restored path)
  // renders directly.
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      toggleTheme();
    });
  }

  const langToggleBtn = document.getElementById('lang-toggle-btn');
  if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
      cycleLanguage();
    });
  }

  // Skip link (a11y): intercept the in-page anchor so the pathname router
  // never sees `#main` (unknown route → every section loses .active) and
  // move focus to the main region programmatically. Neither the hash nor
  // the pathname changes.
  // Explicit scroll to the top + no-scroll focus: the browser's automatic
  // focus-scroll would CENTER main (taller than viewport) and land the
  // view at the middle/end of a long post.
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) {
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      const main = document.getElementById('main');
      if (main) {
        main.scrollIntoView({ block: 'start' });
        main.focus({ preventScroll: true });
      }
    });
  }
}

/**
 * Browser language reactivity: a languagechange event re-detects the
 * browser preference and SILENTLY re-renders the active section in the
 * new language: no flash, no persistence. A stored choice (explicit
 * user toggle) freezes reactivity: automatic changes are ignored while
 * it exists.
 */
function setupLanguageReactivity() {
  window.addEventListener('languagechange', () => {
    if (hasStoredLanguage()) return;
    setLanguage(detectBrowserLanguage(), { persist: false });
    updateLangToggleAriaLabel();
    rerenderActiveSection();
  });
}

/**
 * Wire archive + portfolio toolbar controls (search expand, sort menu).
 * Called once at startup: toolbar markup is static, only lists re-render.
 * Bounded duplication: the archive/portfolio toolbar markup is duplicated
 * in index.html by design (zero-build constraint; two independent control
 * groups) - keep both in sync when editing.
 */
function setupSearchSortControls() {
  wireToolbar(
    { searchControl: 'search-control', searchInput: 'search-btn-input', sortControl: 'sort-control' },
    applyArchiveFilter
  );
  wireToolbar(
    { searchControl: 'portfolio-search-control', searchInput: 'portfolio-search-input', sortControl: 'portfolio-sort-control' },
    applyPortfolioFilter
  );
}

/**
 * Wire one toolbar's search + sort controls. Single implementation for
 * both archive and portfolio toolbars. The control ids are passed
 * explicitly: the DOM ids are not prefix-uniform (the archive input is
 * search-btn-input while the portfolio input is portfolio-search-input),
 * so a prefix scheme cannot derive them.
 * @param {Object} ids - Control element ids
 * @param {string} ids.searchControl - Search control wrapper id
 * @param {string} ids.searchInput - Search input id
 * @param {string} ids.sortControl - Sort control id
 * @param {Function} onFilter - Callback invoked on search input / sort change
 */
function wireToolbar(ids, onFilter) {
  const searchControl = document.getElementById(ids.searchControl);
  const searchInput = document.getElementById(ids.searchInput);
  const sortControl = document.getElementById(ids.sortControl);

  if (searchControl && searchInput) {
    wireSearchControl(searchControl, searchInput);
    searchInput.addEventListener('input', onFilter);
  }
  if (sortControl) {
    wireSortControl(sortControl, onFilter);
  }
}

/**
 * Apply current search query + sort to cached posts and re-render
 * from page 1 (search/sort interactions reset pagination)
 */
function applyArchiveFilter() {
  archivePage = 1;
  refreshArchiveView();
}

/**
 * Re-render the archive list + pagination from current state.
 * Shared by search/sort (reset to page 1) and page navigation.
 * Slim entrypoint: the tag-page branches live in dedicated helpers; the
 * normal branch delegates to the shared refreshListView core.
 */
function refreshArchiveView() {
  const searchInput = document.getElementById('search-btn-input');
  const postList = document.getElementById('post-list');
  if (!searchInput || !postList) return;

  // Tag page behavior: search clear → all posts, re-type → filter by tag
  if (isTagPage) {
    const noResults = document.getElementById('search-no-results');
    const pagination = document.getElementById('pagination');
    const query = searchInput.value;
    const sortControl = document.getElementById('sort-control');
    const sortBy = sortControl?.getAttribute('data-sort') || 'new';

    if (!query.trim()) {
      // Search cleared: reset to page 1 and show ALL posts (archive +
      // portfolio), sorted by the active sort
      renderTagPromptState(postList, noResults, pagination, sortBy);
      return;
    }

    // Search has content: filter the tag set (pre/post-clear mode)
    renderTagFilteredState(postList, noResults, pagination, query, sortBy);
    return;
  }

  renderNormalState();
}

/**
 * Tag page: search cleared: render ALL posts (archive + portfolio) sorted
 * by the active sort, and hide no-results. The clear/sort entrypoint
 * (applyArchiveFilter) resets pagination to page 1 before this runs; the
 * pagination callback re-enters here with the chosen page preserved.
 * The tag set stays reachable by re-typing a tag name (post-clear mode).
 * @param {HTMLElement} postList - Post list container (non-null, entrypoint-guarded)
 * @param {HTMLElement|null} noResults - No-results element
 * @param {HTMLElement|null} pagination - Pagination element
 * @param {string} sortBy - Active sort key
 */
function renderTagPromptState(postList, noResults, pagination, sortBy) {
  if (!tagSearchWasCleared) {
    tagSearchWasCleared = true;
    cachedPosts = allTagPagePosts;
  }
  const allItems = filterPosts('', allTagPagePosts, sortBy);
  renderPostList(postList, allItems);
  if (pagination) {
    renderPagination(
      pagination,
      allItems.length,
      archivePage,
      (page) => { archivePage = page; refreshArchiveView(); }
    );
  }
  if (noResults) noResults.classList.remove('search-no-results--visible');
}

/**
 * Tag page: search has content: filter by tag name after a clear,
 * otherwise run the normal title/excerpt search on the tag-filtered set;
 * render list or no-results, then pagination.
 * @param {HTMLElement} postList - Post list container
 * @param {HTMLElement|null} noResults - No-results element
 * @param {HTMLElement|null} pagination - Pagination element
 * @param {string} query - Search query
 * @param {string} sortBy - Active sort key
 */
function renderTagFilteredState(postList, noResults, pagination, query, sortBy) {
  let filtered;
  if (tagSearchWasCleared) {
    // After clearing: filter by tag name (case-insensitive exact match)
    filtered = filterPostsByTag(query, cachedPosts, sortBy);
  } else {
    // Before clearing: normal title/excerpt search on tag-filtered set
    filtered = filterPosts(query, cachedPosts, sortBy);
  }

  if (filtered.length === 0) {
    postList.innerHTML = '';
    if (noResults) noResults.classList.add('search-no-results--visible');
  } else {
    renderPostList(postList, filtered);
    if (noResults) noResults.classList.remove('search-no-results--visible');
  }

  if (pagination) {
    renderPagination(
      pagination,
      filtered.length,
      archivePage,
      (page) => { archivePage = page; refreshArchiveView(); }
    );
  }
}

/**
 * Archive normal branch: delegate to the shared refreshListView core.
 * The archive path resolves cachedPosts + archivePage here; the tag branch
 * is handled by the entrypoint.
 */
function renderNormalState() {
  refreshListView({
    inputId: 'search-btn-input',
    sortControlId: 'sort-control',
    listId: 'post-list',
    noResultsId: 'search-no-results',
    paginationId: 'pagination',
    filterFn: (query, sortBy) => filterPosts(query, cachedPosts, sortBy),
    getPage: () => archivePage,
    setPage: (page) => { archivePage = page; },
    renderFn: renderPostList,
    refreshFn: refreshArchiveView,
  });
}

/**
 * Shared list-refresh core: read the toolbar state (query + sort), filter
 * the cached items, render the list or the no-results message, then render
 * pagination. Used by the archive normal branch and the portfolio refresh;
 * the archive tag-page branch stays in the archive path.
 * @param {Object} cfg - Configuration
 * @param {string} cfg.inputId - Search input element id
 * @param {string} cfg.sortControlId - Sort control element id
 * @param {string} cfg.listId - List container element id
 * @param {string} cfg.noResultsId - No-results element id
 * @param {string} cfg.paginationId - Pagination element id
 * @param {Function} cfg.filterFn - (query, sortBy) => filtered items
 * @param {Function} cfg.getPage - () => current page
 * @param {Function} cfg.setPage - (page) => persist page
 * @param {Function} cfg.renderFn - (container, items) => render list
 * @param {Function} cfg.refreshFn - () => re-render after page change
 */
function refreshListView({ inputId, sortControlId, listId, noResultsId, paginationId, filterFn, getPage, setPage, renderFn, refreshFn }) {
  const searchInput = document.getElementById(inputId);
  const sortControl = document.getElementById(sortControlId);
  const list = document.getElementById(listId);
  const noResults = document.getElementById(noResultsId);
  const pagination = document.getElementById(paginationId);
  if (!searchInput || !list) return;

  const query = searchInput.value;
  const sortBy = sortControl?.getAttribute('data-sort') || 'new';
  const filtered = filterFn(query, sortBy);

  // Single clamp: a stale page (filter shrank) is clamped ONCE and
  // persisted via setPage so the list slice (renderFn) and the pagination
  // control agree: without it the list could render empty while the pager
  // showed the clamped page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = clampPage(getPage(), pageCount);
  setPage(page);

  if (query.trim() && filtered.length === 0) {
    list.innerHTML = '';
    if (noResults) noResults.classList.add('search-no-results--visible');
  } else {
    renderFn(list, filtered);
    if (noResults) noResults.classList.remove('search-no-results--visible');
  }

  renderPagination(
    pagination,
    filtered.length,
    page,
    (page) => { setPage(page); refreshFn(); }
  );
}

/**
 * Apply current search query + sort to cached projects and re-render
 * from page 1 (search/sort interactions reset pagination)
 */
function applyPortfolioFilter() {
  portfolioPage = 1;
  refreshPortfolioView();
}

/**
 * Re-render the portfolio list + pagination from current state.
 * Shared by search/sort (reset to page 1) and page navigation.
 * Delegates to the shared refreshListView core.
 */
function refreshPortfolioView() {
  refreshListView({
    inputId: 'portfolio-search-input',
    sortControlId: 'portfolio-sort-control',
    listId: 'portfolio-post-list',
    noResultsId: 'portfolio-no-results',
    paginationId: 'portfolio-pagination',
    filterFn: (query, sortBy) => filterProjects(query, cachedProjects, sortBy),
    getPage: () => portfolioPage,
    setPage: (page) => { portfolioPage = page; },
    renderFn: renderProjectList,
    refreshFn: refreshPortfolioView,
  });
}

/**
 * Wire expand/collapse + close semantics for a search control.
 * Closes on outside click / Escape only when the input is empty.
 * @param {HTMLElement} control - Search control element
 * @param {HTMLInputElement} input - Search input element
 */
function wireSearchControl(control, input) {
  control.addEventListener('click', (e) => {
    if (e.target.closest('.search-btn') || e.target.closest('.search-btn-input')) {
      control.classList.add('active');
      input.focus();
    }
  });

  // Keyboard focus on the collapsed input expands the control (one-way:
  // blur never collapses: close stays outside-click/Escape driven).
  input.addEventListener('focus', () => {
    control.classList.add('active');
  });

  document.addEventListener('click', (e) => {
    if (!control.contains(e.target) && !input.value.trim()) {
      control.classList.remove('active');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !input.value.trim()) {
      control.classList.remove('active');
    }
  });
}

/**
 * Wire expand/collapse + close semantics for a sort control.
 * Clicking the sort button toggles the menu; clicking an option applies
 * the sort, marks it selected, and closes the menu.
 * @param {HTMLElement} control - Sort control element
 * @param {Function} onSortChange - Callback invoked after sort applied
 */
function wireSortControl(control, onSortChange) {
  // Sort button announces expanded state to AT (disclosure semantics, no menu pattern)
  const sortBtn = control.querySelector('.sort-btn');
  const syncExpanded = () => {
    if (sortBtn) sortBtn.setAttribute('aria-expanded', String(control.classList.contains('active')));
  };
  syncExpanded();
  markSelectedSortOption(control);

  control.addEventListener('click', (e) => {
    const opt = e.target.closest('.sort-opt');
    if (opt) {
      applySortOption(control, opt, onSortChange);
      syncExpanded();
      return;
    }
    if (e.target.closest('.sort-btn')) {
      control.classList.toggle('active');
      syncExpanded();
    }
  });

  document.addEventListener('click', (e) => {
    if (!control.contains(e.target)) {
      control.classList.remove('active');
      syncExpanded();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      control.classList.remove('active');
      syncExpanded();
    }
  });
}

/**
 * Apply a sort option: persist data-sort, mark selected, close menu, re-render
 * @param {HTMLElement} control - Sort control element
 * @param {HTMLElement} opt - Selected sort option element
 * @param {Function} onSortChange - Callback invoked after sort applied
 */
function applySortOption(control, opt, onSortChange) {
  control.setAttribute('data-sort', opt.getAttribute('data-sort'));
  markSelectedSortOption(control);
  control.classList.remove('active');
  if (onSortChange) onSortChange();
}

/**
 * Mark the active sort option with the .selected class and announce it to
 * assistive technology via aria-current (disclosure pattern; the sort
 * button already carries aria-expanded).
 * @param {HTMLElement} control - Sort control element
 */
function markSelectedSortOption(control) {
  const current = control.getAttribute('data-sort');
  control.querySelectorAll('.sort-opt').forEach(opt => {
    const isSelected = opt.getAttribute('data-sort') === current;
    opt.classList.toggle('selected', isSelected);
    if (isSelected) {
      opt.setAttribute('aria-current', 'true');
    } else {
      opt.removeAttribute('aria-current');
    }
  });
}

// Current-language announcement: the static toggle aria-label never names
// the active language and both flash spans are aria-hidden at rest: the
// button alone must announce it to assistive technology.
const EN_LANGUAGE_LABEL = 'English';

/**
 * Announce the current language on the language toggle button. Composes the
 * common.langToggleCurrent key ('Toggle language - current: {label}') with
 * the active language name: 'English' for EN (constant: the universal
 * default), lang.label from settings for the second language (e.g.
 * 'Português'). Applied wherever the language settles: boot, toggle, and
 * browser languagechange. Fallback: when the key or the settings label is
 * absent (or the template lacks the {label} placeholder), the static
 * aria-label stays untouched. TDS: setAttribute assignment only: hostile
 * label values remain inert text, never parsed as HTML.
 */
function updateLangToggleAriaLabel() {
  const btn = document.getElementById('lang-toggle-btn');
  if (!btn) return;
  const template = t('common.langToggleCurrent');
  // Missing key → t() returns the raw key string: keep the static label.
  if (!template || template === 'common.langToggleCurrent') return;
  if (!template.includes('{label}')) return;
  const label =
    getLanguage() === 'en'
      ? EN_LANGUAGE_LABEL
      : (getLanguageConfig().label || '').trim();
  if (!label) {
    // No settings label → the plain translated label is the fallback
    // announcement. The wiring stays attached, so renderStaticLabels keeps
    // it in sync per language.
    btn.setAttribute('aria-label', t('common.toggleLanguage'));
    return;
  }
  btn.setAttribute('aria-label', template.replace('{label}', label));
  // Detach the static data-i18n-aria-label wiring: section loaders re-run
  // renderStaticLabels after boot, which would clobber the composed label
  // back to the plain translation. Removing the attribute here (idempotent)
  // makes the announcement persist; the fallback early-returns above keep
  // the wiring when no composition is possible.
  btn.removeAttribute('data-i18n-aria-label');
}

/**
 * Cycle language: EN -> {lang.code} -> EN with globe flash of target language.
 * The second-language code comes from the validated settings value: never
 * hardcoded. setLanguage() only toggles CSS visibility, so the active route's
 * content must be re-fetched and re-rendered in the new language.
 */
function cycleLanguage() {
  const currentLang = getLanguage();
  const secondCode = getSecondLanguageCode();
  const newLang = currentLang === 'en' && secondCode ? secondCode : 'en';
  setLanguage(newLang);
  flashLanguage(newLang);
  updateLangToggleAriaLabel();
  rerenderActiveSection();
}

/**
 * Re-fetch and re-render the active route's content in the new language.
 * Quiet mode: previous content stays visible while fetching, then swaps
 * atomically - no loading placeholder, no cleared frame.
 * No-op for routes without content-bearing loaders.
 */
function rerenderActiveSection() {
  const route = getRoute();
  const quiet = true;
  if (route === 'archive') {
    loadArchiveSection({ quiet });
  } else if (route.startsWith('tag/') && isValidRoute(route)) {
    loadTagSection(route.replace('tag/', ''), { quiet });
  } else if (route.startsWith('post/') && isValidRoute(route)) {
    loadPost(route.replace('post/', ''), { quiet });
  } else if (route === 'about') {
    loadAboutSection({ quiet });
  } else if (route === 'portfolio') {
    loadPortfolioSection({ quiet });
  }
}

/**
 * Flash the target language text on the toggle button for ~1 second,
 * then restore the globe icon
 * @param {string} lang - Target language ('en' or the configured second code)
 */
function flashLanguage(lang) {
  const buttons = [
    document.getElementById('lang-toggle-btn')
  ].filter(Boolean);

  buttons.forEach(btn => setFlashLayer(btn, lang));

  if (langFlashTimer) clearTimeout(langFlashTimer);
  langFlashTimer = setTimeout(() => {
    buttons.forEach(btn => setFlashLayer(btn, null));
    langFlashTimer = null;
  }, LANG_FLASH_DURATION);
}

/**
 * Set opacity of the globe/language layers on a toggle button.
 * The second-language layer matches the CONFIGURED code: the
 * .lang-text-second span is generic and holds the settings label.
 * @param {HTMLElement} btn - Toggle button element
 * @param {string|null} lang - Language to show, or null to restore globe
 */
function setFlashLayer(btn, lang) {
  const globe = btn.querySelector('.lang-globe');
  const secondText = btn.querySelector('.lang-text-second');
  const enText = btn.querySelector('.lang-text-en');
  const secondCode = getSecondLanguageCode();
  const ptVisible = Boolean(lang && secondCode && lang === secondCode);
  const enVisible = lang === 'en';

  // Visibility via classes: no inline styles under style-src 'self'
  // (the class pattern keeps the CSP strict; style-src does not police
  // element.style mutations, so inline style mutation is avoided by
  // convention).
  if (globe) globe.classList.toggle('lang-globe--hidden', Boolean(lang));
  if (secondText) secondText.classList.toggle('lang-text--visible', ptVisible);
  if (enText) enText.classList.toggle('lang-text--visible', enVisible);
  // Opacity alone leaves the hidden span in the AT tree: sync aria-hidden
  // with visibility so exactly one text layer is announced (the globe span
  // stays aria-hidden-free: its inner SVG is decorative).
  if (secondText) secondText.setAttribute('aria-hidden', String(!ptVisible));
  if (enText) enText.setAttribute('aria-hidden', String(!enVisible));
}

/**
 * Clear both search inputs (archive + portfolio) and collapse search bars.
 * No-op when elements are not in the DOM.
 */
function clearSearchInputs() {
  const archiveInput = document.getElementById('search-btn-input');
  const portfolioInput = document.getElementById('portfolio-search-input');
  const archiveControl = document.getElementById('search-control');
  const portfolioControl = document.getElementById('portfolio-search-control');

  if (archiveInput) archiveInput.value = '';
  if (portfolioInput) portfolioInput.value = '';
  if (archiveControl) archiveControl.classList.remove('active');
  if (portfolioControl) portfolioControl.classList.remove('active');
}

/**
 * Set the document title for the active route. The label is composed with
 * the site name (getSite().name) when present in settings; a non-empty
 * label is required: an empty label never blanks the tab title. Property
 * assignment only: hostile values stay inert text.
 * @param {string} label - Route label (post title or localized section label)
 */
function setRouteDocumentTitle(label) {
  const siteName = (getSite().name || '').trim();
  const cleanLabel = (label || '').trim();
  if (!cleanLabel) return;
  document.title = siteName ? `${cleanLabel} - ${siteName}` : cleanLabel;
}

// Route focus management (WCAG 2.4.3): the FIRST navigation handled is the
// boot route: focus must never be hijacked from the address bar on initial
// paint. The flag is consumed on the first invocation and every subsequent
// navigation moves focus (post, tag, breadcrumb, popstate included).
let isBootRoute = true;

/**
 * Move focus to the active section's h1 after a route change. tabindex="-1"
 * makes the heading programmatically focusable without adding it to the tab
 * order; the attribute is left in place after focusing: harmless (the h1s
 * are static and never re-created, every move re-sets it before focusing,
 * and -1 keeps the heading out of the tab sequence) and it avoids the Safari
 * programmatic-focus edge. preventScroll keeps the scroll position stable :
 * no jump. No aria-live region: the focus move itself announces the context
 * change (screen readers read the focused heading); a live region on main
 * would double-announce for SR users.
 */
function focusActiveSectionH1() {
  if (isBootRoute) {
    isBootRoute = false;
    return;
  }
  const section = document.querySelector('.page-section.active');
  if (!section) return;
  // h1 first; a section without a heading falls back to the section element
  // itself - same tabindex="-1"/preventScroll pattern.
  const target = section.querySelector('h1') || section;
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/**
 * Handle navigation events
 * @param {string} route - Current route
 */
function handleNavigation(route) {
  // Route focus management (WCAG 2.4.3): the router already toggled the
  // .active classes BEFORE invoking this callback, so the target section
  // and its static h1 exist: move focus now. Runs before the tag
  // early-return below so EVERY route (nav, post, tag, breadcrumb,
  // popstate) is covered; the h1s are static markup, so there is no need
  // to wait for the async loaders. Boot is skipped inside (boot flag).
  focusActiveSectionH1();

  // Handle tag filter results (reuses archive section). Valid tags only :
  // structurally invalid tag routes (/tag/a/b) fall through to the
  // not-found branch below.
  if (route.startsWith('tag/') && isValidRoute(route)) {
    const tagName = route.replace('tag/', '');
    loadTagSection(tagName);
    return;
  }

  // Search box is owned by the view: clear on every non-tag navigation.
  // Tag routes early-return above, keeping loadTagSection's pre-fill.
  clearSearchInputs();

  isTagPage = false;
  tagSearchWasCleared = false;

  if (route === 'archive') {
    loadArchiveSection();
  }

  // Handle post route with slug: structurally valid post routes only.
  // /post//x and traversal payloads never reach the loader: the router
  // gate already resolved them to the page 404 state.
  if (route.startsWith('post/') && isValidRoute(route)) {
    const slug = route.replace('post/', '');
    loadPost(slug);
  }

  if (route === 'about') {
    loadAboutSection();
  }

  if (route === 'portfolio') {
    loadPortfolioSection();
  }

  // Unknown route: no loader owns it: the router already activated
  // #not-found and the static data-i18n line (renderStaticLabels) covers the
  // body. Only the tab title needs this branch: page-not-found label + site
  // name. Invalid sub-routes under known sections (/archive/djaksd,
  // /about/foo, /tag/a/b, /post//x) land here too: the structural gate
  // replaced the prefix-based known-route predicate.
  if (!isValidRoute(route)) {
    setRouteDocumentTitle(t('page.notFound.title'));
  }
}

/**
 * Get the About bio container (single container; content follows the
 * active language)
 * @returns {HTMLElement|null} About bio element
 */
function getAboutBioContainer() {
  return document.querySelector('#about-bio .bio');
}

/**
 * Derive the About initials from the site name: first ALPHANUMERIC letters
 * of the first two name words, uppercased ('Your Name' → 'YN', 'João Silva'
 * → 'JS'). The alphanumeric scan keeps markup delimiters out of the
 * initials entirely: a hostile name can never render a '<'-prefixed
 * fragment. Empty or whitespace-only names return '' so the static
 * pre-boot fallback stays untouched. The caller assigns via textContent
 * only (never markup).
 * @param {string} name - Site name (getSite().name)
 * @returns {string} Initials, or '' when the name yields no letters
 */
export function deriveInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .slice(0, 2)
    .map((word) => {
      const match = word.match(/[a-zA-Z0-9]/);
      return match ? match[0].toUpperCase() : '';
    })
    .join('');
}

/**
 * Inject the profile photo into the About photo frame when present.
 * The static markup carries no <img> and no inline handlers: the probe
 * uses a constant-src Image() and the element is configured with DOM APIs
 * only. On load, the probe element ITSELF is reused as the inserted photo
 * (the asset is fetched once, never twice): configured in place and
 * inserted above the initials; the frame is marked photo-loaded (the
 * .about-photo-frame.photo-loaded rule hides the initials via visibility :
 * layout preserved, no shift); on error, nothing happens and the initials
 * stay. Idempotent: repeated renders never duplicate the photo.
 * @param {HTMLElement} frame - .about-photo-frame element
 */
function injectProfilePhoto(frame) {
  if (photoLoaded) return;
  if (photoProbed) return;
  if (frame.querySelector('img.about-photo')) return;

  // The probe result (present OR absent) is cached for the session: after
  // this point, no re-render ever probes the network again.
  photoProbed = true;

  const probe = new Image();
  probe.addEventListener('load', () => {
    if (frame.querySelector('img.about-photo')) return;
    photoLoaded = true;
    // The probe is the photo: configure it in place and insert it: the src
    // is already set (preloaded), so no second fetch happens.
    probe.className = 'about-photo';
    // Informative alt: site identity when configured, generic fallback otherwise.
    probe.alt = getSite().name ? `Photo of ${getSite().name}` : 'Profile photo';
    frame.insertBefore(probe, frame.firstChild);
    // The photo hides the initials via CSS: visibility keeps the layout
    frame.classList.add('photo-loaded');
  });
  probe.addEventListener('error', () => {
    // Photo absent: the initials fallback stays (silent no-op). The
    // negative outcome is cached (photoProbed), so re-renders skip the probe.
  });
  probe.src = getAppBase() + PROFILE_PHOTO_PATH;
}

/**
 * Reset the profile-photo probe cache (tests and hot reload only). A new
 * page session starts with a fresh probe: present or absent re-probed once.
 */
export function resetProfilePhotoProbe() {
  photoProbed = false;
  photoLoaded = false;
}

/**
 * Load about section with bio from Markdown.
 * The container shows the loading label, then the fetched bio for the
 * active language. Missing file (or fetch error) leaves it empty: the
 * empty state is handled by the visibility model.
 * @param {Object} options - Load options
 * @param {boolean} options.quiet - When true, keep current content visible
 *   while fetching and swap atomically (no loading placeholder, no clearing)
 */
export async function loadAboutSection({ quiet = false } = {}) {
  // Tab title - localized section label + site name
  setRouteDocumentTitle(t('nav.about'));

  const bioContainer = getAboutBioContainer();
  if (!bioContainer) return;

  if (!quiet) {
    bioContainer.innerHTML = `<p data-i18n="common.loading">${EN_TRANSLATIONS['common.loading']}</p>`;
    renderStaticLabels();
  }

  try {
    const lang = getLanguage();
    const mdPath = `src/content/about/${getContentFileName(lang)}`;

    const response = await fetch(getAppBase() + mdPath);

    if (!response.ok) {
      if (!quiet) bioContainer.textContent = '';
      return;
    }

    const mdContent = await response.text();
    // SPA-fallback servers (Netlify/Vercel rewrites) return 200 + index.html
    // for missing paths: validate the BODY against the content model, not
    // the status. A shell body means the bio is absent → empty state.
    if (!isContentFileBody(mdContent)) {
      if (!quiet) bioContainer.textContent = '';
      return;
    }

    const { body } = parseFrontmatter(mdContent);
    const renderedBody = renderMarkdown(body);

    bioContainer.innerHTML = renderedBody;
    // Defense-in-depth: entity-encoded script schemes and event-handler
    // attributes survive the string sanitizer and are only visible in the
    // decoded DOM - neutralize post-render
    sanitizeRenderedContent(bioContainer);
    // MathJax typesetting for [data-tex] placeholders (task-322): a no-op
    // unless the bio actually contains math (lazy-load contract).
    enhanceMath(bioContainer);

  } catch (error) {
    console.error('section:about load failed');
    if (!quiet) bioContainer.textContent = '';
  }

  // Profile photo probe: independent of the bio: runs on every render path
  // (bio ok / missing / failed) and injects the photo when present
  const photoFrame = document.querySelector('.about-photo-frame');
  if (photoFrame) injectProfilePhoto(photoFrame);

  // About initials derive from the site name: the static markup fallback
  // survives only until the first render. Empty/whitespace names keep the
  // static fallback; textContent assignment keeps hostile names inert.
  const initialsElement = document.querySelector('.about-initials');
  if (initialsElement) {
    const initials = deriveInitials(getSite().name);
    if (initials) initialsElement.textContent = initials;
  }
}

/**
 * Fetch and validate a slug index file (archive or portfolio)
 * @param {string} url - Index JSON path
 * @returns {Promise<string[]>} Slug array
 */
async function fetchSlugs(url) {
  const response = await fetch(getAppBase() + url);
  if (!response.ok) throw new Error('Failed to load index');
  const slugs = await response.json();
  if (!Array.isArray(slugs)) throw new Error('Invalid index format');
  return slugs;
}

/**
 * Load metadata for every slug and return valid items sorted by date (newest first)
 * Performance note: issues N parallel fetches (one per post) via
 * Promise.all: acceptable at personal-blog scale; a large archive would
 * want batching or server-side pre-rendering.
 * @param {string[]} slugs - Item slugs
 * @param {Function} loader - Metadata loader (loadPostMetadata | loadProjectMetadata)
 * @returns {Promise<Object[]>} Valid items
 */
async function loadAllMetadata(slugs, loader) {
  const items = await Promise.all(slugs.map((slug) => loader(slug)));
  return items
    .filter((item) => item !== null)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * Inject the archive/portfolio loading placeholder into a list container.
 * The label is a data-i18n element: static English default from the
 * embedded dictionary, translated via renderStaticLabels().
 * @param {HTMLElement} container - List container
 * @param {string} key - Translation key (loading.posts | loading.projects)
 */
function showSectionLoading(container, key) {
  container.innerHTML = `
    <div class="loading-state">
      <span class="spinner"></span>
      <span data-i18n="${key}">${EN_TRANSLATIONS[key]}</span>
    </div>
  `;
  renderStaticLabels();
}

/**
 * Render the localized error message into a list container
 * @param {HTMLElement} container - List container
 * @param {string} key - Translation key (error.posts | error.projects)
 */
function renderSectionError(container, key) {
  container.innerHTML = `
    <div class="error-message" aria-live="polite">
      <span data-i18n="${key}">${EN_TRANSLATIONS[key]}</span>
    </div>
  `;
  renderStaticLabels();
}

/**
 * Render the empty archive state (empty index) and reset pagination
 * @param {HTMLElement} container - List container
 */
function renderEmptyArchiveState(container) {
  renderEmptyState(container);
  cachedPosts = [];
  archivePage = 1;
  renderPagination(document.getElementById('pagination'), 0, archivePage, () => {});
}

/**
 * Load archive section with blog posts
 * Bounded duplication: loadArchiveSection/loadTagSection/loadPortfolioSection
 * share a fetch→validate→render shape; a single generalized list loader is
 * deliberately out of scope (zero-build trade-off, three routes with
 * distinct loading paths).
 * @param {Object} options - Load options
 * @param {boolean} options.quiet - When true, keep current content visible
 *   while fetching and swap atomically (no loading placeholder, no clearing)
 */
export async function loadArchiveSection({ quiet = false } = {}) {
  // Sequence token: capture NOW: any newer archive/tag invocation
  // supersedes this load and discards it after each await.
  const seq = ++archiveLoadSeq;

  // Tab title - localized section label + site name
  setRouteDocumentTitle(t('nav.archive'));

  const postList = document.getElementById('post-list');
  if (!postList) return;

  isTagPage = false;
  tagSearchWasCleared = false;

  if (!quiet) showSectionLoading(postList, 'loading.posts');

  try {
    const slugs = await fetchSlugs('src/content/archive/index.json');

    // Stale-discard: a newer archive/tag navigation won: drop silently
    if (seq !== archiveLoadSeq) return;

    if (slugs.length === 0) {
      renderEmptyArchiveState(postList);
      return;
    }

    const validPosts = await loadAllMetadata(slugs, loadPostMetadata);

    // Stale-discard: a newer archive/tag navigation won: drop silently
    if (seq !== archiveLoadSeq) return;

    cachedPosts = validPosts;
    archivePage = 1;
    renderPostList(postList, validPosts);
    renderPagination(
      document.getElementById('pagination'),
      validPosts.length,
      archivePage,
      (page) => { archivePage = page; refreshArchiveView(); }
    );

  } catch (error) {
    // Stale-discard: a rejected late load must not clobber the newer view
    if (seq !== archiveLoadSeq) return;
    console.error('section:archive load failed');
    renderSectionError(postList, 'error.posts');
  }
}

/**
 * Extract the ISO date (yyyy-mm-dd) from a date-prefixed slug path.
 * @param {string} slug - Slug like "2026/07/01/cli-productivity-tool"
 * @returns {string|null} ISO date, or null when the slug has no date prefix
 */
function extractSlugDate(slug) {
  const dateMatch = slug.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
}

/**
 * Validate an ISO date string (yyyy-mm-dd): the ONLY shape accepted for
 * the metadata.date fallback. Non-ISO frontmatter dates are dropped (null):
 * a value that cannot be a valid <time datetime> must never reach the
 * attribute: escaping alone cannot fix invalid datetime semantics. ISO
 * values pass through byte-identical.
 * @param {*} value - Candidate date value from frontmatter
 * @returns {boolean} true when the value is an ISO yyyy-mm-dd string
 */
function isValidIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Whether an ISO date string (yyyy-mm-dd) falls inside a valid calendar
 * range: the shared guard family used by formatDate and the datetime
 * emission contract: year >= 1, month 1-12, day 1-31, integer components.
 * A format-valid but range-invalid value (e.g. '2026-13-45') passes the
 * ISO regex yet is semantically invalid HTML: it must never reach the
 * <time datetime> attribute (escaping cannot fix invalid datetime
 * semantics).
 * @param {*} value - ISO date string (or null/absent)
 * @returns {boolean} true when every component is an integer in range
 */
function isValidDateRange(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('-').map(Number);
  const [y, m, d] = parts;
  return (
    parts.length === 3 &&
    Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31
  );
}

/**
 * Resolve the content file name for the active language (inverted
 * convention): 'en' → index.md, second language → index.{code}.md.
 * The code is the VALIDATED second-language code from settings: never
 * raw settings values (/^[a-z]{2,3}$/ enforced in language.js).
 * @param {string} lang - Active language
 * @returns {string} Content file name
 */
function getContentFileName(lang) {
  const validated = getValidatedLanguage(lang);
  return validated === 'en' ? 'index.md' : `index.${validated}.md`;
}

/**
 * Whether a fetched response body matches the content model: every content
 * file (index.md / index.{lang}.md) carries YAML frontmatter delimited by
 * '---', so a trimmed body must START with the delimiter. SPA-fallback
 * servers (Netlify/Vercel rewrites) return 200 + index.html for any missing
 * path; bodies without the marker are treated as absent: exactly like a
 * 404 on a plain server.
 * @param {*} body - Response body text
 * @returns {boolean} true when the body looks like a content file
 */
function isContentFileBody(body) {
  return typeof body === 'string' && body.trimStart().startsWith('---');
}

/**
 * Fetch a content file for the active language across one or more root
 * directories (e.g. archive, then portfolio). Resolves ONE file per root
 * (index.md for 'en', index.{lang}.md for the second language): NO fallback:
 * a missing active-language file yields null (double-way visibility rule).
 * @param {string[]} roots - Content roots, tried in order
 * @param {string} lang - Active language
 * @returns {Promise<{content: string, lang: string}|null>} Markdown + language ('EN'|'PT'), or null
 */
async function fetchLocalizedContent(roots, lang) {
  const fileName = getContentFileName(lang);
  for (const root of roots) {
    const path = `${root}/${fileName}`;
    try {
      const response = await fetch(getAppBase() + path);
      if (response.ok) {
        const content = await response.text();
        // SPA-fallback servers answer 200 + index.html for missing files :
        // validate the BODY (content-model marker) not the status; a shell
        // body counts as absent and the next root is tried.
        if (!isContentFileBody(content)) continue;
        const resolvedLang = getValidatedLanguage(lang);
        return { content, lang: resolvedLang === 'en' ? 'EN' : resolvedLang.toUpperCase() };
      }
    } catch (e) {
      // Network/parse failure → try next root; missing file = absent content
    }
  }
  return null;
}

/** Line matching a table separator row (dashes/pipes/colons only) */
const TABLE_SEPARATOR_LINE = /^[\s:|-]+$/;

/**
 * Strip Markdown line markers: headings, blockquotes, list bullets.
 * @param {string} line - Trimmed line
 * @returns {string} Line without leading Markdown markers
 */
function stripLineMarkers(line) {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^>+\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '');
}

/**
 * Generate the listing excerpt from a Markdown body: plain readable text
 * with ALL Markdown markers stripped, truncated to ~150 chars.
 * @param {string} body - Markdown body
 * @returns {string} Plain-text excerpt
 */
export function buildExcerpt(body) {
  if (!body) return '';

  const plain = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
    .replace(/\[([^\]]+)\]\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/`/g, '')
    .replace(/[*_~]/g, '')
    .split('\n')
    .map(line => line.trim())
    .map(stripLineMarkers)
    .filter(line => line !== '' && !TABLE_SEPARATOR_LINE.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length > EXCERPT_MAX_CHARS
    ? `${plain.slice(0, EXCERPT_MAX_CHARS)}...`
    : plain;
}

/**
 * Resolve the shared listing/detail metadata fields.
 * Both loadItemMetadata and renderPost resolve date/title/excerpt through
 * this single helper so the two paths can never diverge again. The first
 * argument is the PARSED frontmatter result ({ metadata, body }): the
 * excerpt derives from the body, which the metadata object alone cannot
 * carry.
 * Date: a valid ISO frontmatter date wins, falling back to the date-prefixed
 * slug path; a non-ISO or absent frontmatter date drops to null before the
 * slug fallback, and the derived date is range-gated: a format-valid but
 * out-of-range value (e.g. '2026-13-45') also drops to null, so the datetime
 * attribute never carries invalid semantics.
 * @param {Object} parsed - parseFrontmatter() result ({ metadata, body })
 * @param {string} slug - Item slug (date-prefixed)
 * @param {Object} [options] - Options
 * @param {boolean} [options.withUrl=false] - Include the frontmatter url field (projects)
 * @returns {{title: string, date: string|null, excerpt: string, url?: string|null}} Resolved fields
 */
export function resolveItemMeta(parsed, slug, { withUrl = false } = {}) {
  const meta = (parsed && parsed.metadata) || {};
  const body = (parsed && parsed.body) || '';
  // Range gate per source: the format guards (isValidIsoDate /
  // extractSlugDate) accept SHAPE but not calendar range: '2026-13-45'
  // passes the regex yet is semantically invalid HTML. An out-of-range
  // frontmatter date drops like a non-ISO one (slug fallback supplies the
  // date); an out-of-range slug date resolves to null → no <time datetime>
  // emitted, never an invalid value.
  const frontDate = isValidIsoDate(meta.date) && isValidDateRange(meta.date) ? meta.date : null;
  const slugDate = extractSlugDate(slug);
  const resolvedDate = frontDate || (slugDate && isValidDateRange(slugDate) ? slugDate : null);
  const item = {
    title: (meta.title || '').trim() || 'Untitled',
    date: resolvedDate,
    excerpt: buildExcerpt(body)
  };
  if (withUrl) item.url = meta.url || null;
  return item;
}

/**
 * Load listing metadata for a content item (post or project).
 * The item is only loaded when the ACTIVE-language file exists (double-way
 * rule): a 404 yields null → the item is filtered out of every listing by
 * loadAllMetadata. Common fields (date/title/excerpt/url) come from the
 * shared resolveItemMeta contract: the SAME helper renderPost uses, so
 * listing and detail can never resolve different values.
 * @param {string} root - Content root directory (e.g., "src/content/archive/{slug}")
 * @param {string} slug - Item slug (date-prefixed)
 * @param {Object} options - Options
 * @param {boolean} options.withUrl - Include the frontmatter url field (projects)
 * @returns {Object|null} Item metadata, or null when the item failed to load
 */
async function loadItemMetadata(root, slug, { withUrl = false } = {}) {
  // Security: validate the slug before any fetch. The slug comes from
  // index.json (operator/CI-controlled), but validation-at-use is the
  // established principle - the shared SLUG_PATTERN imported from router.js
  // keeps this gate identical to loadPost and the router gate. Segments are
  // alphanumeric, separated by single slashes; leading, trailing, and
  // consecutive slashes are rejected. Invalid slugs fail silently
  // (return null), filtered out exactly like missing-content items.
  if (!slug || !SLUG_PATTERN.test(slug)) return null;

  try {
    const found = await fetchLocalizedContent([root], getLanguage());
    if (!found) return null;

    const parsed = parseFrontmatter(found.content);
    const item = {
      slug,
      ...resolveItemMeta(parsed, slug, { withUrl }),
      // Defensive normalization: a plain-string frontmatter tags value
      // (common author typo) becomes a single-element array so the tag-page
      // filter never receives a non-iterable. Author content stays
      // author-controlled - this only guards the shape contract.
      tags: Array.isArray(parsed.metadata.tags) ? parsed.metadata.tags : (parsed.metadata.tags ? [parsed.metadata.tags] : []),
      lang: found.lang
    };
    return item;

  } catch (error) {
    console.error('item metadata load failed');
    return null;
  }
}

/**
 * Load post metadata for listing
 * @param {string} slug - Post slug (e.g., "2026/07/29/my-first-post")
 * @returns {Object|null} Post metadata object or null if failed
 */
async function loadPostMetadata(slug) {
  return loadItemMetadata(`src/content/archive/${slug}`, slug);
}

/**
 * Render post list in the home section
 * @param {HTMLElement} container - Container element
 * @param {Array} posts - Array of post objects
 */
function renderPostList(container, posts) {
  if (!posts || posts.length === 0) {
    renderEmptyState(container);
    return;
  }

  const start = (archivePage - 1) * PAGE_SIZE;
  const pagePosts = posts.slice(start, start + PAGE_SIZE);

  const lang = getLanguage();
  const items = pagePosts.map(post => {
    const formattedDate = formatDate(post.date, lang);

    return `
      <li class="post-list-item">
        <a href="/post/${escapeAttr(post.slug)}" class="post-list-link" data-nav>
          ${post.date ? `
          <div class="post-list-date">
            <time datetime="${escapeAttr(post.date)}">${escapeHtml(formattedDate)}</time>
          </div>` : ''}
          <h2 class="post-list-title">${escapeHtml(post.title)}</h2>
          <p class="post-list-excerpt">${escapeHtml(post.excerpt)}</p>
        </a>
      </li>
    `;
  }).join('');

  container.innerHTML = `<ul class="post-list">${items}</ul>`;

  // Defense-in-depth: frontmatter-controlled values land in listing markup :
  // apply the same DOM-level attribute sweep as post/about bodies so a
  // newline-smuggled scheme can never stay executable.
  sanitizeRenderedContent(container);
}

/**
 * Render empty state when no posts
 * @param {HTMLElement} container - Container element
 */
function renderEmptyState(container) {
  container.innerHTML = `
    <p class="search-no-results search-no-results--visible" data-i18n="empty.posts">${EN_TRANSLATIONS['empty.posts']}</p>
  `;
  renderStaticLabels();
}

/**
 * Load the tag results section: fetches and merges posts from both archive
 * and portfolio indexes, filters by tag name, pre-fills search input with the
 * decoded tag, and renders using the same card layout, toolbar, and pagination
 * as the Archive page. No separate tag header: the search input serves as the
 * visible filter indicator.
 * @param {string} tagName - URL-encoded tag name
 * @param {Object} options - Load options
 * @param {boolean} options.quiet - When true, keep current content visible
 *   while fetching and swap atomically (no loading placeholder, no clearing)
 */
export async function loadTagSection(tagName, { quiet = false } = {}) {
  const postList = document.getElementById('post-list');
  if (!postList) return;

  // Sequence token: the tag view renders INTO the archive surface: it
  // shares the archive counter. Any newer archive/tag invocation supersedes
  // this load and discards it after each await.
  const seq = ++archiveLoadSeq;

  let decodedTag;
  try {
    decodedTag = decodeURIComponent(tagName);
  } catch (e) {
    decodedTag = tagName;
  }

  // Validate: no path traversal in tag name (slashes or dot-dot).
  // Rejected tags render the no-results state: empty list + the dedicated
  // line visible, not the empty-site message.
  if (!decodedTag || decodedTag.includes('/') || decodedTag.includes('\\') || decodedTag.includes('..')) {
    // Reset the tag/archive surface state: a prior
    // valid-tag visit leaves isTagPage + cachedPosts + allTagPagePosts
    // populated. An invalid tag must exit tag mode and behave like a fresh
    // (non-tag) archive surface: no stale tag data leaks into a subsequent
    // search interaction. Mirrors the handleNavigation reset contract.
    isTagPage = false;
    tagSearchWasCleared = false;
    cachedPosts = [];
    allTagPagePosts = [];
    archivePage = 1;

    postList.innerHTML = '';
    const noResults = document.getElementById('search-no-results');
    if (noResults) noResults.classList.add('search-no-results--visible');
    // Still pre-fill search (text is safe: input values are not parsed as HTML)
    const searchInput = document.getElementById('search-btn-input');
    if (searchInput) searchInput.value = decodedTag || '';
    return;
  }

  // Tab title: tag name + site name. Validated tag only; invalid tags
  // keep the previous tab title (page shows the no-results state).
  setRouteDocumentTitle(`#${decodedTag}`);

  if (!quiet) showSectionLoading(postList, 'loading.posts');

  try {
    const [archiveSlugs, portfolioSlugs] = await Promise.all([
      fetchSlugs('src/content/archive/index.json').catch(() => []),
      fetchSlugs('src/content/portfolio/index.json').catch(() => [])
    ]);

    // Stale-discard: a newer archive/tag navigation won: drop silently
    if (seq !== archiveLoadSeq) return;

    const [archivePosts, portfolioPosts] = await Promise.all([
      loadAllMetadata(archiveSlugs, loadPostMetadata),
      loadAllMetadata(portfolioSlugs, loadProjectMetadata)
    ]);

    // Stale-discard: a newer archive/tag navigation won: drop silently
    if (seq !== archiveLoadSeq) return;

    const allItems = [...archivePosts, ...portfolioPosts]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    allTagPagePosts = allItems;
    isTagPage = true;
    tagSearchWasCleared = false;

    const lowerTag = decodedTag.toLowerCase();
    const matchingItems = allItems.filter(item =>
      (item.tags || []).some(tag => tag.toLowerCase() === lowerTag)
    );

    cachedPosts = matchingItems;
    archivePage = 1;

    const searchInput = document.getElementById('search-btn-input');
    if (searchInput) searchInput.value = decodedTag;

    const searchControl = document.getElementById('search-control');
    if (searchControl) searchControl.classList.add('active');

    // Render: zero matching items → empty list + no-results visible
    // immediately (no input event needed); otherwise the tag list with
    // no-results hidden. Pagination renders in both cases.
    const noResults = document.getElementById('search-no-results');
    if (matchingItems.length === 0) {
      postList.innerHTML = '';
      if (noResults) noResults.classList.add('search-no-results--visible');
    } else {
      renderPostList(postList, matchingItems);
      if (noResults) noResults.classList.remove('search-no-results--visible');
    }
    renderPagination(
      document.getElementById('pagination'),
      matchingItems.length,
      archivePage,
      (page) => { archivePage = page; refreshArchiveView(); }
    );

  } catch (error) {
    // Stale-discard: a rejected late load must not clobber the newer view
    if (seq !== archiveLoadSeq) return;
    console.error('section:tag load failed');
    renderSectionError(postList, 'error.posts');
  }
}

/**
 * Render the empty portfolio state (empty index) and reset pagination
 * @param {HTMLElement} container - List container
 */
function renderEmptyPortfolioState(container) {
  renderPortfolioEmptyState(container);
  cachedProjects = [];
  portfolioPage = 1;
  renderPagination(document.getElementById('portfolio-pagination'), 0, portfolioPage, () => {});
}

/**
 * Load portfolio section with projects
 * @param {Object} options - Load options
 * @param {boolean} options.quiet - When true, keep current content visible
 *   while fetching and swap atomically (no loading placeholder, no clearing)
 */
export async function loadPortfolioSection({ quiet = false } = {}) {
  // Sequence token: capture NOW: any newer portfolio invocation
  // supersedes this load and discards it after each await.
  const seq = ++portfolioLoadSeq;

  // Tab title - localized section label + site name
  setRouteDocumentTitle(t('nav.portfolio'));

  const postList = document.getElementById('portfolio-post-list');
  if (!postList) return;

  if (!quiet) showSectionLoading(postList, 'loading.projects');

  try {
    const slugs = await fetchSlugs('src/content/portfolio/index.json');

    // Stale-discard: a newer portfolio navigation won: drop silently
    if (seq !== portfolioLoadSeq) return;

    if (slugs.length === 0) {
      renderEmptyPortfolioState(postList);
      return;
    }

    const validProjects = await loadAllMetadata(slugs, loadProjectMetadata);

    // Stale-discard: a newer portfolio navigation won: drop silently
    if (seq !== portfolioLoadSeq) return;

    cachedProjects = validProjects;
    portfolioPage = 1;
    renderProjectList(postList, validProjects);
    renderPagination(
      document.getElementById('portfolio-pagination'),
      validProjects.length,
      portfolioPage,
      (page) => { portfolioPage = page; refreshPortfolioView(); }
    );

  } catch (error) {
    // Stale-discard: a rejected late load must not clobber the newer view
    if (seq !== portfolioLoadSeq) return;
    console.error('section:portfolio load failed');
    renderSectionError(postList, 'error.projects');
  }
}

/**
 * Load project metadata for listing.
 * Date comes from the date-prefixed slug path (same convention as posts),
 * falling back to frontmatter.
 * @param {string} slug - Project slug (e.g., "2026/07/01/cli-productivity-tool")
 * @returns {Object|null} Project metadata object or null if failed
 */
export async function loadProjectMetadata(slug) {
  return loadItemMetadata(`src/content/portfolio/${slug}`, slug, { withUrl: true });
}

/**
 * Render project list in the portfolio section
 * @param {HTMLElement} container - Container element
 * @param {Array} projects - Array of project objects
 */
function renderProjectList(container, projects) {
  if (!projects || projects.length === 0) {
    renderPortfolioEmptyState(container);
    return;
  }

  const start = (portfolioPage - 1) * PAGE_SIZE;
  const pageProjects = projects.slice(start, start + PAGE_SIZE);

  const items = pageProjects.map(project => {
    const formattedDate = formatDate(project.date, getLanguage());

    // Determine link - external URL when it passes the safe-href guard AND
    // carries an absolute http(s) scheme (scheme-less values pass the guard
    // by design for relative hrefs: a scheme-less project url must not
    // render as a relative external link resolved against a deep route),
    // otherwise internal /post/{slug} link.
    // All attribute interpolations are escaped via escapeAttr.
    const isExternalLink = isSafeHrefValue(project.url) && /^https?:\/\//i.test(project.url);
    const linkHref = isExternalLink ? escapeAttr(project.url) : `/post/${escapeAttr(project.slug)}`;
    // linkTarget is a constant string by design: no user data flows into it,
    // so no escaping is required.
    const linkTarget = isExternalLink ? 'target="_blank" rel="noopener noreferrer"' : 'data-nav';

    return `
      <li class="post-list-item">
        <a href="${linkHref}" class="post-list-link" ${linkTarget}>
          ${project.date ? `
          <div class="post-list-date">
            <time datetime="${escapeAttr(project.date)}">${escapeHtml(formattedDate)}</time>
          </div>` : ''}
          <h2 class="post-list-title">${escapeHtml(project.title)}</h2>
          <p class="post-list-excerpt">${escapeHtml(project.excerpt)}</p>
        </a>
      </li>
    `;
  }).join('');

  container.innerHTML = `<ul class="post-list">${items}</ul>`;

  // Defense-in-depth: the project url from frontmatter is interpolated into
  // the anchor href: apply the same DOM-level attribute sweep as post/about
  // bodies so a newline-smuggled scheme can never stay executable.
  sanitizeRenderedContent(container);
}

/**
 * Render empty state when no projects
 * @param {HTMLElement} container - Container element
 */
function renderPortfolioEmptyState(container) {
  container.innerHTML = `
    <p class="search-no-results search-no-results--visible" data-i18n="empty.projects">${EN_TRANSLATIONS['empty.projects']}</p>
  `;
  renderStaticLabels();
}

/**
 * Clamp a page index to the valid range [1, pageCount].
 * Defensive: non-integer, NaN, string, or negative input falls back to 1.
 * @param {number} page - Requested page index
 * @param {number} pageCount - Total number of pages
 * @returns {number} Safe page index
 */
export function clampPage(page, pageCount) {
  const safeCount = Math.max(1, Math.floor(pageCount) || 1);
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, safeCount);
}

/**
 * Compute the numbered page buttons to show: always 1 and pageCount,
 * plus the current page and its neighbors. Pages skipped between items
 * are rendered as ellipsis spans by the caller.
 * @param {number} page - Current page index
 * @param {number} pageCount - Total number of pages
 * @returns {number[]} Sorted unique page numbers to render
 */
function getPageItems(page, pageCount) {
  const items = new Set([1, pageCount]);
  for (let i = page - 1; i <= page + 1; i++) {
    if (i >= 1 && i <= pageCount) items.add(i);
  }
  return [...items].sort((a, b) => a - b);
}

/**
 * Render the pagination control into a container.
 * Hidden (and emptied) when the item count fits a single page.
 * @param {HTMLElement} container - Pagination nav element
 * @param {number} totalCount - Total items to paginate
 * @param {number} currentPage - Active page index
 * @param {Function} onPageChange - Callback receiving the new page index
 */
function renderPagination(container, totalCount, currentPage, onPageChange) {
  if (!container) return;

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = clampPage(currentPage, pageCount);

  if (totalCount <= PAGE_SIZE) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = getPagerButtonsHtml(page, pageCount);

  container.querySelectorAll('.pagination-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = Number(btn.dataset.page);
      if (!Number.isInteger(target)) return;
      onPageChange(clampPage(target, pageCount));
    });
  });
}

/**
 * Build the pagination buttons HTML: prev, numbered pages with ellipsis
 * for skipped ranges, next. Disabled at range boundaries.
 * @param {number} page - Active page index
 * @param {number} pageCount - Total number of pages
 * @returns {string} Button HTML
 */
function getPagerButtonsHtml(page, pageCount) {
  // aria-labels resolve via t(): settings-driven in the second language,
  // embedded English defaults otherwise. Values are attribute
  // interpolations, so they pass through escapeAttr.
  const prevLabel = escapeAttr(t('common.prevPage'));
  const nextLabel = escapeAttr(t('common.nextPage'));
  const prev = `<button class="pagination-btn" data-page="${page - 1}" aria-label="${prevLabel}"${page <= 1 ? ' disabled aria-disabled="true"' : ''}>${CHEVRON_LEFT}</button>`;
  const next = `<button class="pagination-btn" data-page="${page + 1}" aria-label="${nextLabel}"${page >= pageCount ? ' disabled aria-disabled="true"' : ''}>${CHEVRON_RIGHT}</button>`;

  let items = '';
  let prevItem = 0;
  getPageItems(page, pageCount).forEach((item) => {
    if (item - prevItem > 1) {
      items += '<span class="pagination-ellipsis" aria-hidden="true">...</span>';
    }
    const isCurrent = item === page;
    // common.page is a static template ('Page {n}'); the number is
    // interpolated at render
    const pageLabel = escapeAttr(t('common.page').replace('{n}', String(item)));
    items += `<button class="pagination-btn${isCurrent ? ' active' : ''}" data-page="${item}" aria-label="${pageLabel}"${isCurrent ? ' aria-current="page"' : ''}>${item}</button>`;
    prevItem = item;
  });

  return prev + items + next;
}

/**
 * Format date for display. English uses en-US; the second language uses the
 * locale derived from the CONFIGURED code (never hardcoded): pt → pt-BR,
 * any other code → `${code}-${code.toUpperCase()}` (e.g. de → de-DE);
 * invalid/unknown codes fall back to en-US.
 * @param {string} dateStr - ISO date string
 * @param {string} lang - Language code
 * @returns {string} Formatted date
 */
export function formatDate(dateStr, lang) {
  if (!dateStr) return '';

  try {
    const parts = dateStr.split('-').map(Number);
    const [y, m, d] = parts;
    // Defensive parse: only a well-formed yyyy-mm-dd is accepted: an
    // out-of-range component would roll over in the Date constructor and
    // a non-numeric one would produce an invalid date, so reject before
    // building the local date. Hostile input never reaches the Intl
    // formatter. The shared isValidDateRange guard keeps this predicate
    // identical to the datetime emission contract.
    if (!isValidDateRange(dateStr)) return dateStr;

    // Build the Date LOCALLY (midnight local time) so the calendar day
    // survives every timezone: parsing 'yyyy-mm-dd' as UTC midnight
    // rendered the previous day in negative-offset zones.
    const date = new Date(y, m - 1, d);

    return date.toLocaleDateString(resolveDateLocale(lang), {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
}

// Explicit country variants for the second-language locale derivation:
// the generic ${code}-${code.toUpperCase()} derivation is wrong for zh
// (zh-ZH) and no (no-NO); pt keeps the Brazilian formatting documented in
// the README.
const LOCALE_MAP = { pt: 'pt-BR', zh: 'zh-CN', no: 'nb-NO' };

/**
 * Derive the Intl locale for a display language. The second language uses
 * the CONFIGURED code (never hardcoded): LOCALE_MAP holds explicit country
 * variants, any other configured code derives `${code}-${code.toUpperCase()}`.
 * TDS: the code argument is only trusted when it equals the validated
 * getSecondLanguageCode() result, so hostile values never reach
 * toLocaleDateString.
 * @param {string} lang - Language code
 * @returns {string} Intl locale tag
 */
export function resolveDateLocale(lang) {
  if (lang === 'en') return 'en-US';
  if (lang !== getSecondLanguageCode()) return 'en-US';
  return LOCALE_MAP[lang] || `${lang}-${lang.toUpperCase()}`;
}

/**
 * Get the post detail page elements
 * @returns {Object} Post elements { content, title, meta, breadcrumb }
 */
function getPostElements() {
  return {
    content: document.querySelector('.post-content'),
    title: document.querySelector('.post-title'),
    meta: document.querySelector('#post .post-meta'),
    breadcrumb: document.querySelector('.breadcrumb span[aria-current="page"]')
  };
}

/**
 * Inject the post loading placeholder into the content container
 * @param {HTMLElement} container - Post content container
 */
function showPostLoading(container) {
  container.innerHTML = `<p data-i18n="common.loading">${EN_TRANSLATIONS['common.loading']}</p>`;
  renderStaticLabels();
}

/**
 * Fetch post/project markdown for the active language. Resolution order:
 * archive root first, then portfolio root. ONE file per root: no fallback
 * file within a root (double-way rule).
 * @param {string} slug - Post or project slug
 * @param {string} lang - Active language
 * @returns {Promise<{content: string, source: string}|null>} Markdown content + source tree, or null when not found
 */
export async function fetchPostContent(slug, lang) {
  let found = await fetchLocalizedContent([`src/content/archive/${slug}`], lang);
  if (found) return { content: found.content, source: 'archive' };

  found = await fetchLocalizedContent([`src/content/portfolio/${slug}`], lang);
  if (found) return { content: found.content, source: 'portfolio' };

  return null;
}

/**
 * Switch the SPA to the dedicated page-404 state (the #not-found section):
 * deactivate EVERY page section, activate #not-found, and set the tab title
 * to the localized page-not-found label + site name. Used when a route
 * resolves to a page that does not exist in ANY language: e.g. a
 * structurally valid post slug with no content.
 * NO focus move: the router already moved focus to the active section's h1
 * BEFORE the async loader completed (the focus move runs on the section
 * swap, not on loader completion); a second move here would race the loader
 * and steal focus after the fact. WCAG 2.4.3 is served by that route-level
 * move for the not-found h1 as well (the section swap that follows the
 * loader's discovery is a content-level correction, announced by the title
 * change, not a new destination).
 * Element guard: fixtures without #not-found stay unchanged: the post
 * section is still deactivated, nothing renders (same pattern as the
 * router fallback).
 */
function showNotFoundPage() {
  document.querySelectorAll('.page-section').forEach((section) => {
    section.classList.remove('active');
  });
  const notFoundSection = document.getElementById('not-found');
  if (notFoundSection) notFoundSection.classList.add('active');
  // Clear the title announcement region: the page-404 state has no post
  // title: a stale announcement text must never survive into the next
  // render.
  const liveRegion = document.querySelector('.post-title-live');
  if (liveRegion) liveRegion.textContent = '';
  setRouteDocumentTitle(t('page.notFound.title'));
}

/**
 * Load post content by slug
 * @param {string} slug - Post slug
 * @param {Object} options - Load options
 * @param {boolean} options.quiet - When true, keep current content visible
 *   while fetching and swap atomically (no loading placeholder, no clearing)
 */
export async function loadPost(slug, { quiet = false } = {}) {
  const { content: postContent, title, meta, breadcrumb } = getPostElements();
  if (!postContent) return;

  // Sequence token: capture NOW: any newer post invocation supersedes
  // this load and discards it after each await (post A must never render
  // under post B's URL).
  const seq = ++postLoadSeq;

  // Security: Validate slug to prevent path traversal
  // Segments are alphanumeric, separated by single slashes (date paths);
  // leading, trailing, and consecutive slashes are rejected.
  // The validation MUST run before any fetch: hostile slugs never probe
  // the counterpart language. The router gate already rejects invalid
  // slugs before the loader runs; this branch is the defensive second
  // layer: it resolves to the page-404 state. Uses the shared SLUG_PATTERN
  // imported from router.js.
  if (!slug || !SLUG_PATTERN.test(slug)) {
    showNotFoundPage();
    return;
  }

  const lang = getLanguage();
  if (!quiet) showPostLoading(postContent);

  try {
    const result = await fetchPostContent(slug, lang);

    // Stale-discard: a newer post navigation won: drop silently
    if (seq !== postLoadSeq) return;

    if (result === null) {
      // Active-language file missing. Probe the counterpart language (the
      // other member of the pair: 'en' ↔ configured second code) across both
      // content roots. Counterpart found → the post exists ONLY in the other
      // language: honest "not available in {label}" message inside the ACTIVE
      // post section (the page exists, it is not a 404). Absent (or
      // monolingual) → the page exists in NO language → page-404 state.
      // Only validated codes enter the probe path.
      const otherLang = lang === 'en' ? getSecondLanguageCode() : 'en';
      if (otherLang) {
        const probe = await fetchLocalizedContent(
          [`src/content/archive/${slug}`, `src/content/portfolio/${slug}`],
          otherLang
        );
        // Stale-discard: a newer post navigation won: drop silently
        if (seq !== postLoadSeq) return;
        if (probe !== null) {
          renderPostError(lang);
        } else {
          showNotFoundPage();
        }
      } else {
        showNotFoundPage();
      }
      return;
    }
    renderPost(result.content, result.source, title, postContent, meta, breadcrumb, slug, lang);
  } catch (error) {
    // Stale-discard: a rejected late load must not clobber the newer view
    if (seq !== postLoadSeq) return;
    console.error('section:post load failed');
    showNotFoundPage();
  }
}

/**
 * Build the "post not available" empty-state markup. Single quiet line
 * matching the site's empty-state style: no icon, no heading, no button
 * (header nav + browser back cover navigation). Content-free by design:
 * the message text is computed and assigned via textContent in
 * renderPostError: never innerHTML - so settings-driven values stay inert.
 * @returns {string} Empty-state HTML
 */
function getPostErrorHtml() {
  return `
    <p class="search-no-results search-no-results--visible"></p>
  `;
}

/**
 * Resolve the label for the {label} placeholder in the unavailable message.
 * Trimmed settings label first; empty/missing label falls back to the
 * uppercase second-language code (e.g. "PT"). The result is a plain string
 * assigned via textContent: never parsed as HTML.
 * @returns {string} Display label for the {label} placeholder
 */
function getNotFoundLabel() {
  const label = (getLanguageConfig().label || '').trim();
  if (label) return label;
  return (getSecondLanguageCode() || '').toUpperCase();
}

/**
 * Render the honest unavailable message when the post exists ONLY in the
 * other language of the pair: the post section stays ACTIVE: the page
 * exists, just not in the current language: with the "not available in
 * {label}" line. Posts missing in EVERY language are NOT rendered here:
 * they resolve to the page-404 state via showNotFoundPage, so the plain
 * not-found-body branch is dead and removed (the post.notFound.body
 * translation key stays declared: published contract).
 * @param {string} lang - Current language
 */
function renderPostError(lang) {
  const { title, meta, breadcrumb, content: postContent } = getPostElements();

  if (title) title.textContent = '';
  if (meta) meta.innerHTML = '';

  // Clear the title announcement region: the unavailable state has no
  // title to announce: a stale announcement text must never survive into
  // the next render.
  const liveRegion = document.querySelector('.post-title-live');
  if (liveRegion) liveRegion.textContent = '';

  // Detach the static data-i18n wiring before the assignment:
  // renderStaticLabels below would clobber the not-found label back to
  // the post label. Nothing is restored: the section is re-rendered on
  // navigation.
  if (breadcrumb) {
    breadcrumb.removeAttribute('data-i18n');
    breadcrumb.textContent = t('breadcrumb.notFound');
  }

  if (postContent) {
    postContent.innerHTML = getPostErrorHtml();
    const messageEl = postContent.querySelector('.search-no-results');
    if (messageEl) {
      // textContent assignment: hostile settings values stay inert
      messageEl.textContent = t('post.notFound.unavailable').replace('{label}', getNotFoundLabel());
    }
    renderStaticLabels();
  }
}

/**
 * Neutralize script-executing attributes after markdown HTML is inserted
 * into the DOM (defense-in-depth, second pass).
 *
 * 1. Event-handler attributes: EVERY attribute whose name starts with `on`
 *    is removed on ALL elements. The string-layer sanitizer misses
 *    entity-encoded handler names (`on&#101;rror=`); browsers decode
 *    character references in attribute names at parse time, so the DOM walk
 *    is the last line of defense. The name is entity-decoded before the
 *    on* check to cover both spellings.
 * 2. Anchor hrefs: the HTML parser has already decoded entities and the
 *    WHATWG URL parser strips ASCII tab/newline before scheme parsing, so
 *    the DECODED getAttribute value is the ground truth: entity/tab-encoded
 *    `javascript:` variants surface here as executable schemes even when
 *    the raw-text protocol strips could not see them. Allowed: http:,
 *    https:, mailto:, tel:, and relative hrefs (no scheme). Neutralized:
 *    the href attribute is removed: the link text stays, inert.
 * @param {HTMLElement} el - Container whose attributes must be validated
 */
function sanitizeRenderedContent(el) {
  if (!el) return;

  // Remove every event-handler attribute on any element. Attribute names
  // are decoded from numeric character references before the on* check
  // (browsers decode them at parse time).
  el.querySelectorAll('*').forEach((element) => {
    element.getAttributeNames().forEach((name) => {
      const decodedName = name
        // Clamp to the Unicode maximum: oversized references would throw
        // RangeError and abort the whole walk (payloads stay inert).
        .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Math.min(Number(code), 0x10FFFF)))
        .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10FFFF)));
      if (/^on/i.test(decodedName)) element.removeAttribute(name);
    });
  });

  // Anchor href scheme validation.
  // Gate relationship: this sweep is permissive by design for rendered
  // markdown (data:image/* for imgs), while the settings-value guard
  // remains the final gate for hrefs from settings and frontmatter.
  el.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (href === null) return;
    // WHATWG URL parsing strips ASCII tab/newline before scheme detection
    const normalized = href.replace(/[\t\n\r]/g, '').trimStart();
    const schemeMatch = normalized.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (!schemeMatch) return; // relative: safe
    const scheme = schemeMatch[1].toLowerCase();
    // tel: joins the allowlist (parity with the settings-value guard);
    // data:image is an IMAGE-only carve-out and stays blocked here.
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') return;
    anchor.removeAttribute('href');
  });

  // img src scheme validation: uniform with the anchor walk: WHATWG URL
  // parsing strips ASCII tab/newline before scheme detection, so the decoded
  // value is the ground truth. Allowed: http:, https:, data:image/*
  // (image-only carve-out: never extend it to other data: types or
  // embedding elements) and scheme-less relative srcs. Neutralized: the src
  // attribute is removed: the element and alt stay, inert.
  el.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src === null) return;
    const normalized = src.replace(/[\t\n\r]/g, '').trimStart();
    const schemeMatch = normalized.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (!schemeMatch) return; // relative: safe
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https') return;
    if (scheme === 'data' && /^data:image\//i.test(normalized)) return;
    img.removeAttribute('src');
  });

  // img srcset scheme validation: symmetric with the src walk. srcset is a
  // comma-separated candidate list (URL + optional descriptor), so a
  // dangerous scheme may sit ANYWHERE in the value, not just at its start;
  // WHATWG URL parsing strips ASCII tab/newline first (uniform with the
  // anchor/src paths), then the whole normalized value is scanned for
  // javascript: and for data: except the image-only carve-out (data:image/*).
  // Neutralized: the srcset attribute is removed: the element and its
  // src/alt stay, inert.
  el.querySelectorAll('img[srcset]').forEach((img) => {
    const srcset = img.getAttribute('srcset');
    if (srcset === null) return;
    const normalized = srcset.replace(/[\t\n\r]/g, '').trimStart();
    if (/javascript:/i.test(normalized)) {
      img.removeAttribute('srcset');
      return;
    }
    if (/data:(?!image\/)/i.test(normalized)) img.removeAttribute('srcset');
  });

  // New-tab parity: external markdown links receive
  // rel="noopener noreferrer" at render time; a raw HTML anchor with
  // target="_blank" must carry the same protection. Merge the pair into
  // the existing rel value (space-separated, no duplicates). DOM-based
  // mutation - never innerHTML string rewriting.
  el.querySelectorAll('a[target="_blank"]').forEach((anchor) => {
    const tokens = (anchor.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
    let changed = false;
    if (!tokens.includes('noopener')) {
      tokens.push('noopener');
      changed = true;
    }
    if (!tokens.includes('noreferrer')) {
      tokens.push('noreferrer');
      changed = true;
    }
    if (changed) anchor.setAttribute('rel', tokens.join(' '));
  });
}

/**
 * Render post content
 * @param {string} mdContent - Markdown content
 * @param {string} source - Content source tree ('archive' or 'portfolio')
 * @param {HTMLElement} titleEl - Post title element
 * @param {HTMLElement} contentEl - Content container element
 * @param {HTMLElement} metaEl - Post meta element
 * @param {HTMLElement} breadcrumbEl - Breadcrumb current page element
 * @param {string} slug - Post slug
 * @param {string} lang - Current language
 */
function renderPost(mdContent, source, titleEl, contentEl, metaEl, breadcrumbEl, slug, lang) {
  // Shared resolution contract: date/title/excerpt come from resolveItemMeta :
  // the SAME helper loadItemMetadata uses, so the listing and detail paths
  // can never resolve different values again.
  const parsed = parseFrontmatter(mdContent);
  const meta = resolveItemMeta(parsed, slug);

  // Date from frontmatter, falling back to the date-prefixed slug path.
  // ISO validation lives inside the shared contract: a non-ISO frontmatter
  // date is dropped (null → no <time datetime> emitted), never forwarded
  // into the datetime attribute with invalid semantics.
  const formattedDate = meta.date ? formatDate(meta.date, lang) : '';

  // Defensive normalization: a plain-string frontmatter tags value (common
  // author typo) becomes a single-element array so the disclosure renderer
  // never receives a non-iterable.
  const tags = Array.isArray(parsed.metadata.tags) ? parsed.metadata.tags : (parsed.metadata.tags ? [parsed.metadata.tags] : []);

  // Set title: display value resolved by the shared helper; the raw value
  // keeps the tab-title branch (empty/absent → static default, not the
  // 'Untitled' display fallback).
  const rawTitle = (parsed.metadata.title || '').trim();
  const title = meta.title;
  if (titleEl) titleEl.textContent = title;

  // Screen-reader announcement: the route-level focus move targets the post
  // h1 BEFORE the content fetch resolves: the heading is still empty at
  // that moment, so assistive technology would announce an empty heading.
  // The polite visually-hidden live region next to the title carries the
  // resolved title HERE, on render completion: the title is announced when
  // it becomes available. textContent only: hostile frontmatter titles
  // can never become markup.
  const liveRegion = document.querySelector('.post-title-live');
  if (liveRegion) liveRegion.textContent = title;

  // Tab title: post title + site-name prefix; an empty/absent title
  // restores the static head default captured at boot.
  if (rawTitle) {
    setRouteDocumentTitle(rawTitle);
  } else {
    document.title = DEFAULT_DOCUMENT_TITLE;
  }

  const breadcrumbLink = document.querySelector('.breadcrumb > a[data-nav]');
  if (breadcrumbLink) {
    breadcrumbLink.setAttribute('href', source === 'portfolio' ? '/portfolio' : '/archive');
    const labelEl = breadcrumbLink.querySelector('[data-i18n]');
    const key = source === 'portfolio' ? 'breadcrumb.portfolio' : 'breadcrumb.archive';
    if (labelEl) labelEl.textContent = t(key);
  }

  if (breadcrumbEl) {
    breadcrumbEl.textContent = title;
  }

  if (metaEl) {
    let metaHtml = '';

    if (formattedDate) {
      // Text-context escaping: the formatter output is treated as untrusted :
      // a hostile toLocaleDateString result must never become markup inside
      // the meta innerHTML.
      metaHtml += `<time datetime="${escapeAttr(meta.date)}">${escapeHtml(formattedDate)}</time>`;
    }

    metaEl.innerHTML = metaHtml;
  }

  contentEl.innerHTML = renderMarkdown(parsed.body);
  // Discreet collapsed tags control appended at the very end of the body.
  // Inserted BEFORE the DOM sweep: the sweep is the last operation on the
  // element, so the tags block passes the same authoritative post-DOM walk
  // as the rendered markdown body.
  if (tags.length > 0) {
    contentEl.insertAdjacentHTML('beforeend', buildPostTagsHtml(tags));
  }

  // Entity/tab-encoded script schemes and entity-encoded event-handler
  // attributes are only visible in the decoded DOM: neutralize after
  // insertion, before interaction
  sanitizeRenderedContent(contentEl);

  setupCopyButtons();

  // MathJax typesetting for [data-tex] placeholders (task-322): a no-op
  // unless the post body actually contains math (lazy-load contract).
  enhanceMath(contentEl);
}

/**
 * Build the discreet collapsed tags control markup (native details/summary).
 * Tag values are escaped and joined as plain "#tag, #tag" text: no boxes.
 * @param {string[]} tags - Tag names from frontmatter
 * @returns {string} details/summary HTML
 */
function buildPostTagsHtml(tags) {
  const tagsText = tags.map(tag => {
    const escapedTag = escapeHtml(tag);
    // Attribute context: escapeAttr: encodeURIComponent leaves `'`
    // unencoded, which escapeHtml alone would leave raw in the
    // double-quoted href; the attribute-context helper encodes it.
    const encodedHref = escapeAttr(encodeURIComponent(tag));
    return `<a href="/tag/${encodedHref}">#${escapedTag}</a>`;
  }).join(', ');
  return `
    <details class="post-tags">
      <summary>${escapeHtml(t('post.tags'))}<span class="post-tags-chevron" aria-hidden="true"></span></summary>
      <p class="post-tags-list">${tagsText}</p>
    </details>
  `;
}

/**
 * Set up copy buttons for code blocks
 */
function setupCopyButtons() {
  const codeBlocks = document.querySelectorAll('.post-content pre');

  codeBlocks.forEach(block => {
    const code = block.querySelector('code');
    if (!code) return;

    // Create copy button (aria-label resolves via t())
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.setAttribute('aria-label', t('common.copyCode'));
    copyBtn.innerHTML = COPY_SVG;

    copyBtn.addEventListener('click', async () => {
      const text = code.textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = CHECKMARK_SVG;
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = COPY_SVG;
        }, 2000);
      } catch (err) {
        // Visible failure feedback: error class + icon for the same 2s
        // window as the success checkmark, then restore. Forks serving over
        // HTTP (clipboard denied) get a visual signal; the console log stays
        // for diagnostics.
        copyBtn.classList.add('code-copy-btn--error');
        copyBtn.innerHTML = ERROR_SVG;
        setTimeout(() => {
          copyBtn.classList.remove('code-copy-btn--error');
          copyBtn.innerHTML = COPY_SVG;
        }, 2000);
        console.error('copy failed');
      }
    });

    // Positioning via class: no inline style under style-src 'self'
    // (the class pattern keeps the CSP strict; style-src does not police
    // element.style mutations, so inline style mutation is avoided by
    // convention).
    block.classList.add('code-block-with-copy');
    block.appendChild(copyBtn);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
