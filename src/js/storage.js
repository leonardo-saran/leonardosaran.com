/**
 * Storage Module - safe localStorage/sessionStorage wrappers.
 * Browsers can deny storage entirely (Safari private mode, blocked cookies,
 * storage disabled): every accessor: including reading the storage object
 * itself: may throw SecurityError. These wrappers turn any storage failure
 * into a silent null / no-op, so boot and toggles never crash.
 * Zero imports by design.
 */

/**
 * Resolve the storage object for a kind, tolerating a throwing accessor
 * (Safari private mode throws when the storage property itself is read).
 * @param {string} kind - 'local' (default) or 'session'
 * @returns {Storage|null} The storage object, or null when unavailable
 */
function resolveStorage(kind) {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch (error) {
    return null;
  }
}

/**
 * Safely read a storage entry.
 * @param {string} key - Storage key
 * @param {string} kind - 'local' (default) or 'session'
 * @returns {string|null} Stored value, or null when unavailable/missing
 */
export function safeGetItem(key, kind = 'local') {
  const storage = resolveStorage(kind);
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch (error) {
    return null;
  }
}

/**
 * Safely write a storage entry. Persistence is best-effort: when storage is
 * denied, the in-session state still applies (explicit toggles work), only
 * the persistence no-ops.
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 * @param {string} kind - 'local' (default) or 'session'
 * @returns {void} Never throws
 */
export function safeSetItem(key, value, kind = 'local') {
  const storage = resolveStorage(kind);
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch (error) {
    // Storage denied: silent no-op (no console output).
  }
}

/**
 * Safely remove a storage entry.
 * @param {string} key - Storage key
 * @param {string} kind - 'local' (default) or 'session'
 * @returns {void} Never throws
 */
export function safeRemoveItem(key, kind = 'local') {
  const storage = resolveStorage(kind);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    // Storage denied: silent no-op.
  }
}
