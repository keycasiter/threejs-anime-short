// Explicit ownership, not a recursive scene garbage collector. No THREE dependency.
// Register either a composite factory or its resources, never both. Borrowed values
// are used normally without own(). Resources shared by assets belong to a longer-lived scope.
const owners = new WeakMap();

export function createResourceScope() {
  const identity = {}, entries = [], owned = new Map();
  let state = 'open';
  function requireOpen() {
    if (state !== 'open') throw new Error(`Resource scope is closed (${state})`);
  }
  function own(value, release) {
    requireOpen();
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) throw new TypeError('Owned resource must be an object');
    if (release !== undefined && typeof release !== 'function') throw new TypeError('Custom release must be a function');
    const method = value.dispose;
    if (release === undefined && typeof method !== 'function') throw new TypeError('Resource needs dispose() or a custom release');
    if (owned.has(value)) {
      if (owned.get(value) !== release) throw new Error('Resource already registered with a different release');
      return value;
    }
    if (owners.has(value)) throw new Error('Resource already owned by another scope; borrow it instead');
    owners.set(value, identity); owned.set(value, release);
    entries.push(() => {
      try { if (release) release(value); else method.call(value); }
      finally { owners.delete(value); }
    });
    return value;
  }
  function defer(cleanup) {
    requireOpen();
    if (typeof cleanup !== 'function') throw new TypeError('Cleanup must be a function');
    entries.push(cleanup);
  }
  function dispose() {
    if (state !== 'open') return;
    state = 'disposing'; const errors = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      try { entries[i](); } catch (error) { errors.push(error); }
    }
    entries.length = 0; owned.clear(); state = 'disposed';
    if (errors.length) throw new AggregateError(errors, 'Resource cleanup failed; all registered releases were attempted');
  }
  return {own, defer, dispose, inspect: () => ({state, owned: owned.size, cleanups: entries.length})};
}
