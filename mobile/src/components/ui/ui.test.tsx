import { act, render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { MoneyInput } from "./MoneyInput";
import { MoneyText } from "./MoneyText";
import { TextField } from "./TextField";
import { ToastProvider, useToast } from "./Toast";

const NBSP = String.fromCharCode(0xa0);

function minHeightOf(element: { props: { style?: unknown } }): number {
  const style = StyleSheet.flatten(element.props.style as never) as { minHeight?: number };
  return style.minHeight ?? 0;
}

describe("componentes base", () => {
  it("botão: papel, rótulo, área de toque e estado ocupado", async () => {
    const onPress = jest.fn();
    await render(<Button label="Salvar lançamento" onPress={onPress} loading />);

    const button = screen.getByRole("button", { name: "Salvar lançamento" });
    expect(minHeightOf(button)).toBeGreaterThanOrEqual(44);
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
  });

  it("botão compacto ainda tem 44 pt de toque", async () => {
    await render(<Button label="Encerrar" compact onPress={jest.fn()} />);

    expect(minHeightOf(screen.getByRole("button", { name: "Encerrar" }))).toBe(44);
  });

  it("campo de texto: rótulo visível, opcional e erro lido depois do rótulo", async () => {
    await render(
      <TextField
        label="Descrição"
        optional
        value=""
        onChangeText={jest.fn()}
        error="Escreva uma descrição curta."
      />,
    );

    expect(screen.getByText("Descrição (opcional)")).toBeOnTheScreen();
    const input = screen.getByLabelText("Descrição (opcional)");
    expect(input.props.accessibilityHint).toBe("Escreva uma descrição curta.");
    expect(screen.getByText("Escreva uma descrição curta.")).toBeOnTheScreen();
  });

  it("campo de senha mostra e oculta a senha", async () => {
    const user = userEvent.setup();
    await render(<TextField label="Senha" password value="segredo" onChangeText={jest.fn()} />);

    expect(screen.getByLabelText("Senha").props.secureTextEntry).toBe(true);
    await user.press(screen.getByRole("button", { name: "Mostrar a senha" }));
    expect(screen.getByLabelText("Senha").props.secureTextEntry).toBe(false);
    expect(screen.getByRole("button", { name: "Ocultar a senha" })).toBeOnTheScreen();
  });

  it("valor em reais: formato do site e leitura por extenso", async () => {
    await render(<MoneyText cents={4590} />);

    const value = screen.getByText(`R$${NBSP}45,90`);
    expect(value.props.accessibilityLabel).toBe("45 reais e 90 centavos");
    expect(screen.getByLabelText("45 reais e 90 centavos")).toBeOnTheScreen();
  });

  it("campo de dinheiro digita como caixa registradora", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [cents, setCents] = useState(0);
      return <MoneyInput value={cents} onChange={setCents} />;
    }
    await render(<Harness />);

    const input = screen.getByLabelText("Valor em reais");
    await user.type(input, "4590");

    expect(input.props.value).toBe("45,90");
    expect(input.props.accessibilityValue).toEqual({ text: "45 reais e 90 centavos" });
  });

  it("estados de carregamento, erro e vazio dizem o que acontece e o que fazer", async () => {
    const retry = jest.fn();
    const user = userEvent.setup();
    await render(
      <>
        <LoadingState message="Carregando os lançamentos…" />
        <ErrorState message="Confira sua conexão e tente de novo." onRetry={retry} />
        <EmptyState
          title="Nenhum lançamento neste mês"
          description="Lance o primeiro gasto."
          actionLabel="Lançar"
          onAction={jest.fn()}
        />
      </>,
    );

    expect(screen.getByLabelText("Carregando os lançamentos…")).toBeOnTheScreen();
    expect(screen.getByRole("alert")).toHaveTextContent(/Confira sua conexão/);
    await user.press(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole("header", { name: "Nenhum lançamento neste mês" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Lançar" })).toBeOnTheScreen();
  });

  it("confirmação tem o verbo da ação e Cancelar", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(
      <ConfirmDialog
        open
        title="Excluir este lançamento?"
        description="Ele sai do mês e do saldo da conta."
        confirmLabel="Excluir"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("header", { name: "Excluir este lançamento?" })).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalled();
    await user.press(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("toast", () => {
  function Trigger({ withAction }: { withAction: () => void }) {
    const toast = useToast();
    return (
      <Button
        label="Avisar"
        onPress={() =>
          toast.show({
            message: "Lançamento desfeito.",
            action: { label: "Refazer", onPress: withAction },
            durationMs: 10_000,
          })
        }
      />
    );
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("anuncia ao VoiceOver, oferece a ação e some no tempo pedido", async () => {
    jest.useFakeTimers();
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const redo = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(
      <ToastProvider>
        <Trigger withAction={redo} />
      </ToastProvider>,
    );

    await user.press(screen.getByRole("button", { name: "Avisar" }));

    expect(announce).toHaveBeenCalledWith("Lançamento desfeito. Refazer disponível.");
    expect(screen.getByRole("button", { name: "Refazer" })).toBeOnTheScreen();
    expect(minHeightOf(screen.getByRole("button", { name: "Fechar aviso" }))).toBe(44);

    await act(() => jest.advanceTimersByTimeAsync(9_000));
    expect(screen.getByText("Lançamento desfeito.")).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByText("Lançamento desfeito.")).not.toBeOnTheScreen();
  });

  it("a ação roda e fecha o aviso", async () => {
    const redo = jest.fn();
    const user = userEvent.setup();
    await render(
      <ToastProvider>
        <Trigger withAction={redo} />
      </ToastProvider>,
    );
    await user.press(screen.getByRole("button", { name: "Avisar" }));

    await user.press(screen.getByRole("button", { name: "Refazer" }));

    expect(redo).toHaveBeenCalled();
    expect(screen.queryByText("Lançamento desfeito.")).not.toBeOnTheScreen();
  });
});
