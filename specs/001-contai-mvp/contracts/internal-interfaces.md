# Contrato: interfaces internas plugáveis

**Feature**: [spec.md](../spec.md) | **Research**: [research.md](../research.md)

A constituição exige duas interfaces estáveis: a dos importadores (Princípio III) e a do
provedor de IA (Princípio VI). Este documento fixa o formato delas; os nomes exatos dos tipos
podem ser ajustados na implementação, desde que as responsabilidades se mantenham.

## Importador

Cada importador vive em `backend/app/modules/imports/importers/` e implementa três passos.

```python
class Importer(Protocol):
    formats: frozenset[ImportFormat]
    kinds: frozenset[ImportKind]

    def detect(self, head: bytes, filename: str) -> bool:
        """Diz se este importador reconhece o arquivo, pelos primeiros bytes."""

    async def extract(self, file: StoredFile, context: ImportContext) -> RawDocument:
        """Lê o arquivo e devolve linhas brutas, o total e o saldo, quando existirem."""

    def normalize(self, raw: RawDocument, context: ImportContext) -> list[ProposedTransaction]:
        """Converte as linhas brutas em transações propostas."""
```

Regras:

- `formats` e `kinds` dizem o que o importador lê: o formato do arquivo, pelo conteúdo, e o
  que o usuário disse que ele é (`statement` ou `receipt`). Um PDF vai ao importador de extrato
  ou ao de comprovante conforme o `kind` do envio.
- `ImportContext` traz o tipo da conta de destino, os modelos de colunas do usuário (pela
  assinatura do cabeçalho) e o dia de hoje em Brasília; nunca traz uma sessão de banco.
  Importadores não acessam o banco.
- Os importadores que usam IA chamam o provedor por `app/ai/fallback.py`, com o modelo de
  extração, e devolvem em `RawDocument.ai_call` a chamada feita (tarefa, modelo que respondeu e
  tokens): quem grava em `ai_usage` é o serviço de importação. Modelo ocupado, indisponível ou
  sem cota sobe como exceção do provedor, e quem decide a nova tentativa é o job; uma resposta
  que não respeita o schema, ou que não traz lançamentos, vira `ImportFailed` com
  `document_unreadable`.
- O documento vai ao modelo só como anexo, e o prompt de sistema diz que o conteúdo dele é dado,
  e não instrução (FR-068). O schema de saída só tem data, descrição, valor e sentido de cada
  linha, e o total impresso: é tudo o que um documento consegue produzir.
- `extract` levanta `MappingRequired` (com a prévia do cabeçalho e das primeiras linhas) quando
  um CSV ou planilha não tem modelo conhecido, e `ImportFailed` com um código quando o arquivo
  é ilegível ou não tem transações. `normalize` levanta `MappingMismatch` quando o modelo de
  colunas não lê uma data ou um valor; o serviço descarta o modelo e pede o mapeamento de novo.
- `ProposedTransaction` tem `type`, `amount_cents` (inteiro, maior que zero), `date`,
  `description` e `external_id` opcional. Não tem categoria nem marca de duplicata.
- O núcleo, que é o serviço de importação, faz o que é comum a todos: escolher o importador
  pelo `detect`, normalizar descrições, calcular a impressão digital, marcar duplicatas, sugerir
  categorias, detectar pagamento de fatura, comparar totais e saldos, e gravar os `import_items`.
- Adicionar um banco ou formato é criar um arquivo novo em `importers/` e registrá-lo na lista de
  importadores; nada mais muda.

| Importador | Arquivo | Usa IA | Formatos |
|------------|---------|--------|----------|
| OFX | `ofx.py` | não | `.ofx` |
| Tabular | `tabular.py` | não | `.csv`, `.xlsx` |
| Extrato ou fatura | `statement_ai.py` | sim | PDF |
| Comprovante | `receipt_ai.py` | sim | PDF, JPG, PNG |

## Provedor de IA

Definido em `backend/app/ai/provider.py`.

```python
class LLMProvider(Protocol):
    async def chat(
        self,
        *,
        model: str,
        system: str,
        messages: list[LLMMessage],
        tools: list[ToolSpec],
    ) -> LLMChatResult:
        """Uma rodada de conversa: devolve texto ou pedidos de chamada de ferramenta."""

    async def generate_structured(
        self,
        *,
        model: str,
        system: str,
        prompt: str,
        schema: type[BaseModel],
        attachments: Sequence[Attachment] = (),
    ) -> LLMStructuredResult:
        """Gera uma resposta validada contra o schema, com anexos opcionais (PDF, imagem)."""
```

Regras:

- `LLMMessage`, `ToolSpec`, `ToolCall`, `Attachment` e `LLMUsage` são tipos próprios do projeto,
  sem nenhum tipo do SDK do fornecedor.
- Os dois resultados trazem `usage` (tokens de entrada e de saída), gravado em `ai_usage` por
  quem chamou.
- O provedor nunca executa ferramentas: ele só devolve os pedidos. Quem executa é o serviço do
  assistente, que injeta o `user_id`.
- Erros do fornecedor viram exceções próprias: `LLMRateLimited` (com o tempo de espera, quando
  informado), `LLMQuotaExhausted` (um `LLMRateLimited` em que a cota do dia acabou: repetir
  hoje não adianta), `LLMUnavailable` e `LLMInvalidResponse`.
- As regras de negócio chamam o provedor por `app/ai/fallback.py` (`chat` e
  `generate_structured`, com um `ModelChoice`): quando o modelo principal responde
  indisponível ou sem cota, a chamada tenta o modelo reserva; sem reserva configurado, um erro
  passageiro é repetido uma vez no mesmo modelo. O resultado diz qual modelo respondeu, e é ele
  que vai para `ai_usage`. O erro que sobe só é `LLMQuotaExhausted` quando a cota do dia acabou
  em todos os modelos tentados.
- Um documento anexo vai inteiro em cada chamada de `generate_structured`: uma chamada por
  documento, nunca uma por página.
- Implementações: `gemini.py` (produção) e `fake.py` (testes, com respostas roteirizadas e
  registro das chamadas recebidas). A escolha vem de `AI_PROVIDER`; os modelos, de
  `AI_MODEL_CHAT` e `AI_MODEL_EXTRACTION`, e os reservas, opcionais, de `AI_MODEL_CHAT_FALLBACK` e
  `AI_MODEL_EXTRACTION_FALLBACK`.
- Trocar de fornecedor é criar outra implementação e mudar a variável de ambiente; nenhuma regra
  de negócio muda.

## Tarefas da IA e modelo usado

| Tarefa | Operação | Modelo | Conta no limite do usuário |
|--------|----------|--------|----------------------------|
| Pergunta ao assistente | `chat` | `AI_MODEL_CHAT` | sim, como pergunta |
| Lançamento por texto | `chat` | `AI_MODEL_CHAT` | sim, como pergunta |
| Sugestão de categorias | `generate_structured` | `AI_MODEL_CHAT` | não |
| Extração de extrato ou fatura em PDF | `generate_structured` | `AI_MODEL_EXTRACTION` | sim, como extração |
| Extração de comprovante | `generate_structured` | `AI_MODEL_EXTRACTION` | sim, como extração |
