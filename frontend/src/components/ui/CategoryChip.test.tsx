import { render } from "@testing-library/react";

import { CategoryChip } from "./CategoryChip";
import {
  CATEGORY_ICON_LABELS,
  CATEGORY_ICON_NAMES,
  FALLBACK_CATEGORY_ICON,
  resolveCategoryIconName,
} from "./category-icons";

function iconClassOf(icon: string): string {
  const { container } = render(<CategoryChip color="caqui" icon={icon} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("O selo não desenhou nenhum ícone");
  return svg.getAttribute("class") ?? "";
}

describe("ícone de categoria", () => {
  it("nome conhecido continua como está", () => {
    expect(resolveCategoryIconName("utensils")).toBe("utensils");
  });

  it.each(["", "icone-que-nao-existe", "Utensils", "toString", "constructor"])(
    "nome desconhecido %j cai no ícone de reserva",
    (name) => {
      expect(resolveCategoryIconName(name)).toBe(FALLBACK_CATEGORY_ICON);
    },
  );

  it("todo ícone do conjunto tem um nome em português para a escolha", () => {
    for (const name of CATEGORY_ICON_NAMES) {
      expect(CATEGORY_ICON_LABELS[name]).toMatch(/\S/);
    }
  });
});

describe("CategoryChip", () => {
  it("desenha o ícone de reserva para um nome que o app não conhece", () => {
    expect(iconClassOf("icone-que-nao-existe")).toBe(iconClassOf(FALLBACK_CATEGORY_ICON));
    expect(iconClassOf("icone-que-nao-existe")).not.toBe(iconClassOf("utensils"));
  });

  it("usa a cor neutra para uma cor fora da paleta", () => {
    const { container } = render(<CategoryChip color="#ff0000" icon="utensils" />);

    expect(container.firstElementChild).toHaveClass("bg-cat-ardosia");
  });
});
