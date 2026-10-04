"""O que o modelo devolve ao ler um PDF ou uma imagem (research.md, seção 13).

Datas e valores chegam como texto, do jeito que estão no documento: quem os converte é o
backend, com `Decimal`, nunca com `float`. O schema também é o limite do que um documento
consegue produzir: data, descrição, valor e sentido de cada lançamento, e mais nada.

Todo campo é obrigatório, e o que pode faltar no documento aceita `null`: o schema vai ao
provedor sem valores padrão, só com o que todo fornecedor entende.
"""

from enum import StrEnum

from pydantic import BaseModel, Field


class Direction(StrEnum):
    """O sentido do dinheiro: `out` é dinheiro que sai, e `in`, dinheiro que entra."""

    OUT = "out"
    IN = "in"


class ExtractedLine(BaseModel):
    """Um lançamento de um extrato ou de uma fatura, como está no documento."""

    date: str = Field(description="Data do lançamento, no formato AAAA-MM-DD.")
    description: str = Field(description="O texto do lançamento, sem a data e sem o valor.")
    amount: str = Field(description="O valor como está escrito, sem sinal: 45,90 ou 1.234,56.")
    direction: Direction


class StatementExtraction(BaseModel):
    """As linhas de um extrato ou de uma fatura e, quando o documento traz, o total dele."""

    lines: list[ExtractedLine]
    total: str | None = Field(
        description="O total dos lançamentos impresso no documento; null quando não há."
    )


class ReceiptExtraction(BaseModel):
    """A única transação de um comprovante, recibo ou nota fiscal."""

    amount: str | None = Field(
        description="O valor total pago, como está escrito; null quando não dá para ler."
    )
    date: str | None = Field(
        description="Data do pagamento, no formato AAAA-MM-DD; null quando não há."
    )
    description: str = Field(description="O nome do estabelecimento ou de quem recebeu.")
    direction: Direction
