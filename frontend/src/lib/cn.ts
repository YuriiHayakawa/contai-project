type ClassValue = string | false | null | undefined;

/** Junta nomes de classe, ignorando os valores vazios de condições. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
