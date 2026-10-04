// Chamadas HTTP de importações. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type { ColumnMapping, ConfirmItem, Import, ImportPage } from "../types";

/** Envia o arquivo de um extrato para a conta escolhida; a leitura segue em segundo plano. */
export function uploadImport(file: File, accountId: string): Promise<Import> {
  const body = new FormData();
  body.append("file", file);
  body.append("account_id", accountId);
  body.append("kind", "statement");
  return api.post<Import>("/imports", body);
}

/** Uma página do histórico, da importação mais nova para a mais antiga. */
export function listImports(cursor: string | null, signal?: AbortSignal): Promise<ImportPage> {
  return api.get<ImportPage>("/imports", { params: { cursor }, signal });
}

/** A importação, com a prévia das colunas ou as linhas da revisão, conforme o estado. */
export function getImport(id: string, signal?: AbortSignal): Promise<Import> {
  return api.get<Import>(`/imports/${id}`, { signal });
}

/** Diz quais colunas são data, descrição e valor; a importação volta para a fila. */
export function submitMapping(id: string, mapping: ColumnMapping): Promise<Import> {
  return api.post<Import>(`/imports/${id}/mapping`, mapping);
}

/** Salva as linhas marcadas, com as correções: tudo de uma vez, ou nada. */
export function confirmImport(id: string, items: ConfirmItem[]): Promise<Import> {
  return api.post<Import>(`/imports/${id}/confirm`, { items });
}

/** Remove, de uma vez, todos os lançamentos que a importação criou. */
export function undoImport(id: string): Promise<Import> {
  return api.post<Import>(`/imports/${id}/undo`);
}

/** Descarta uma importação que ainda não foi confirmada. */
export function discardImport(id: string): Promise<void> {
  return api.delete(`/imports/${id}`);
}
