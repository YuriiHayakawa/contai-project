import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "lucide-react";
import { useState } from "react";

import { SettingsLayout, type SettingsGroup } from "./SettingsLayout";

const groups: SettingsGroup[] = [
  { id: "perfil", label: "Perfil", icon: Settings, content: <p>Conteúdo do perfil</p> },
  { id: "seguranca", label: "Segurança", icon: Settings, content: <p>Conteúdo de segurança</p> },
];

/** O estado da aba vive na página; aqui um invólucro faz esse papel. */
function Harness() {
  const [active, setActive] = useState("perfil");
  return <SettingsLayout groups={groups} active={active} onSelect={setActive} />;
}

const tablist = (): HTMLElement =>
  screen.getByRole("tablist", { name: "Seções das configurações" });

describe("SettingsLayout", () => {
  it("mostra só o conteúdo da aba ativa", () => {
    render(<Harness />);

    expect(within(tablist()).getByRole("tab", { name: "Perfil" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Conteúdo do perfil")).toBeVisible();
    expect(screen.getByText("Conteúdo de segurança")).not.toBeVisible();
  });

  it("clicar numa aba troca a seção mostrada, sem rolar a página", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(within(tablist()).getByRole("tab", { name: "Segurança" }));

    expect(within(tablist()).getByRole("tab", { name: "Segurança" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Conteúdo de segurança")).toBeVisible();
    expect(screen.getByText("Conteúdo do perfil")).not.toBeVisible();
  });

  it("as setas do teclado trocam de aba", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab(); // foco entra na aba ativa
    expect(within(tablist()).getByRole("tab", { name: "Perfil" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");

    expect(within(tablist()).getByRole("tab", { name: "Segurança" })).toHaveFocus();
    expect(screen.getByText("Conteúdo de segurança")).toBeVisible();
  });
});
