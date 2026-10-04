import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ChatMessage, SourceTransaction } from "../types";
import { AssistantMessage } from "./AssistantMessage";

function expense(index: number, overrides: Partial<SourceTransaction> = {}): SourceTransaction {
  return {
    id: `tx-${index}`,
    type: "expense",
    date: "2026-10-03",
    description: `Mercado ${index}`,
    amount_cents: 4_590,
    ...overrides,
  };
}

function answer(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    kind: "answer",
    content: "Você gastou R$ 842,30 com Alimentação em outubro de 2026.",
    highlight: "R$ 842,30",
    transactions: [],
    transactions_total_count: 0,
    proposal: null,
    created_at: "2026-10-04T12:00:00Z",
    ...overrides,
  };
}

const marks = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(".marca-texto"));

describe("AssistantMessage", () => {
  it("o marca-texto fica só no valor principal; os demais valores usam a classe money", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({
          content:
            "Você gastou R$ 842,30 com Alimentação em outubro de 2026, contra R$ 790,10 em setembro.",
        })}
      />,
    );

    const [mark, ...others] = marks(container);
    expect(mark).toHaveTextContent("R$ 842,30");
    expect(mark).toHaveClass("money", "font-bold");
    expect(others).toHaveLength(0);

    const other = screen.getByText("R$ 790,10");
    expect(other).toHaveClass("money");
    expect(other).not.toHaveClass("marca-texto");
  });

  it("valor principal repetido no texto: só a primeira ocorrência é destacada", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({
          content: "Foram R$ 50,00 no mercado e R$ 50,00 na farmácia.",
          highlight: "R$ 50,00",
        })}
      />,
    );

    expect(marks(container)).toHaveLength(1);
    expect(screen.getAllByText("R$ 50,00")).toHaveLength(2);
    expect(container).toHaveTextContent("Foram R$ 50,00 no mercado e R$ 50,00 na farmácia.");
  });

  it("o sinal de menos entra no destaque junto com o valor", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({ content: "O saldo de outubro é −R$ 45,90.", highlight: "R$ 45,90" })}
      />,
    );

    expect(marks(container)[0]).toHaveTextContent("−R$ 45,90");
  });

  it("resposta sem valor principal não tem destaque", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({
          kind: "clarification",
          content: "Não encontrei a categoria Viagens. Você quis dizer Lazer ou Transporte?",
          highlight: null,
        })}
      />,
    );

    expect(marks(container)).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "De onde veio esse número" })).toBeNull();
  });

  it("o destaque só é pintado com movimento na resposta que acabou de chegar", () => {
    const { container, rerender } = render(<AssistantMessage message={answer({})} />);
    expect(marks(container)[0]).not.toHaveClass("before:animate-paint");

    rerender(<AssistantMessage message={answer({})} fresh />);
    expect(marks(container)[0]).toHaveClass("before:animate-paint");
  });

  it('"De onde veio esse número" mostra até 5 transações e "Ver todas" abre a lista completa', async () => {
    const user = userEvent.setup();
    render(
      <AssistantMessage
        message={answer({
          transactions: Array.from({ length: 8 }, (_, index) => expense(index + 1)),
          transactions_total_count: 23,
        })}
      />,
    );

    const block = screen.getByRole("region", { name: "De onde veio esse número" });
    expect(within(block).getAllByRole("listitem")).toHaveLength(5);
    expect(block).toHaveTextContent("Mercado 5");
    expect(block).not.toHaveTextContent("Mercado 6");

    const all = within(block).getByRole("button", { name: "Ver todas as 23" });
    expect(all).toHaveAttribute("aria-expanded", "false");
    await user.click(all);

    expect(within(block).getAllByRole("listitem")).toHaveLength(8);
    // A resposta traz no máximo 50 transações: o bloco diz quantas das 23 estão na tela.
    expect(block).toHaveTextContent("Mostrando 8 de 23.");
    expect(within(block).getByRole("button", { name: "Ver menos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it('com 5 transações ou menos, o bloco não tem "Ver todas"', () => {
    render(
      <AssistantMessage
        message={answer({
          transactions: [
            expense(1),
            expense(2, { type: "income", description: "Reembolso", amount_cents: 1_200 }),
          ],
          transactions_total_count: 2,
        })}
      />,
    );

    const block = screen.getByRole("region", { name: "De onde veio esse número" });
    const [first, second] = within(block).getAllByRole("listitem");
    expect(first).toHaveTextContent("3 de out.");
    expect(first).toHaveTextContent("Mercado 1");
    // Despesa com − e receita com +: a cor nunca é o único sinal.
    expect(first).toHaveTextContent("−R$ 45,90");
    expect(second).toHaveTextContent("+R$ 12,00");
    expect(within(block).queryByRole("button")).toBeNull();
  });
});
