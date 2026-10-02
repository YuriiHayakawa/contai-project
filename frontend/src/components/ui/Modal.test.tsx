import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal, type ModalProps } from "./Modal";

type ModalHarnessProps = Partial<Pick<ModalProps, "preventDismiss">>;

function ModalHarness(props: ModalHarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir</Button>
      <Modal
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        title="Novo lançamento"
        footer={<Button onClick={() => setOpen(false)}>Salvar lançamento</Button>}
      >
        <label>
          Descrição <input />
        </label>
      </Modal>
    </>
  );
}

interface ConfirmHarnessProps {
  onConfirm: () => void;
}

function ConfirmHarness({ onConfirm }: ConfirmHarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Excluir lançamento</Button>
      <ConfirmDialog
        open={open}
        title="Excluir este lançamento?"
        description="O lançamento sai da sua lista e dos totais do mês."
        confirmLabel="Excluir"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

const closed = async (): Promise<void> => {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
};

describe("Modal", () => {
  it("abre como diálogo modal com o título ligado e leva o foco para dentro", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));

    const dialog = screen.getByRole("dialog", { name: "Novo lançamento" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
  });

  it("prende o foco: Tab no último volta ao primeiro, e Shift+Tab faz o caminho inverso", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));

    const close = screen.getByRole("button", { name: "Fechar" });
    const save = screen.getByRole("button", { name: "Salvar lançamento" });

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Descrição" })).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it("fecha com Esc e devolve o foco ao elemento de origem", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);

    await user.keyboard("{Escape}");

    await closed();
    expect(opener).toHaveFocus();
  });

  it("fecha pelo botão de fechar", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));

    await user.click(screen.getByRole("button", { name: "Fechar" }));

    await closed();
  });

  it("com dados não salvos, Esc não fecha, mas o botão de fechar continua valendo", async () => {
    const user = userEvent.setup();
    render(<ModalHarness preventDismiss />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await closed();
  });

  it("trava a rolagem da página enquanto está aberto", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    await closed();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("ConfirmDialog", () => {
  const confirmDialog = (): HTMLElement =>
    screen.getByRole("alertdialog", { name: "Excluir este lançamento?" });

  it("pergunta com o objeto, diz a consequência e começa com o foco em Cancelar", async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onConfirm={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Excluir lançamento" }));

    expect(confirmDialog()).toHaveAccessibleDescription(
      "O lançamento sai da sua lista e dos totais do mês.",
    );
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("um Enter distraído cancela, e não confirma", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Excluir lançamento" }));

    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirma só pelo botão com o verbo da ação", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Excluir lançamento" }));

    await user.click(screen.getByRole("button", { name: "Excluir" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("enquanto a ação roda, não fecha nem confirma de novo", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        loading
        title="Excluir este lançamento?"
        description="O lançamento sai da sua lista e dos totais do mês."
        confirmLabel="Excluir"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("button", { name: "Excluir" })).toHaveAttribute("aria-busy", "true");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.keyboard("{Escape}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
