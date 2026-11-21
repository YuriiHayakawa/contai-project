import { render, screen, userEvent } from "@testing-library/react-native";

import { transaction } from "../fixtures";
import { TransactionRow } from "./TransactionRow";

const NBSP = String.fromCharCode(0xa0);
const MINUS = String.fromCharCode(0x2212);

describe("linha da lista de lançamentos", () => {
  it("despesa: tinta comum com o sinal de menos, e tudo lido de uma vez", async () => {
    const onPress = jest.fn();
    await render(
      <TransactionRow
        transaction={transaction("t1", {
          description: "iFood",
          amount_cents: 4590,
          date: "2026-03-02",
        })}
        categoryLabel="Alimentação"
        accountName="Nubank"
        onPress={onPress}
      />,
    );

    const row = screen.getByRole("button", {
      name: /^iFood, Alimentação · Nubank, .+, despesa de 45 reais e 90 centavos$/,
    });
    expect(screen.getByText(`${MINUS}R$${NBSP}45,90`)).toBeOnTheScreen();
    await userEvent.setup().press(row);
    expect(onPress).toHaveBeenCalled();
  });

  it("receita leva o sinal de mais", async () => {
    await render(
      <TransactionRow
        transaction={transaction("t2", { type: "income", amount_cents: 500000 })}
        categoryLabel="Salário"
        accountName="Nubank"
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByText(`+R$${NBSP}5.000,00`)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /receita de 5.000 reais$/ })).toBeOnTheScreen();
  });

  it("transferência e parcela aparecem como tais", async () => {
    await render(
      <>
        <TransactionRow
          transaction={transaction("t3", {
            type: "transfer",
            transfer_direction: "out",
            category_id: null,
          })}
          categoryLabel={null}
          accountName="Nubank"
          onPress={jest.fn()}
        />
        <TransactionRow
          transaction={transaction("t4", {
            installment_group_id: "g1",
            installment_number: 2,
            installment_count: 10,
          })}
          categoryLabel="Casa"
          accountName="Inter crédito"
          onPress={jest.fn()}
        />
      </>,
    );

    expect(screen.getByRole("button", { name: /Transferência · Nubank/ })).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: /Casa · Inter crédito · parcela 2 de 10/ }),
    ).toBeOnTheScreen();
  });
});
