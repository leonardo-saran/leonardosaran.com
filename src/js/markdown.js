/**
 * Markdown Module - YAML frontmatter parser and Markdown renderer
 * Supports: h2-h6 (headings shift down one level: the body never emits
 * an h1, see the header rules below), bold, italic, strikethrough, inline
 * code, fenced code blocks, blockquotes, lists (ordered, unordered, task),
 * tables, images, links, horizontal rules, LaTeX math (via self-hosted
 * MathJax 3, task-322)
 * Includes XSS prevention
 */

import { stripUnsafeProtocol } from './security.js';
import { escapeHtml, escapeAttr } from './utils/escape.js';
import { resolveAppPath } from './base.js';

/**
 * Parse YAML frontmatter from markdown string
 * Deliberate bounded duplication (audit-9 CD-5): parsers are hand-rolled in
 * three places: this frontmatter parser, settings.js parseEntries, and the
 * generator's parseSettings mirror (scripts/generate-site.js). The zero-build
 * constraint forbids a shared module; parity is contract-tested, keep the
 * trio in sync.
 * @param {string} mdString - Markdown string with optional YAML frontmatter
 * @returns {Object} { metadata: Object, body: string }
 */
export function parseFrontmatter(mdString) {
  if (!mdString || typeof mdString !== 'string') {
    return { metadata: {}, body: '' };
  }

  const result = {
    metadata: {},
    body: mdString
  };

  // Check for frontmatter (starts with ---)
  // Simple approach: find first and second --- boundaries
  const firstDash = mdString.indexOf('---');

  // Must start at beginning and have at least one more ---
  if (firstDash === 0) {
    const secondDash = mdString.indexOf('---', firstDash + 3);

    if (secondDash > 0) {
      const frontmatter = mdString.substring(firstDash + 3, secondDash).trim();
      const body = mdString.substring(secondDash + 3).trim();

      result.body = body;

      // Handle empty frontmatter case
      if (frontmatter === '') {
        return result;
      }

      // Parse YAML-like frontmatter
      const lines = frontmatter.split('\n');
      let currentKey = null;

      lines.forEach(line => {
        // Match key: value
        const keyValueMatch = line.match(/^(\w+):\s*(.*)$/);

        if (keyValueMatch) {
          const [, key, value] = keyValueMatch;
          currentKey = key;

          // Check if value is an array
          if (value.startsWith('[') && value.endsWith(']')) {
            // Parse array
            const arrayContent = value.slice(1, -1);
            result.metadata[key] = arrayContent
              .split(',')
              .map(item => item.trim().replace(/^["']|["']$/g, ''));
          } else if (value.startsWith('"') && value.endsWith('"')) {
            result.metadata[key] = value.slice(1, -1);
          } else if (value.trim()) {
            result.metadata[key] = value.trim();
          } else {
            result.metadata[key] = '';
          }
        } else if (line.startsWith('  - ') && currentKey) {
          // Array item
          if (!Array.isArray(result.metadata[currentKey])) {
            result.metadata[currentKey] = [];
          }
          const item = line.replace(/^  - /, '').replace(/^["']|["']$/g, '');
          result.metadata[currentKey].push(item);
        }
      });
    }
  }

  return result;
}

/**
 * Tags the markdown renderer emits. EVERY other element is stripped.
 * h1 REMAINS allowlisted even though the renderer no longer emits it
 * (audit-7 A3 decision, task-154): raw <h1> authored HTML passes through
 * instead of being destroyed with its content (non-allowlisted tags are
 * removed with their content); the markdown heading path emits h2-h6 only.
 * input is NOT allowlisted (audit-19 2.2): the renderer never emits it
 * (task-list boxes are styled spans, not native inputs) and no authored-form
 * use case exists in the subset: raw <input> strips with its content like
 * any other disallowed tag.
 */
export const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'del', 'code',
  'pre', 'blockquote', 'ul', 'ol', 'li', 'span', 'hr', 'table', 'tr',
  'th', 'td', 'img', 'a'
];

/**
 * Inline-only allowlist for table cells (audit-2 M2, audit-16 B2).
 * Cells may only contain the inline formatting the renderer emits inside
 * them (strong/em/code/a/del); block-level and embedding elements (div, p,
 * h1, table, img, iframe...) are stripped. The legacy `s` alias was removed
 * (audit-16 B2): the renderer emits <del> for ~~strikethrough~~ and never
 * emits <s>, so the cell path must not preserve a tag the body path strips.
 */
export const INLINE_TAGS = ['strong', 'em', 'code', 'a', 'del'];

/**
 * Strip dangerous HTML tags and attributes (XSS prevention)
 * ALLOWLIST mode: only renderer-emitted tags survive (audit-2 A1).
 * LAYER-1 structural strip (audit-9 MS-2): regex-based, runs on the HTML
 * STRING before any DOM exists: NOT a guarantee. sanitizeRenderedContent
 * (post-DOM, app.js) is the real gate: do not treat this function as
 * authoritative.
 * Known limitation (audit-9 MS-3): the dynamic strip regex `<${name}\b` has
 * a `\b` word-boundary edge for short tag names (`<s1>`, `<sarafina>` can
 * match or fail to match in surprising prefix ways). Practically inert :
 * input is author-controlled and the post-DOM sweep catches residue.
 * @param {string} html - HTML string to sanitize
 * @param {string[]} [allowedTags] - Allowlist to apply (defaults to ALLOWED_TAGS)
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(html, allowedTags = ALLOWED_TAGS) {
  // Remove event handlers (onclick, onerror, onload, etc.)
  // The HTML parser treats `/` as an attribute separator, so `<img/onerror=x>`
  // must be caught too: `[\s/]+` covers both whitespace and slash separators
  // (audit-4 S1, task-113).
  html = html.replace(/[\s/]+on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/[\s/]+on\w+\s*=\s*[^\s>]+/gi, '');

  // NOTE (audit-6 S1, task-144): no global `javascript:`/`data:` text strip
  // here: it corrupted VISIBLE didactic content (code blocks, paragraphs,
  // alts). Attribute-level gates own the vectors: link restore runs
  // stripUnsafeProtocol (task-083), image restore the same (task-136), and
  // the post-DOM anchor walk (task-113) neutralizes decoded/entity variants.

  // Allowlist: strip every element the renderer does not emit.
  // Non-allowlisted elements are removed WITH their content, so a raw
  // <form> cannot leave live children (e.g. <input>) behind.
  const tagNamePattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b/g;
  const presentTags = new Set();
  html.replace(tagNamePattern, (match, name) => {
    presentTags.add(name.toLowerCase());
    return match;
  });

  presentTags.forEach((name) => {
    if (allowedTags.includes(name)) return;
    // Element with content (greedy: removes nested same-name elements too)
    html = html.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*</${name}\\s*>`, 'gi'), '');
    // Leftover self-closing, unclosed or orphan closing tags
    html = html.replace(new RegExp(`</?${name}\\b[^>]*\\/?>`, 'gi'), '');
  });

  return html;
}

export function renderMarkdown(mdBody) {
  if (!mdBody || typeof mdBody !== 'string') {
    return '';
  }

  let html = mdBody;

  // Store code blocks to prevent processing their contents. Every
  // placeholder carries the index AND the family's final total count
  // (`%%NXM%%CODEBLOCK0of1%%`), making each token positionally
  // unambiguous (audit-23 1.2, task-261): a `%%NXM%%CODEBLOCK0%%` literal
  // authored BEFORE a real element no longer collides: the restore swaps
  // the FIRST occurrence, so the previous format replaced the author's
  // text and left the real token literal. For a literal to collide now it
  // must spell the exact `of` count of the real family. The count is taken
  // before replacement so the suffix is the true final total.
  const codeBlocks = [];
  const codeBlockCount = (html.match(/(```)(\w*)\n([\s\S]*?)```/g) || []).length;
  html = html.replace(/(```)(\w*)\n([\s\S]*?)```/g, (match, backticks, lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code: code.trim() });
    return `%%NXM%%CODEBLOCK${index}of${codeBlockCount}%%`;
  });

  // Store inline code to prevent processing. Backtick-delimited math
  // triggers (`` `$...$` `` / `` `$$...$$` ``) are NOT inline code: the
  // backticks around the dollars ARE the math delimiter (task-231), so
  // those spans are left verbatim for the math extraction pass below.
  const inlineCodes = [];
  // The count excludes math-trigger spans (`` `$...$` `` / `` `$$...$$` ``):
  // the replace leaves them verbatim, so only the spans it actually
  // tokenizes count toward the `of` suffix (keeps the collision contract
  // exact).
  const inlineCodeCount = [...html.matchAll(/`([^`]+)`/g)]
    .filter((m) => !(/^`\$\$[\s\S]*\$\$`$/.test(m[0]) || /^`\$[^$\n]*\$`$/.test(m[0])))
    .length;
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const isMathTrigger = /^`\$\$[\s\S]*\$\$`$/.test(match) || /^`\$[^$\n]*\$`$/.test(match);
    if (isMathTrigger) return match;
    const index = inlineCodes.length;
    inlineCodes.push(code);
    return `%%NXM%%INLINECODE${index}of${inlineCodeCount}%%`;
  });

  // Store images to prevent processing
  const images = [];
  // Balanced-parentheses capture (task-272, audit-24 4): the old `([^)]+)`
  // truncated URLs containing parentheses (e.g. Wikipedia `...Foo_(bar)`).
  // The capture greedily matches non-paren chars then any balanced inner
  // paren pair, so a trailing literal `)` after the URL stays outside.
  const imageCount = (html.match(/!\[([^\]]*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g) || []).length;
  html = html.replace(/!\[([^\]]*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (match, alt, src) => {
    const index = images.length;
    images.push({ alt, src });
    return `%%NXM%%IMAGE${index}of${imageCount}%%`;
  });

  // Store links to prevent processing
  const links = [];
  const linkCount = (html.match(/\[([^\]]+)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g) || []).length;
  html = html.replace(/\[([^\]]+)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (match, text, href) => {
    const index = links.length;
    links.push({ text, href });
    return `%%NXM%%LINK${index}of${linkCount}%%`;
  });

  // Store math (LaTeX via MathJax, task-322; backtick trigger from
  // task-228/task-231): extracted AFTER code/link/image tokenization. The
  // trigger REQUIRES backticks around the dollars: `` `$...$` `` inline and
  // `` `$$...$$` `` on its own line; a bare `$` is always literal text
  // (money-safe: "custa $5" stays literal). Display (`` `$$...$$` ``) is
  // extracted FIRST and own-line only (`^`/`$` anchors), so a single `$`
  // never consumes a `$$` opener and mid-line `` `$$...$$` `` degrades to
  // literal dollars. The tokens carry the same %%NXM%% prefix as the rest
  // of the placeholder family and are inert across every pipeline regex.
  // The in-house LaTeX subset parser is GONE (task-322): each token is
  // restored as an EMPTY placeholder carrying the raw source in a
  // data-tex attribute; enhanceMath() below typesets them with MathJax.
  const mathBlocks = [];
  // Both passes share one family total: display count + inline count,
  // computed on the same pre-extraction html (the passes are disjoint and
  // their tokens contain no `$`, so neither count can cross-contaminate).
  const mathDisplayCount = (html.match(/^`\$\$([\s\S]+?)\$\$`$/gm) || []).length;
  const mathInlineCount = (html.match(/`\$([^$\n]+?)\$`/g) || []).length;
  const mathTotal = mathDisplayCount + mathInlineCount;
  html = html.replace(/^`\$\$([\s\S]+?)\$\$`$/gm, (match, expr) => {
    const index = mathBlocks.length;
    mathBlocks.push({ expr, display: true });
    return `%%NXM%%MATH${index}of${mathTotal}%%`;
  });
  html = html.replace(/`\$([^$\n]+?)\$`/g, (match, expr) => {
    const index = mathBlocks.length;
    mathBlocks.push({ expr, display: false });
    return `%%NXM%%MATH${index}of${mathTotal}%%`;
  });

  // Headers: shifted down one level (audit-7 A3): body content must never
  // emit an h1 (every page owns a single page-level h1: post title, About
  // name). `# ` → h2 ... `##### ` → h6; `###### ` stays h6 (no h7). The
  // patterns are distinct (`^# ` needs a space after one hash), so the
  // deepest-first order is kept for readability only.
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold, italic, strikethrough
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Blockquotes: exactly ONE replace per reachable variant (audit-5 B1).
  // The `> ` variant matches raw markdown lines. The `&gt; ` variant is NOT
  // dead: it runs on raw text before any entity handling, so a literal
  // `&gt; quote` line in the body becomes a blockquote (probe-verified).
  // Duplicate replaces were pure waste: after the first replace the line
  // starts with `<blockquote>` and the duplicate regex can never re-match.
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Task lists (must process before regular lists)
  // Checked items emit the `checked` variant; the box is a styled span the
  // CSS draws the checkmark into (`.task-checkbox.checked::after`), so no
  // native <input> is produced (audit-3 B5).
  html = html.replace(/^- \[x\]\s+(.+)/gim, '<li class="task-list-item"><span class="task-checkbox checked"></span>$1</li>');
  html = html.replace(/^- \[ \]\s+(.+)/gim, '<li class="task-list-item"><span class="task-checkbox"></span>$1</li>');
  // Wrap consecutive task items in the task-list wrapper. The task <li>s carry
  // a class, so the generic <ul> wrap below never re-matches them. The
  // non-greedy cross-line item matcher and the newline glue (which tolerates
  // blank lines: audit-7 M7) keep `</ul>` on its own line (no trailing \n);
  // blank-line-separated task items stay ONE group, intervening prose still
  // breaks the group.
  html = html.replace(/<li class="task-list-item">[\s\S]*?<\/li>(?:(?:\n[ \t]*)+<li class="task-list-item">[\s\S]*?<\/li>)*/g, '<ul class="task-list">$&</ul>');

  // Unordered lists. Items carry a type-distinct %%UL%% marker so the wrap
  // regex can only match its own items; the ordered wrap below can never
  // re-wrap a ul li run (audit-5 ALTA-1: the previous shared li-run wrap
  // re-wrapped <ul> content in <ol> and the match.includes('<ul>') guard
  // was dead code: the ul tags sit outside the matched li run). The
  // newline glue lives inside the repeat group (same pattern as the
  // task-list wrap) so the last item's newline is never consumed.
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>%%UL%%$1</li>');
  html = html.replace(/(<li>%%UL%%.*<\/li>(?:\n<li>%%UL%%.*<\/li>)*)/g, '<ul>$&</ul>');

  // Ordered lists - distinct %%OL%% marker, same type-isolation rationale.
  html = html.replace(/^\d+\. (.+)$/gm, '<li>%%OL%%$1</li>');
  html = html.replace(/(<li>%%OL%%.*<\/li>(?:\n<li>%%OL%%.*<\/li>)*)/g, '<ol>$&</ol>');

  // Strip the list-type markers (item content is untouched).
  html = html.replace(/%%UL%%/g, '');
  html = html.replace(/%%OL%%/g, '');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\*\*\*$/gm, '<hr>');

  // Tables - process each contiguous block of pipe lines independently
  // (task-111 multi-table fix): rows, separators and inline-token
  // restoration stay scoped per table, so N tables in one document render
  // as N distinct <table> elements instead of one merged table (the flat
  // tableRows collection previously merged all tables and the marker-group
  // replacement emitted the merged table for every block, leaving the
  // second block's %%INLINECODE%%/%%LINK%% tokens unrestored).
  // The optional trailing newline is consumed only when a blank line or
  // EOF follows (matching the previous marker-group behavior); pipe lines
  // not ending in `|` never match, exactly like the previous per-line rule.
  html = html.replace(/^\|.+\|(?=\n|$)(?:\n\|.+\|(?=\n|$))*(?:\n(?=\n|$))?/gm, (block) => {
    let tableHtml = '<table>';
    let rowIndex = 0;
    block.split('\n').forEach((line) => {
      // consumed trailing newline
      if (line === '') return;
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      // Divider row - plain or alignment-marked separators (`---`,
      // `:---:`, `---:`, `:---`) are all recognized (audit-3 B6);
      // alignment mapping is out of scope, the line is discarded.
      const isDivider = cells.every((c) => /^:?-{2,}:?$/.test(c));
      if (isDivider) return;
      const cellTag = rowIndex === 0 ? 'th' : 'td';
      // Cell content is sanitized with the INLINE-ONLY allowlist before
      // interpolation: raw block/embedding HTML never enters the cell.
      const cellsHtml = cells.map((c) => `<${cellTag}>${sanitizeHtml(c, INLINE_TAGS)}</${cellTag}>`).join('');
      tableHtml += `<tr>${cellsHtml}</tr>`;
      rowIndex += 1;
    });
    tableHtml += '</table>';
    return tableHtml;
  });

  // Paragraphs - exclude blockquote tags from paragraph wrapping
  const lines = html.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    // Skip if already wrapped in block element
    if (trimmed.startsWith('<h') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('<ol') ||
        trimmed.startsWith('<li') ||
        trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('<pre') ||
        trimmed.startsWith('<hr') ||
        trimmed.startsWith('<table') ||
        trimmed.startsWith('<tr') ||
        trimmed.startsWith('<td') ||
        trimmed.startsWith('<th') ||
        trimmed.startsWith('<p') ||
        trimmed === '') {
      return line;
    }
    // Skip placeholder markers
    if (trimmed.startsWith('%%')) {
      return line;
    }
    // Wrap in paragraph
    return `<p>${line}</p>`;
  });
  html = processedLines.join('\n');

  // Clean up empty paragraphs and nested paragraphs
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<blockquote>.*?<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>.*?<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ol>.*?<\/ol>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>.*?<\/pre>)<\/p>/gs, '$1');
  html = html.replace(/<p>(<table>.*?<\/table>)<\/p>/gs, '$1');
  html = html.replace(/<p>(<hr>)<\/p>/g, '$1');

  // XSS sanitization. Runs BEFORE code restoration (audit-7 A5): code blocks
  // and inline codes are still %%NXM%%CODEBLOCKnofN%%/%%NXM%%INLINECODEnofN%%
  // placeholders, so the on* attribute regex can never consume `onerror=`
  // TEXT inside code (a code block restored earlier was corrupted: the
  // greedy `[^\s>]+` swallowed the handler text AND the `</code>` closer).
  // Raw HTML authored in the body is still present in the string at this
  // point, so its on* attributes are stripped exactly as before. Restored
  // markup is renderer-emitted and escaped: nothing left for the allowlist
  // to strip. The tokens carry a rare %%NXM%% prefix (audit-7 B3, task-161):
  // authored text containing the legacy %%CODEBLOCK0%% spellings can no
  // longer collide with real placeholders: String.replace swaps only the
  // first occurrence of a token, so literal token-like text used to be
  // restored (and the real placeholder left raw) whenever a real element
  // existed. `%` is inert across every pipeline regex, the %% start keeps
  // the paragraph-wrap skip (trimmed.startsWith('%%')) working, and the
  // UL/OL strip patterns cannot match the prefixed tokens.
  html = sanitizeHtml(html);

  // Restore code blocks (copy button added programmatically by setupCopyButtons) - must happen after paragraph processing
  codeBlocks.forEach((block, index) => {
    // Attribute context (audit-18 2.1): the language class interpolates
    // inside a quoted attribute: escapeAttr (quote-encoding) is the
    // correct layer; escapeHtml leaves quotes literal.
    const langClass = block.lang ? ` class="language-${escapeAttr(block.lang)}"` : '';
    const escapedCode = escapeHtml(block.code);
    const codeBlock = `<pre><code${langClass}>${escapedCode}</code></pre>`;
    // Function replacer: a STRING replacement would re-interpret $-patterns
    // ($$, $&, $`, $') inside restored code (e.g. `$x$` backticked text,
    // task-231) and corrupt it; a function's return value is verbatim.
    html = html.replace(`%%NXM%%CODEBLOCK${index}of${codeBlockCount}%%`, () => codeBlock);
  });

  // Restore inline code
  inlineCodes.forEach((code, index) => {
    // Function replacer: same $-pattern guard as the code blocks above.
    html = html.replace(`%%NXM%%INLINECODE${index}of${inlineCodeCount}%%`, () => `<code>${escapeHtml(code)}</code>`);
  });

  // Restore images
  images.forEach((img, index) => {
    // Attribute context (audit-18 2.1): alt interpolates inside a quoted
    // attribute: escapeAttr encodes quotes so a hostile alt cannot break
    // out into a live on* attribute at the string layer.
    const escapedAlt = escapeAttr(img.alt);
    // Sanitize src - shared protocol strip (audit-5 M6: javascript:/data:/
    // vbscript: + %3A variants). Links already strip at restoration; images
    // did not: the sanitizeHtml global remove covers only the literal
    // javascript:/data: spellings, so vbscript: and %3A-encoded colons
    // survived in img srcs. The stripped remainder is a plain relative/inert
    // src (link parity). A src stripped to empty emits src="" (deterministic
    // and inert; the img element and alt text stay: no dropped attribute).
    // Image-only carve-out (audit-8 B2): data:image/* is a safe, CSP-allowed
    // inline image transport (img-src data:): it bypasses the strip
    // verbatim (case-insensitive guard). All other data: types and every
    // link href keep the full strip.
    // INVARIANT (audit-9 MS-4): data:image/ is allowed for img srcs ONLY :
    // never extend this carve-out to iframe/object/embed; inline data in an
    // embedding element would become executable content under their CSP
    // directives (frame-src/object-src), unlike inert image data.
    const isInlineImage = /^data:image\//i.test(img.src.trim());
    const safeSrc = isInlineImage ? img.src : stripUnsafeProtocol(img.src);
    // Scheme-less (relative) authored srcs resolve against the app base
    // (task-171, Phase 5C rejection 3.2): a relative src emitted as-is
    // resolves against the DEEP page URL (/post/.../src/assets/x.jpg → 404
    // shell → broken image): the task-127 bug family for AUTHORED image
    // srcs (content fetches and the photo probe were already base-prefixed;
    // markdown image srcs were not). Absolute http(s), protocol-relative
    // (//) and data:image/* pass through unchanged (external is
    // CSP-blocked by design; data:image allowed). A leading './' dot
    // segment is normalized away (a base-prefixed path never needs it). A
    // leading '/' (site-relative, task-279 AC1) is also normalized away:
    // passed through verbatim, resolveAppPath would emit base('/') +
    // '/src/...' = '//src/...': protocol-relative, resolving against an
    // external host and blocked by CSP img-src 'self'. Both
    // `/src/assets/x.png` and `src/assets/x.png` then resolve at root AND
    // subpath deployments. A src stripped to empty keeps src=""
    // (deterministic inert contract).
    const isScheme = /^[a-z][a-z0-9+.-]*:/i.test(safeSrc);
    const isProtocolRelative = safeSrc.startsWith('//');
    const resolvedSrc = (isScheme || isProtocolRelative || safeSrc === '')
      ? safeSrc
      : resolveAppPath(safeSrc.replace(/^\.\//, '').replace(/^\//, ''));
    // Attribute context (audit-18 2.1): src interpolates inside a quoted
    // attribute - escapeAttr (same protocol-stripped value, quotes encoded).
    const escapedSrc = escapeAttr(resolvedSrc);
    // Function replacer: $-pattern guard: alt text may hold backticked
    // math (e.g. `` `$x^2$` ``), and a string replacement would re-interpret
    // the $` sequence as the "before-match" pattern.
    html = html.replace(`%%NXM%%IMAGE${index}of${imageCount}%%`, () => `<img src="${escapedSrc}" alt="${escapedAlt}" loading="lazy">`);
  });

  // Restore links
  links.forEach((link, index) => {
    // Sanitize href - shared protocol strip (audit-2 M3: javascript:/data:/vbscript:)
    const href = stripUnsafeProtocol(link.href);
    // Legacy hash-prefixed internal links (task-124: pre-B1 hash-routed
    // post links authored in content) normalize to real paths: the
    // pathname router intercepts root-relative hrefs only, so a bare
    // hash-prefixed fragment would be inert.
    const realPathHref = href.replace(/^#\//, '/');

    const escapedText = escapeHtml(link.text);
    // Attribute context (audit-18 2.1): href interpolates inside a quoted
    // attribute: escapeAttr encodes quotes so a hostile href cannot break
    // out into a live on* attribute at the string layer.
    const escapedHref = escapeAttr(realPathHref);
    // External links (http/https and protocol-relative //) open in a NEW
    // tab: target="_blank" demands rel="noopener noreferrer"
    // (reverse-tabnabbing): the same pattern the site's footer links use.
    // Internal root-relative links keep the same-tab SPA navigation (the
    // router intercepts them); mailto:/tel:/scheme-less relative hrefs get
    // no target. The attributes are static constants: href/text escaping
    // unchanged (no interpolation). Raw HTML anchors authored in the body
    // pass through the allowlist unchanged: only markdown link syntax gets
    // the external treatment (raw markup stays author-controlled).
    const isExternal = /^https?:\/\//i.test(realPathHref) || realPathHref.startsWith('//');
    const newTabAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    // Function replacer: $-pattern guard: link text may hold backticked
    // math (`` `$x^2$` ``), and a string replacement would re-interpret the
    // $` sequence as the "before-match" pattern and eat it.
    html = html.replace(`%%NXM%%LINK${index}of${linkCount}%%`, () => `<a href="${escapedHref}"${newTabAttr}>${escapedText}</a>`);
  });

  // Restore math (task-322). Restored AFTER links/images: last in the
  // family. Each token becomes an EMPTY placeholder (span inline / div
  // display) carrying the raw LaTeX source in data-tex, escaped with
  // escapeAttr: a hostile expression cannot break out of the quoted
  // attribute (quote chars are encoded), so the source stays inert until
  // MathJax typesets it. The element is intentionally empty: no raw LaTeX
  // flashes before typesetting, and enhanceMath() owns everything that is
  // rendered inside.
  mathBlocks.forEach((block, index) => {
    const tag = block.display ? 'div' : 'span';
    const cls = block.display ? 'math-display' : 'math-tex';
    // Function replacer: $-pattern guard (same family as the other
    // restores): literal $ text inside a math expression must not be
    // re-interpreted by the string-replacement engine.
    html = html.replace(`%%NXM%%MATH${index}of${mathTotal}%%`, () => `<${tag} class="${cls}" data-tex="${escapeAttr(block.expr)}"></${tag}>`);
  });

  return html;
}

// ---------------------------------------------------------------------------
// MathJax integration (task-322). Self-hosted vendor bundle under
// src/assets/vendor/mathjax/ - no CDN, CSP script-src/font-src 'self' intact.
//
// Lazy contract: renderMarkdown emits [data-tex] placeholders; enhanceMath()
// is called AFTER content injection and does nothing when the container has
// none, so pages without math never download the ~1.3MB bundle or its CSS.
//
// CSP note: MathJax CHTML normally injects an inline <style> element and
// appends glyph/construct rules into it via CSSOM at typeset time. Under
// style-src 'self' that element is blocked and the lazy rules would be lost
// (blank glyph boxes). The SAME rules therefore ship COMPLETE as the static
// same-origin file chtml.css next to the script (base layout + every mapped
// glyph's ::before content rule + all construct rules, generated offline from
// the vendored bundle with chtml.adaptiveCSS:false - see that file's header)
// and are lazy-linked below. The blocked dynamic duplicate is inert; no
// policy relaxation was needed.
// ---------------------------------------------------------------------------

/** Root-relative paths into the vendored MathJax distribution. */
const MATHJAX_SCRIPT_PATH = 'src/assets/vendor/mathjax/tex-chtml-full.js';
const MATHJAX_CSS_PATH = 'src/assets/vendor/mathjax/chtml.css';
const MATHJAX_FONT_DIR = 'src/assets/vendor/mathjax/output/chtml/fonts/woff-v2/';

/**
 * Module-level loader state. One script injection per session, ever:
 * once a load attempt started, the promise short-circuits every later call,
 * and a failure latches so failed loads never loop network requests.
 */
let mathjaxLoadPromise = null;

/**
 * Show the escaped LaTeX source as the fallback rendering for one
 * placeholder. textContent assignment renders it inert: hostile markup in a
 * failing expression can never become live HTML. Never throws.
 * @param {HTMLElement} el - Placeholder element carrying data-tex
 */
function showMathFallback(el) {
  try {
    el.textContent = el.getAttribute('data-tex') || '';
  } catch {
    // Swallow: fallback must never break the render pipeline.
  }
}

/**
 * Make sure window.MathJax is configured and loaded exactly once.
 * The config object MUST be assigned BEFORE the script tag is appended :
 * MathJax reads window.MathJax synchronously at startup. Deliberately
 * empty tex.inlineMath/displayMath arrays disable MathJax's own text-node
 * scanning (money-safety defense-in-depth: even unextracted `$` text can
 * never trigger conversion); conversion is driven per-placeholder from the
 * data-tex attributes via tex2chtml instead.
 * @returns {Promise<Object>} Resolves with window.MathJax once ready
 */
function ensureMathJaxLoaded() {
  if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
    return window.MathJax.startup.promise.then(() => window.MathJax);
  }
  if (mathjaxLoadPromise) return mathjaxLoadPromise;

  // Config BEFORE insertion (ordering is load-bearing).
  window.MathJax = {
    loader: { load: [] },
    tex: { inlineMath: [], displayMath: [] },
    chtml: { fontURL: resolveAppPath(MATHJAX_FONT_DIR) },
    options: { enableMenu: false },
    startup: { typeset: false }
  };

  // Static same-origin stylesheet: the CHTML layout + @font-face rules.
  // Same-origin link satisfies style-src 'self'; see the CSP note above.
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = resolveAppPath(MATHJAX_CSS_PATH);

  const script = document.createElement('script');
  script.src = resolveAppPath(MATHJAX_SCRIPT_PATH);
  script.defer = true;

  mathjaxLoadPromise = new Promise((resolve, reject) => {
    script.addEventListener('load', () => {
      const startupPromise = window.MathJax && window.MathJax.startup && window.MathJax.startup.promise;
      if (startupPromise) {
        startupPromise.then(() => resolve(window.MathJax), reject);
      } else {
        reject(new Error('mathjax-startup-missing'));
      }
    });
    script.addEventListener('error', () => reject(new Error('mathjax-load-failed')));
    document.head.appendChild(cssLink);
    document.head.appendChild(script);
  });
  return mathjaxLoadPromise;
}

/**
 * Typeset the given placeholders with MathJax. Conversion-driven: each
 * placeholder's data-tex source goes through tex2chtml individually, so one
 * bad expression cannot fail the batch. Idempotent per render: elements are
 * marked data-mathjax-state="done" and never reprocessed on later calls.
 * Malformed input does NOT throw inside MathJax (it renders red literal
 * glyphs); the catch path covers load/adaptor failures and mocks.
 * @param {NodeList|HTMLElement[]} placeholders - [data-tex] elements to fill
 * @param {HTMLElement} container - Injected content root (sweep scope)
 * @returns {Promise<void>} Resolves after the scoped typeset pass settles
 */
async function typesetPlaceholders(placeholders, container) {
  placeholders.forEach((el) => {
    if (el.getAttribute('data-mathjax-state')) return;
    el.setAttribute('data-mathjax-state', 'done');
    try {
      const source = el.getAttribute('data-tex');
      const display = el.tagName === 'DIV';
      const rendered = window.MathJax.tex2chtml(source, { display });
      if (rendered && typeof rendered === 'object' && typeof rendered.nodeType === 'number') {
        // Real MathJax returns a DOM node built programmatically: insert it
        // directly (no string round-trip through the HTML parser).
        el.appendChild(rendered);
      } else if (typeof rendered === 'string') {
        // Test/mock path only: production MathJax never returns a string.
        el.innerHTML = rendered;
      } else {
        showMathFallback(el);
      }
    } catch {
      showMathFallback(el);
    }
  });
  // Scoped sweep over the injected subtree only (never the whole document).
  // Empty delimiter config makes this scan a no-op; it is kept because it is
  // the documented MathJax entry point for DOM-scoped re-typesetting.
  try {
    await window.MathJax.typesetPromise([container]);
  } catch {
    // Typeset failures leave converted nodes intact; never propagate.
  }
}

/**
 * Async math renderer: call AFTER content injection. Detects [data-tex]
 * placeholders in the container; without any, resolves immediately (zero
 * network cost for pages without math). With placeholders present, ensures
 * the self-hosted MathJax bundle is loaded exactly once and converts each
 * placeholder. On any failure the placeholders fall back to their escaped
 * source text and the failure latches (no retry loops).
 * @param {HTMLElement} container - Injected content root
 * @returns {Promise<void>} Settles when placeholders are processed
 */
export function enhanceMath(container) {
  if (!container || !container.querySelectorAll) return Promise.resolve();
  const placeholders = container.querySelectorAll('[data-tex]');
  if (placeholders.length === 0) return Promise.resolve();
  return ensureMathJaxLoaded()
    .then((mathjax) => {
      if (!mathjax || typeof mathjax.tex2chtml !== 'function') {
        throw new Error('mathjax-api-missing');
      }
      return typesetPlaceholders(placeholders, container);
    })
    .catch(() => {
      placeholders.forEach(showMathFallback);
    });
}
