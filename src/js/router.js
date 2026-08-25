
import { getAppBase } from './base.js';

// Slug pattern shared with the content loaders: segments alphanumeric,
// separated by single slashes; leading, trailing, and consecutive slashes
// rejected. Single-source consistency: the router gate and the content
// loaders validate the same shape. Exported: app.js imports this instead
// of inlining its own copy: silent divergence is impossible by
// construction. Deliberately NOT tightened: valid-but-missing posts keep
// the post-level not-found behavior.
export const SLUG_PATTERN = /^[a-zA-Z0-9]+(\/[a-zA-Z0-9\-]+)*$/;
// Tag routes are single-segment only: /tag/tech valid, /tag/a/b invalid.
const TAG_PATTERN = /^tag\/[^/]+$/;
// Exact routes with no extra segments.
const EXACT_ROUTES = new Set(['about', 'archive', 'portfolio']);
// Static-file extensions: root-relative hrefs whose pathname ends in one
// of these are real repo files (sitemap.xml, robots.txt, index.json), never
// SPA routes: the click interceptor lets them fall through to native
// navigation so the host serves the file. The route validity gate runs
// FIRST, so a dot inside a route segment (/tag/x.xml) never triggers the
// opt-out.
const STATIC_FILE_EXTENSION = /\.(xml|txt|json|html|css|js|svg|png|jpg|jpeg|gif|webp|avif|ico|pdf|md)$/i;

/**
 * Route validity gate: structural validation shared by the router (section
 * loop, nav-link loop) and app.js (loaders, title branch). Exact
 * about/archive/portfolio, single-segment tag routes, and post/ routes
 * whose remainder matches the slug pattern are valid; everything else
 * (sub-paths under known sections, traversal, double slashes, unknown
 * routes) is invalid and resolves to the page 404 state.
 * @param {string} route - Current route (without leading /)
 * @returns {boolean} True when the route is structurally valid
 */
export function isValidRoute(route) {
  if (!route) return false;
  if (EXACT_ROUTES.has(route)) return true;
  if (TAG_PATTERN.test(route)) return true;
  if (route.startsWith('post/')) {
    return SLUG_PATTERN.test(route.slice('post/'.length));
  }
  return false;
}

/**
 * Section match predicate: replaces the prefix-based route.startsWith(
 * sectionId + '/') that let /archive/djaksd activate the archive section.
 * The archive section hosts exact /archive AND valid tag results; the post
 * section hosts valid post routes only (post/ + slug: the bare 'post'
 * route is invalid and resolves to the page-404 state like every other
 * invalid route); every other section matches its exact id only. Invalid
 * routes match no section, so the not-found fallback fires.
 * @param {string} sectionId - Section element id
 * @param {string} route - Current route
 * @returns {boolean} True when the section should be active
 */
export function sectionMatches(sectionId, route) {
  if (sectionId === 'archive') {
    return route === 'archive' || (route.startsWith('tag/') && isValidRoute(route));
  }
  if (sectionId === 'post') {
    return route.startsWith('post/') && isValidRoute(route);
  }
  return sectionId === route;
}

export function initRouter(onNavigateCallback) {
  handleRoute(onNavigateCallback);

  window.addEventListener('popstate', () => {
    handleRoute(onNavigateCallback);
  });

  // Scope note: the interceptor hijacks same-origin root-relative SPA
  // routes ONLY (/about, /archive, /portfolio, /tag/..., /post/...).
  // Static repo files (/sitemap.xml, /robots.txt, index.json) carry a known
  // file extension and fall through to native navigation: the host serves
  // the real file; missing files 404 naturally.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('//')) return;
    // Static-file opt-out: root-relative hrefs whose pathname carries a
    // known file extension (xml, txt, json, html, css, js, svg, png, jpg,
    // jpeg, gif, webp, avif, ico, pdf, md) are repo files, not SPA routes :
    // the click is NOT intercepted and the browser navigates natively.
    // Route validity wins: /tag/x.xml is a valid tag route and stays
    // intercepted (its .xml is a tag name, not a file).
    const pathname = href.split(/[?#]/)[0].slice(1);
    if (!isValidRoute(pathname) && STATIC_FILE_EXTENSION.test(pathname)) return;
    event.preventDefault();
    // Subpath deployments: prefix root-relative hrefs with the computed
    // base ('/archive' → '/repo/archive'); already-prefixed hrefs and root
    // deployments pass through unchanged.
    const base = getAppBase();
    const url = base !== '/' && !href.startsWith(base) ? base + href.slice(1) : href;
    history.pushState({}, '', url);
    handleRoute(onNavigateCallback);
  });
}

export function getRoute() {
  let path = window.location.pathname;
  // Subpath deployments: strip the computed base prefix ('/repo/archive'
  // → '/archive') so routes parse identically to root.
  const base = getAppBase();
  if (base !== '/') {
    if (path.startsWith(base)) {
      path = path.slice(base.length - 1); // keep the leading slash
    } else if (path === base.slice(0, -1)) {
      path = '/'; // bare base path (e.g. '/repo') boots the default route
    }
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '') || 'about';
  try {
    return decodeURIComponent(path);
  } catch (error) {
    return 'about';
  }
}

function handleRoute(onNavigateCallback) {
  const route = getRoute();

  const sections = document.querySelectorAll('.page-section');
  sections.forEach(section => {
    const sectionId = section.id;

    // Structural gate: only valid routes activate a section: /archive/djaksd,
    // /about/foo, /tag/a/b, /post//x match nothing, so the not-found fallback
    // below fires instead.
    if (sectionMatches(sectionId, route)) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });

  // Unknown route: no section matched above: every section lost .active
  // and main would render blank. Activate the not-found state so the
  // visitor gets a message instead of an empty region. Known routes
  // (about/archive/portfolio/post/tag) always leave a section active and
  // never reach this fallback. The element guard keeps older DOM fixtures
  // (no #not-found) unchanged.
  const notFoundSection = document.getElementById('not-found');
  if (notFoundSection && !document.querySelector('.page-section.active')) {
    notFoundSection.classList.add('active');
  }

   const navLinks = document.querySelectorAll('.nav-link');
   navLinks.forEach(link => {
     // A nav link without href stays inert ('' never matches a route)
     // instead of throwing and killing the whole route handler.
     const href = (link.getAttribute('href') || '').replace(/^[/#]+/, '');

     // Invalid routes highlight nothing: the de-highlight runs explicitly
     // so a previously active link cannot keep .active when the visitor
     // navigates from a valid route to an invalid sub-route.
     if (!isValidRoute(route)) {
       link.classList.remove('active');
       link.removeAttribute('aria-current');
       return;
     }

     if (route.startsWith('tag/') && href === 'archive') {
       link.classList.add('active');
       link.setAttribute('aria-current', 'page');
     } else if (href === route || route.startsWith(href + '/')) {
       link.classList.add('active');
       link.setAttribute('aria-current', 'page');
     } else {
       link.classList.remove('active');
       link.removeAttribute('aria-current');
     }
   });

  if (onNavigateCallback) {
    onNavigateCallback(route);
  }
}
