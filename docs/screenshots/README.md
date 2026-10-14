# Capturas de tela

As imagens referenciadas pelo [README](../../README.md) ficam aqui. Elas **não** são geradas
automaticamente neste ambiente (não há navegador com interface gráfica), então precisam ser
capturadas à mão e adicionadas a esta pasta.

## O que capturar

Com o app rodando (`docker compose up`) e, de preferência, com os dados de demonstração
(`docker compose run --rm api python -m scripts.seed_demo`), capture em **tema claro** e largura de
desktop:

| Arquivo | Tela | Como chegar |
|---------|------|-------------|
| `painel.png` | Painel | página inicial, após entrar |
| `lancamentos.png` | Lançamentos | menu "Lançamentos" |
| `importacao-revisao.png` | Revisão da importação | enviar um extrato e abrir a revisão |
| `assistente.png` | Assistente | menu "Assistente", com uma pergunta respondida |
| `configuracoes.png` | Configurações | menu "Configurações" |

Dicas:

- Use uma janela de ~1280px de largura e exporte em PNG.
- Evite dados reais: o usuário de demonstração já tem dados fictícios.
- Se quiser mostrar o tema escuro, adicione variantes com sufixo `-escuro.png` e referencie-as no
  README.
