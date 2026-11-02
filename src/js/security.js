export function stripUnsafeProtocol(href) {
  if (typeof href !== 'string') return '';
  // Normalize ASCII tab/newline/CR BEFORE the scheme regex: the URL parser
  // strips them before scheme detection, so jav\nascript: is treated
  // exactly like javascript:.
  const normalized = href.replace(/[\t\n\r]/g, '');
  // Repeat the anchored strip: stacked payloads (javascript:javascript:)
  // must shed EVERY leading unsafe scheme. A single replace cannot re-match
  // after the first removal: ^ only matches at index 0 without the
  // multiline flag - so the anchored pass repeats until nothing remains.
  let stripped = normalized;
  while (true) {
    const next = stripped.replace(/^\s*(?:javascript|data|vbscript)\s*(?::|%3a)/i, '');
    if (next === stripped) return stripped;
    stripped = next;
  }
}

export function isSafeHrefValue(value) {
  if (typeof value !== 'string') return false;
  // Normalize ASCII tab/newline/CR BEFORE the scheme regexes: uniform with
  // the DOM-level normalization applied after rendering. Then neutralize
  // percent-encoded colons (%3a/%3A) BEFORE the scheme test:
  // without it, `javascript%3aalert(1)` parses as scheme-less and passes :
  // asymmetric with stripUnsafeProtocol (which strips (?::|%3a)). With the
  // colon explicit the unsafe scheme is rejected; allowlisted schemes
  // (http/https/mailto/tel) and scheme-less relative values are unchanged.
  const normalized = value.replace(/[\t\n\r]/g, '').replace(/%3a/gi, ':').trim();
  if (normalized === '') return false;
  return /^(https?:|mailto:|tel:)/i.test(normalized) || !/^[a-z][a-z0-9+.-]*:/i.test(normalized);
}
