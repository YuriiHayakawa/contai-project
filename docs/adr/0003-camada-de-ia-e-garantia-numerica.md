# ADR 0003: camada de IA e garantia numérica das respostas

- **Situação**: aceito
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seções 18 e 19; constituição, Princípios VI
  e VII; FR-062, SC-005, SC-010

## Contexto

Várias funções usam um LLM (chat, sugestão de categoria, lançamento por texto, extração de PDF e
imagem). A constituição exige que toda chamada passe por uma camada própria com limites de uso, e
que o backend mantenha o controle de cada chamada de ferramenta (onde o `user_id` é injetado).
Além disso, um assistente financeiro não pode inventar números.

## Decisão

- Interface `LLMProvider` com duas operações: conversa com ferramentas e geração estruturada com
  anexos opcionais, com tipos próprios e neutros de mensagem, chamada de ferramenta e uso de
  tokens. `gemini.py` usa o SDK `google-genai` em modo assíncrono, com a execução automática de
  funções **desligada**; `fake.py` devolve respostas roteirizadas nos testes.
- Dois modelos por variável de ambiente (`AI_MODEL_CHAT`, `AI_MODEL_EXTRACTION`), com reservas
  opcionais. Toda chamada grava `AiUsage`. Limites diários por usuário (30 perguntas, 10
  extrações), contados no fuso de Brasília.
- Erros do provedor viram exceções próprias: indisponibilidade e cota tentam o modelo reserva (ou
  repetem uma vez); a cota do dia (`LLMQuotaExhausted`) não é repetida e vira `429
  ai_quota_exhausted`.
- **Garantia numérica**: as ferramentas devolvem cada valor em centavos e já formatado, com as
  diferenças e percentuais calculados. Todo valor monetário e percentual presente no texto do
  modelo precisa existir nos resultados das ferramentas daquela rodada; se não existir, o backend
  pede a resposta de novo uma vez e, se falhar, monta a resposta por modelo de texto fixo a partir
  dos resultados. Um único serviço de relatórios (módulo `dashboard`) alimenta o painel e as
  ferramentas, para os números baterem (FR-062, SC-010).
- Só descrições de transação e nomes de categoria vão à IA; nunca a senha, dados de acesso ou o
  histórico completo (Princípio VII).

## Alternativas rejeitadas

- **Bibliotecas de orquestração de LLM**: abstração de terceiros no lugar de uma interface de
  duas operações; a execução automática de funções tiraria do backend o controle do `user_id`.
- **Confiar no número que o modelo escreve**: sem a conferência contra as ferramentas, o
  assistente poderia apresentar valores inventados.

## Consequências

- O modelo nunca faz conta de datas nem de dinheiro: períodos são símbolos resolvidos pelo
  backend, e os números vêm das ferramentas.
- A camada `fake` deixa toda a lógica testável sem rede e sem gastar a cota gratuita.
- A conferência numérica pode, no pior caso, trocar a redação do modelo por um texto fixo — uma
  resposta correta, ainda que menos fluida.
