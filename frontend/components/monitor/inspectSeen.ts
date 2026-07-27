// Page /workflow — "has this visitor ever opened an agent node?".
//
// The single bit of onboarding state behind the click affordance: while it is
// false the graph amplifies the "inspect" cue and the coach mark shows; once
// true, both go quiet for good.
//
// It is a localStorage-backed EXTERNAL STORE read through useSyncExternalStore,
// not a useState primed in an effect: the server has no localStorage, and
// setState-in-effect both trips the React Compiler lint and costs a cascading
// render. The server snapshot answers "seen" so a returning visitor never gets
// a flash of the hint during hydration; the client snapshot takes over on the
// very first client render, so a fresh visitor still gets it immediately.

const KEY = "blaze.workflow.node-inspect-seen.v1";

const listeners = new Set<() => void>();

/** Subscribe to changes — local marks plus other tabs (`storage` event). */
export function subscribeInspectSeen(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Client snapshot. Storage disabled (private mode) ⇒ never seen, hint shows. */
export function readInspectSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Server/hydration snapshot — "seen", so returning visitors get no flash. */
export function serverInspectSeen(): boolean {
  return true;
}

/** Onboarding is over: a node was opened, or the hint was dismissed. */
export function markInspectSeen(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* storage disabled — the hint simply comes back on the next visit */
  }
  for (const listener of listeners) listener();
}
