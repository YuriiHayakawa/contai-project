import { type ISODate, addDays, today } from "@web/lib/dates";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { space } from "@/theme/tokens";

/** "2026-11-03" vira "03/11/2026". */
export function toBrDate(iso: ISODate): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

/** "03/11/2026" vira "2026-11-03"; uma data que não existe, como 31/02, vira "". */
export function fromBrDate(text: string): ISODate | "" {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const iso = `${year}-${month}-${day}`;
  return date.toISOString().slice(0, 10) === iso ? iso : "";
}

/** Põe as barras enquanto a pessoa digita só os algarismos: "03112026" vira "03/11/2026". */
function maskBrDate(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join("/");
}

export interface DateFieldProps {
  value: ISODate;
  onChange: (value: ISODate | "") => void;
  error?: string;
}

/** Data do lançamento, com "Hoje" e "Ontem" a um toque; hoje é sempre o de Brasília. */
export function DateField({ value, onChange, error }: DateFieldProps) {
  const [text, setText] = useState(() => toBrDate(value));
  const [shownValue, setShownValue] = useState(value);

  // O valor mudou por fora (um lançamento carregado, por exemplo): o texto acompanha. É o ajuste
  // de estado durante a renderização que o React recomenda, sem efeito.
  if (value !== shownValue) {
    setShownValue(value);
    if (value && fromBrDate(text) !== value) setText(toBrDate(value));
  }

  const choose = (iso: ISODate): void => {
    setText(toBrDate(iso));
    onChange(iso);
  };

  return (
    <View style={styles.wrapper}>
      <TextField
        label="Data"
        help="Dia, mês e ano."
        error={error}
        value={text}
        keyboardType="number-pad"
        maxLength={10}
        onChangeText={(typed) => {
          const masked = maskBrDate(typed);
          setText(masked);
          onChange(fromBrDate(masked));
        }}
      />
      <View style={styles.shortcuts}>
        <Button compact variant="secondary" label="Hoje" onPress={() => choose(today())} />
        <Button
          compact
          variant="secondary"
          label="Ontem"
          onPress={() => choose(addDays(today(), -1))}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space[2] },
  shortcuts: { flexDirection: "row", gap: space[2] },
});
