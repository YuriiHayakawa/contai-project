import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  archiveAccount,
  createAccount,
  deleteAccount,
  listAccounts,
  unarchiveAccount,
  updateAccount,
} from "../services/accountsService";
import type { Account, AccountInput } from "../types";

export const accountsQueryKey = ["accounts"] as const;

interface UpdateAccountVariables {
  id: string;
  input: AccountInput;
}

/** Contas do usuário, em ordem alfabética, com o saldo de cada uma. Inclui as arquivadas. */
export function useAccounts() {
  return useQuery({ queryKey: accountsQueryKey, queryFn: listAccounts });
}

/** As contas que podem receber lançamentos novos. */
export function activeAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => !account.archived);
}

function useInvalidateAccounts(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: accountsQueryKey });
}

export function useCreateAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: (input: AccountInput) => createAccount(input),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ id, input }: UpdateAccountVariables) => updateAccount(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({ mutationFn: (id: string) => deleteAccount(id), onSuccess: invalidate });
}

export function useArchiveAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({ mutationFn: (id: string) => archiveAccount(id), onSuccess: invalidate });
}

export function useUnarchiveAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({ mutationFn: (id: string) => unarchiveAccount(id), onSuccess: invalidate });
}
