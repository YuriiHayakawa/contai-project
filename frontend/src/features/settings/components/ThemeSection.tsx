import { useState } from "react";

import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../../../lib/theme";
import { SettingsSection } from "./SettingsSection";

const OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "auto", label: "Automático" },
];

/** Aparência: tema Claro, Escuro ou Automático (acompanha o sistema). */
export function ThemeSection() {
  const [choice, setChoice] = useState<ThemeChoice>(() => getThemeChoice());

  const change = (next: ThemeChoice): void => {
    setChoice(next);
    setThemeChoice(next);
  };

  return (
    <SettingsSection description="No modo automático, o Contaí acompanha o tema do seu aparelho.">

      <SegmentedControl
        label="Tema"
        hideLabel
        options={OPTIONS}
        value={choice}
        onChange={change}
      />
    </SettingsSection>
  );
}
