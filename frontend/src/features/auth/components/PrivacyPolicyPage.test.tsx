import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { PrivacyPolicyPage } from "./PrivacyPolicyPage";

function renderPage() {
  render(
    <MemoryRouter>
      <PrivacyPolicyPage />
    </MemoryRouter>,
  );
}

describe("PrivacyPolicyPage", () => {
  it("mostra a versão 4", () => {
    renderPage();

    expect(screen.getByText(/^Versão 4, de/)).toBeInTheDocument();
  });

  it("explica o lançamento por voz: Siri, frase guardada e IA", () => {
    renderPage();

    expect(
      screen.getByText(/a sua voz é reconhecida pela Siri, da Apple, no seu iPhone/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A frase que a Siri entendeu fica guardada junto com o lançamento/),
    ).toBeInTheDocument();
    expect(screen.getByText(/fale só o gasto, sem informações pessoais/)).toBeInTheDocument();
    expect(screen.getByText(/é apagada junto com o lançamento ou com a conta/)).toBeInTheDocument();
    expect(screen.getByText(/O token de cada um fica embaralhado/)).toBeInTheDocument();
  });
});
