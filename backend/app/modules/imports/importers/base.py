"""Contrato dos importadores (contracts/internal-interfaces.md).

Um importador reconhece o arquivo (`detect`), lê as linhas brutas (`extract`) e as converte em
transações propostas (`normalize`). Ele não acessa o banco, não sugere categoria e não marca
duplicata: isso é comum a todos os formatos e fica no serviço de importação.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from app.ai.models import AiTask
from app.ai.provider import LLMUsage
from app.modules.accounts.models import AccountType
from app.modules.imports.mapping import ColumnMapping, MappingPreview
from app.modules.imports.models import ImportFormat, ImportKind
from app.modules.imports.storage import StoredFile
from app.modules.transactions.models import TransactionType
from app.modules.transactions.normalize import strip_accents

# Códigos de falha: vão para `imports.error_code` e viram a mensagem que o usuário lê.
UNREADABLE = "unreadable"
NO_TRANSACTIONS = "no_transactions"
MULTIPLE_ACCOUNTS = "multiple_accounts"
TOO_MANY_ROWS = "too_many_rows"
MAPPING_MISMATCH = "mapping_mismatch"
# PDF ou imagem que a IA não conseguiu ler: documento ilegível ou resposta fora do esperado.
DOCUMENT_UNREADABLE = "document_unreadable"

NO_DESCRIPTION = "Lançamento sem descrição"
MAX_DESCRIPTION_LENGTH = 200


class ImportFailed(Exception):
    """O arquivo não pôde ser importado; `code` diz o motivo."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class MappingMismatch(ImportFailed):
    """O modelo de colunas não serve para o arquivo: uma data ou um valor não pôde ser lido."""

    def __init__(self) -> None:
        super().__init__(MAPPING_MISMATCH)


class MappingRequired(Exception):
    """CSV ou planilha sem modelo conhecido: o usuário precisa dizer quais são as colunas."""

    def __init__(self, preview: MappingPreview) -> None:
        super().__init__("mapping_required")
        self.preview = preview


@dataclass(frozen=True)
class ImportContext:
    """O que o importador sabe além do arquivo. Nunca traz uma sessão de banco."""

    account_type: AccountType
    # Modelos de colunas do usuário, pela assinatura do cabeçalho.
    templates: Mapping[str, ColumnMapping] = field(default_factory=dict)
    # O dia de hoje em Brasília: referência para o documento que traz a data sem o ano.
    today: dt.date | None = None


@dataclass(frozen=True)
class AiCall:
    """A chamada ao provedor de IA que leu o documento, para o serviço gravar em `ai_usage`."""

    task: AiTask
    model: str
    usage: LLMUsage


@dataclass(frozen=True)
class RawDocument[RowT]:
    """As linhas como estão no arquivo, com o total e o saldo, quando existirem."""

    rows: Sequence[RowT]
    document_total_cents: int | None = None
    balance_cents: int | None = None
    balance_date: dt.date | None = None
    # Em CSV e planilha: a assinatura do cabeçalho, que identifica o modelo aplicado.
    header_signature: str | None = None
    # Em PDF e imagem: a chamada à IA que leu o documento. O importador não acessa o banco.
    ai_call: AiCall | None = None


@dataclass(frozen=True)
class ProposedTransaction:
    """Uma transação lida do arquivo. Não tem categoria nem marca de duplicata."""

    type: TransactionType
    # Sempre maior que zero; o sinal vem do tipo.
    amount_cents: int
    date: dt.date
    description: str
    # Identificador dado pelo banco, como o FITID do OFX.
    external_id: str | None = None


class Importer[RowT](Protocol):
    formats: frozenset[ImportFormat]
    # O que o usuário disse que o arquivo é: extrato ou fatura, ou comprovante.
    kinds: frozenset[ImportKind]

    def detect(self, head: bytes, filename: str) -> bool:
        """Diz se este importador reconhece o arquivo, pelos primeiros bytes."""
        ...

    async def extract(self, file: StoredFile, context: ImportContext) -> RawDocument[RowT]:
        """Lê o arquivo e devolve as linhas brutas, o total e o saldo, quando existirem."""
        ...

    def normalize(
        self, raw: RawDocument[RowT], context: ImportContext
    ) -> list[ProposedTransaction]:
        """Converte as linhas brutas em transações propostas."""
        ...


def clean_description(*parts: str | None) -> str:
    """Junta os trechos, com um espaço só entre as palavras e no limite do banco.

    Um trecho que já está dentro de outro não se repete: bancos costumam mandar o mesmo texto,
    inteiro ou abreviado, em dois campos do OFX.
    """
    texts = [" ".join((part or "").split()) for part in parts]
    plain = [strip_accents(text).casefold() for text in texts]
    kept = [
        text
        for index, text in enumerate(texts)
        if text
        and not any(
            other != index
            and plain[index] in plain[other]
            and (plain[index] != plain[other] or other < index)
            for other in range(len(texts))
        )
    ]
    return " ".join(kept)[:MAX_DESCRIPTION_LENGTH].strip() or NO_DESCRIPTION
