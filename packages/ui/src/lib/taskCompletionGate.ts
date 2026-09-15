import { withPathMutation } from "@plainva/core";

const scopes = new WeakMap<object, object>();
/** Serialize complete read/change/spawn actions without re-entering adapter write gates. */
export function withTaskCompletion<T>(vault: object, path: string, action: () => Promise<T>): Promise<T> {
  let scope = scopes.get(vault);
  if (!scope) { scope = {}; scopes.set(vault, scope); }
  return withPathMutation(scope, [path], action);
}
