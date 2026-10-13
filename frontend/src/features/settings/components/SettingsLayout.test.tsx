import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "lucide-react";

import { SettingsLayout, type SettingsGroup } from "./SettingsLayout";

const groups: SettingsGroup[] = [
  { id: "perfil", label: "Perfil", icon: Settings, content: <p>Conteúdo do perfil</p> },
  { id: "seguranca", label: "Segurança", icon: Settings, content: <p>Conteúdo de segurança</p> },
];

const nav = (): HTMLElement =>
  screen.getByRole("navigation", { name: "Seções das configurações" });

beforeEach(() => {
  // O jsdom não implementa scrollIntoView; o IntersectionObserver fica ausente de propósito.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("SettingsLayout", () => {
  it("mostra a navegação e todas as seções, com a primeira marcada como ativa", () => {
    render(<SettingsLayout groups={groups} />);

    expect(within(nav()).getByRole("button", { name: "Perfil" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(nav()).getByRole("button", { name: "Segurança" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("heading", { name: "Perfil", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Segurança", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Conteúdo de segurança")).toBeInTheDocument();
  });

  it("clicar num item leva até a seção e passa a marcá-la como ativa", async () => {
    const user = userEvent.setup();
    render(<SettingsLayout groups={groups} />);

    await user.click(within(nav()).getByRole("button", { name: "Segurança" }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(within(nav()).getByRole("button", { name: "Segurança" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
