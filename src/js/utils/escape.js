/**
 * Escape HTML to prevent XSS
 * Contract: falsy inputs (null, undefined, '', 0, NaN) return '' by defense :
 * an empty string is always safe to interpolate and never renders attacker
 * text. Truthy inputs are escaped via the textContent → innerHTML serializer.
 * @param {string} html - HTML string to escape
 * @returns {string} Escaped HTML: '' for any falsy input (defensive contract)
 */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape a string for use inside a double-quoted HTML attribute value.
 * Same textContent → innerHTML technique as escapeHtml, then additionally
 * encode quotes: the text-serialization escaper leaves raw " and ' intact,
 * so an attribute interpolation could otherwise break out and let the HTML
 * parser create a live event-handler attribute.
 * Contract: falsy inputs return '' (delegated to escapeHtml's defensive guard)
 * - safe for attribute interpolation.
 * @param {string} str - String to escape
 * @returns {string} Attribute-safe escaped string: '' for any falsy input
 */
export function escapeAttr(str) {
  if (!str) return '';
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
