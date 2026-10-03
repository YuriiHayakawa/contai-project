"""Modelo de colunas de um CSV ou planilha: quais colunas são data, descrição e valor, e como
ler a data e o valor (FR-039). Tipos puros, usados pelo importador, pelo serviço e pelas rotas.
"""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# Posição da coluna no arquivo, a partir de zero.
ColumnIndex = Annotated[int, Field(ge=0, le=199)]


class DateFormat(StrEnum):
    """Ordem de dia, mês e ano. O separador (`/`, `-` ou `.`) é reconhecido sozinho."""

    DMY = "dmy"
    MDY = "mdy"
    YMD = "ymd"


class SignConvention(StrEnum):
    """Quando há uma coluna só de valor, o que o sinal dela quer dizer."""

    # Extrato de conta: o que sai vem negativo.
    NEGATIVE_IS_EXPENSE = "negative_is_expense"
    # Fatura de cartão: a compra vem positiva e o estorno, negativo.
    POSITIVE_IS_EXPENSE = "positive_is_expense"


class ColumnMapping(BaseModel):
    """O valor vem de uma coluna só (`amount_column`) ou de duas, a de entrada e a de saída."""

    model_config = ConfigDict(frozen=True)

    date_column: ColumnIndex
    description_column: ColumnIndex
    amount_column: ColumnIndex | None = None
    income_column: ColumnIndex | None = None
    expense_column: ColumnIndex | None = None
    date_format: DateFormat = DateFormat.DMY
    decimal_separator: Literal[",", "."] = ","
    sign_convention: SignConvention = SignConvention.NEGATIVE_IS_EXPENSE

    def columns(self) -> list[int]:
        """As colunas que o modelo usa."""
        optional = (self.amount_column, self.income_column, self.expense_column)
        return [
            self.date_column,
            self.description_column,
            *(column for column in optional if column is not None),
        ]


class MappingSuggestion(BaseModel):
    """Palpite do sistema pelos nomes das colunas; o usuário confirma ou troca."""

    date_column: int | None = None
    description_column: int | None = None
    amount_column: int | None = None
    income_column: int | None = None
    expense_column: int | None = None
    date_format: DateFormat = DateFormat.DMY
    decimal_separator: Literal[",", "."] = ","
    sign_convention: SignConvention = SignConvention.NEGATIVE_IS_EXPENSE


class MappingPreview(BaseModel):
    """O que a tela de mapeamento mostra: o cabeçalho, as primeiras linhas e o palpite."""

    # Identifica a estrutura do arquivo: o modelo salvo vale para todo arquivo com a mesma.
    header_signature: str
    columns: list[str]
    rows: list[list[str]]
    suggestion: MappingSuggestion
