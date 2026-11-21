import { render, screen, userEvent } from "@testing-library/react-native";
import type { CategorySpending } from "@web/features/dashboard/types";
import { StyleSheet } from "react-native";

import { CategoryBars } from "./CategoryBars";

function spending(id: string, name: string, amount: number, percent: number): CategorySpending {
  return {
    category_id: id,
    name,
    icon: "tag",
    color: "caqui",
    amount_cents: amount,
    percent,
    subcategories: [],
  };
}

const items = [
  spending("food", "Alimentação", 84230, 34),
  spending("home", "Moradia", 42115, 17),
  spending("fun", "Lazer", 0, 0),
];

function widthOf(testID: string): string {
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style) as { width?: string };
  return style.width ?? "";
}

describe("barras de gastos por categoria", () => {
  it("vêm na ordem da API, com largura proporcional à maior", async () => {
    await render(<CategoryBars items={items} onSelect={jest.fn()} />);

    const names = screen.getAllByRole("button").map((button) => button.props.accessibilityLabel);
    expect(names[0]).toMatch(/^Alimentação/);
    expect(names[1]).toMatch(/^Moradia/);
    expect(widthOf("bar-food")).toBe("100%");
    expect(widthOf("bar-home")).toBe("50%");
  });

  it("cada barra é lida com o valor por extenso e o percentual da API", async () => {
    await render(<CategoryBars items={items} onSelect={jest.fn()} />);

    expect(
      screen.getByRole("button", { name: "Alimentação, 842 reais e 30 centavos, 34% das saídas" }),
    ).toBeOnTheScreen();
  });

  it("tocar numa categoria leva aos lançamentos dela", async () => {
    const onSelect = jest.fn();
    await render(<CategoryBars items={items} onSelect={onSelect} />);

    await userEvent.setup().press(screen.getByRole("button", { name: /^Moradia/ }));

    expect(onSelect).toHaveBeenCalledWith("home");
  });

  it("estornos maiores que o gasto aparecem a favor, sem barra", async () => {
    await render(
      <CategoryBars items={[spending("food", "Alimentação", -1000, 0)]} onSelect={jest.fn()} />,
    );

    expect(screen.getByRole("button", { name: /a seu favor, de estornos/ })).toBeOnTheScreen();
    expect(widthOf("bar-food")).toBe("0%");
  });
});
