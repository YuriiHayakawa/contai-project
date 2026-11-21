import { focusManager } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

import { ApiError } from "./api-client";
import { bindAppFocus, shouldRetry } from "./query-client";

function apiError(status: number): ApiError {
  return new ApiError({ status, code: "x", message: "x" });
}

describe("cache de consultas", () => {
  it.each([401, 403, 404, 422])("não repete uma resposta %i", (status) => {
    expect(shouldRetry(0, apiError(status))).toBe(false);
  });

  it("repete falha de rede e erro do servidor até duas vezes", () => {
    expect(shouldRetry(0, apiError(0))).toBe(true);
    expect(shouldRetry(1, apiError(503))).toBe(true);
    expect(shouldRetry(2, apiError(503))).toBe(false);
  });

  it("considera foco a volta do app para a frente", () => {
    let onChange: (status: AppStateStatus) => void = () => undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onChange = listener;
      return { remove: jest.fn() };
    });
    bindAppFocus();
    focusManager.setFocused(undefined);
    // O TanStack Query só chama o ouvinte depois que alguém se inscreve no foco.
    const unsubscribe = focusManager.subscribe(() => undefined);

    onChange("background");
    expect(focusManager.isFocused()).toBe(false);
    onChange("active");
    expect(focusManager.isFocused()).toBe(true);

    unsubscribe();
  });
});
