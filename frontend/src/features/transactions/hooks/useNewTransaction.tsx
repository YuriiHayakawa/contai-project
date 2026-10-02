import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { TransactionSheet } from "../components/TransactionSheet";

export interface NewTransactionProviderProps {
  children: ReactNode;
}

const NewTransactionContext = createContext<(() => void) | null>(null);

/**
 * Guarda a folha de novo lançamento em um lugar só, para qualquer tela poder abri-la: o botão
 * "Lançar", o "Novo lançamento" da barra lateral e os estados vazios.
 */
export function NewTransactionProvider({ children }: NewTransactionProviderProps) {
  const [open, setOpen] = useState(false);
  const openSheet = useCallback(() => setOpen(true), []);

  return (
    <NewTransactionContext.Provider value={openSheet}>
      {children}
      <TransactionSheet open={open} onClose={() => setOpen(false)} />
    </NewTransactionContext.Provider>
  );
}

/** Devolve a função que abre a folha de novo lançamento. */
export function useNewTransaction(): () => void {
  const openSheet = useContext(NewTransactionContext);
  if (!openSheet) {
    throw new Error("useNewTransaction precisa estar dentro de <NewTransactionProvider>.");
  }
  return openSheet;
}
