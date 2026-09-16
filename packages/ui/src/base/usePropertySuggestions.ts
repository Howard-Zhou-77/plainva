import { useEffect, useState } from "react";
import type { KnownProperty, PropertySuggestionSource, ValueSuggestion, ValueSuggestionLoader } from "./propertySuggestions";

/** Results carry their request identity: an old note/vault never flashes while
 * the new request starts, and an unmounted editor cannot receive a late result. */
export function usePropertyValues(open: boolean, key: string, load?: ValueSuggestionLoader) {
  const [scope, setScope] = useState<{ load: ValueSuggestionLoader | undefined; key: string; all: boolean } | null>(null);
  const wholeVault = scope?.load === load && scope?.key === key && scope.all;
  const [result, setResult] = useState<{ load: ValueSuggestionLoader; key: string; all: boolean; values: ValueSuggestion[] } | null>(null);
  useEffect(() => {
    let alive = true;
    if (open && load) void Promise.resolve().then(() => load(key, wholeVault)).then((values) => {
      if (alive) setResult({ load, key, all: wholeVault, values });
    }).catch(() => { if (alive) setResult({ load, key, all: wholeVault, values: [] }); });
    return () => { alive = false; };
  }, [open, key, load, wholeVault]);
  return { values: open && result?.load === load && result?.key === key && result.all === wholeVault ? result.values : [],
    wholeVault, expand: () => setScope({ load, key, all: true }) };
}

export function useKnownProperties(source: PropertySuggestionSource | null | undefined, query: string, open = true) {
  const [result, setResult] = useState<{ source: PropertySuggestionSource; query: string; values: KnownProperty[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (open && source) void source.getKnownProperties(query).then((values) => {
        if (alive) setResult({ source, query, values });
      }).catch(() => { if (alive) setResult({ source, query, values: [] }); });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [source, query, open]);
  return open && result?.source === source && result?.query === query ? result.values : [];
}
