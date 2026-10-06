import { cn } from "../../lib/cn";
import { CATEGORY_FILL_CLASS, isCategoryColor } from "./category-colors";
import { CATEGORY_ICONS, resolveCategoryIconName } from "./category-icons";

export interface CategoryChipProps {
  /** Nome do token de cor guardado no banco, como `caqui`. */
  color: string;
  /** Nome do ícone guardado no banco, como `utensils`. */
  icon: string;
  /** 36px nas listas; 28px em linhas compactas. */
  size?: "md" | "sm";
  className?: string;
}

/**
 * Selo de categoria: círculo preenchido com a cor e o ícone em `--surface`. É decorativo: o
 * nome da categoria fica sempre ao lado, em `--ink`, porque a cor nunca é o único sinal.
 */
export function CategoryChip({ color, icon, size = "md", className }: CategoryChipProps) {
  const Icon = CATEGORY_ICONS[resolveCategoryIconName(icon)];
  const fill = CATEGORY_FILL_CLASS[isCategoryColor(color) ? color : "ardosia"];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-surface",
        fill,
        size === "md" ? "size-9" : "size-7",
        className,
      )}
    >
      <Icon className={size === "md" ? "size-4.5" : "size-3.5"} />
    </span>
  );
}
