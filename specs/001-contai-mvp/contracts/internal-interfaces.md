# Contrato: interfaces internas plugáveis

**Feature**: [spec.md](../spec.md) | **Research**: [research.md](../research.md)

A constituição exige duas interfaces estáveis: a dos importadores (Princípio III) e a do
provedor de IA (Princípio VI). Este documento fixa o formato delas; os nomes exatos dos tipos
podem ser ajustados na implementação, desde que as responsabilidades se mantenham.

## Importador

Cada importador vive em `backend/app/modules/imports/importers/` e implementa três passos.

```python
class Importer(Protocol):
    format: ImportFormat

    def detect(self, head: bytes, filename: str) -> bool:
        """Diz se este importador reconhece o arquivo, pelos primeiros bytes."""

    async def extract(self, file: StoredFile, context: ImportContext) -> RawDocument:
        """Lê o arquivo e devolve linhas brutas, o total e o saldo, quando existirem."""

    def normalize(self, raw: RawDocument, context: ImportContext) -> list[ProposedTransaction]:
        """Converte as linhas brutas em transações propostas."""
```

Regras:

- `ImportContext` traz o tipo da conta de destino, o modelo de colunas (quando houver) e o
  provedor de IA; nunca traz uma sessão de banco. Importadores não acessam o banco.
- `extract` levanta `MappingRequired` (com a prévia do cabeçalho e das primeiras linhas) quando
  um CSV ou planilha não tem modelo conhecido, e `ImportError` com um código quando o arquivo é
  ilegível ou não tem transações.
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
  informado), `LLMUnavailable` e `LLMInvalidResponse`.
- Implementações: `gemini.py` (produção) e `fake.py` (testes, com respostas roteirizadas e
  registro das chamadas recebidas). A escolha vem de `AI_PROVIDER`; os modelos, de
  `AI_MODEL_CHAT` e `AI_MODEL_EXTRACTION`.
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
