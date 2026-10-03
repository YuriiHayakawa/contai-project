import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { TransactionSheet } from "../components/TransactionSheet";
import type { TransactionPreset } from "../types";

export interface NewTransactionProviderProps {
  children: ReactNode;
}

/** Abre a folha de novo lançamento; com `preset`, ela já vem preenchida. */
export type OpenNewTransaction = (preset?: TransactionPreset) => void;

const NewTransactionContext = createContext<OpenNewTransaction | null>(null);

/**
 * Guarda a folha de novo lançamento em um lugar só, para qualquer tela poder abri-la: o botão
 * "Lançar", o "Novo lançamento" da barra lateral, os estados vazios e o "Pagar fatura" de um
 * cartão.
 */
export function NewTransactionProvider({ children }: NewTransactionProviderProps) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<TransactionPreset | undefined>(undefined);
  const openSheet = useCallback<OpenNewTransaction>((next) => {
    setPreset(next);
    setOpen(true);
  }, []);

  return (
    <NewTransactionContext.Provider value={openSheet}>
      {children}
      <TransactionSheet open={open} preset={preset} onClose={() => setOpen(false)} />
    </NewTransactionContext.Provider>
  );
}

/** Devolve a função que abre a folha de novo lançamento. */
export function useNewTransaction(): OpenNewTransaction {
  const openSheet = useContext(NewTransactionContext);
  if (!openSheet) {
    throw new Error("useNewTransaction precisa estar dentro de <NewTransactionProvider>.");
  }
  return openSheet;
}
