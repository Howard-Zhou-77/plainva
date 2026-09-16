import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PropertyType } from "./propertyModel";
import { propertyNames, type PropertySuggestionSource } from "./propertySuggestions";
import { useKnownProperties } from "./usePropertySuggestions";
import { TextInput } from "../components/ui/Field";
import { Button } from "../components/ui/Button";

export function PropertyNameInput({ source, columns, registry, existing, value, onChange, onPick, onClose }:
  { source?: PropertySuggestionSource | null; columns?: Record<string, { input?: string }>; registry: Record<string, PropertyType>;
    existing: string[]; value: string; onChange: (value: string) => void;
    onPick: (name: string, type: PropertyType) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const known = useKnownProperties(source, value);
  const matches = propertyNames(known, columns, registry, existing, value);
  const [active, setActive] = useState(-1);
  const id = useId();
  return <div className="pv-property-names">
    <TextInput autoFocus compact value={value} placeholder={t("properties.namePlaceholder")}
      role="combobox" aria-label={t("properties.namePlaceholder")} aria-autocomplete="list" aria-expanded={matches.length > 0}
      aria-controls={id} aria-activedescendant={active >= 0 && matches[active] ? `${id}-${active}` : undefined}
      onChange={(e) => { onChange(e.target.value); setActive(-1); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, Math.min(matches.length - 1, a + (e.key === "ArrowDown" ? 1 : -1)))); }
        if (e.key === "Enter" && active >= 0 && matches[active]) { e.preventDefault(); onPick(matches[active].name, matches[active].input); }
      }} />
    <div id={id} role="listbox" aria-label={t("properties.existingNames")} className="pv-property-names-list">
      {matches.map((p, i) => <Button variant="ghost" key={p.name} id={`${id}-${i}`} role="option" aria-selected={active === i}
        className="pv-popover-row" onClick={() => onPick(p.name, p.input)}>
        <span>{p.name}</span><span className="pv-popover-count">{t(`properties.type_${p.input}`)} · {p.count}</span>
      </Button>)}
    </div>
  </div>;
}
