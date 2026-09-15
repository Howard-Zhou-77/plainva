import { useCallback, useSyncExternalStore } from "react";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Observed by the current sideband; no credentials or comment contents. */
export function setForeignLegacyComments(vaultKey: string, count: number): void {
  if (counts.get(vaultKey) === count) return;
  counts.delete(vaultKey);
  counts.set(vaultKey, count);
  while (counts.size > 32) counts.delete(counts.keys().next().value!);
  for (const listener of listeners) listener();
}

export function useForeignLegacyComments(vaultKey: string | null | undefined): number {
  const snapshot = useCallback(() => vaultKey ? counts.get(vaultKey) ?? 0 : 0, [vaultKey]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
