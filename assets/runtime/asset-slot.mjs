import {createResourceScope} from './resource-scope.mjs';

/** Synchronous build -> validate -> mount -> commit -> retire.
 * builder(scope) returns a handle with an independent, detached Object3D root.
 * The builder explicitly registers owned resources/factories; the slot owns mounting.
 * Build/mount failure retains the previous asset. Retirement errors are reported
 * AFTER commit: current/revision then refer to the new, live asset.
 * Shared materials, renderer and camera are borrowed. No resource-tree traversal,
 * asynchronous cancellation, dependency inference or geometry repair is performed.
 */
export function createAssetSlot(parent) {
  if (!parent?.isObject3D) throw new TypeError('Asset slot requires an Object3D parent');
  let active = null, revision = 0, busy = false, disposed = false;
  function replace(builder) {
    if (disposed) throw new Error('Asset slot is disposed');
    if (busy) throw new Error('Asset replacement is already in progress');
    if (typeof builder !== 'function' || builder.constructor?.name === 'AsyncFunction') throw new TypeError('A synchronous builder is required');
    busy = true; const candidateScope = createResourceScope();
    let handle;
    try {
      try {
        handle = builder(candidateScope);
        if (handle && typeof handle.then === 'function') throw new TypeError('Asset builder must be synchronous');
        const root = handle?.root;
        if (!root?.isObject3D) throw new TypeError('Asset handle needs an Object3D root');
        if (root.parent) throw new Error('Candidate root already has a parent; build a detached root');
        for (let node = parent; node; node = node.parent) if (node === root) throw new Error('Candidate root would create a parent cycle');
        // Once accepted, the detached candidate is ours to unmount, even when an
        // added listener moves it elsewhere before throwing. Never leave dead meshes.
        candidateScope.defer(() => root.removeFromParent());
        parent.add(root);
        if (root.parent !== parent) throw new Error('Mount callback changed the candidate parent');
      } catch (error) {
        try { candidateScope.dispose(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Candidate build failed and cleanup reported errors'); }
        throw error;
      }
      const previous = active;
      active = {handle, scope: candidateScope}; revision++;
      // Commit precedes retirement. A cleanup exception must not roll back to dead resources.
      previous?.scope.dispose();
      return handle;
    } finally { busy = false; }
  }
  function dispose() {
    if (disposed) return;
    if (busy) throw new Error('Cannot dispose during asset replacement');
    disposed = true; const previous = active; active = null;
    previous?.scope.dispose();
  }
  return {replace, dispose, get current() { return active?.handle ?? null; }, get revision() { return revision; }};
}
