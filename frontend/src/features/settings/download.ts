/** Faz o navegador baixar o ZIP recebido, com um nome que traz a data de hoje. */
export function downloadZip(blob: Blob): void {
  const today = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `contai-dados-${today}.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
