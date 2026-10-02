"""Descrição normalizada e impressão digital de uma transação. Regras puras, sem banco.

A descrição normalizada é a base das regras de categoria e da detecção de duplicatas: duas
descrições que só diferem por maiúsculas, acentos, pontuação, números ou datas ficam iguais.
"""

import datetime as dt
import hashlib
import re
import unicodedata
import uuid

_NOT_ALPHANUMERIC = re.compile(r"[^a-z0-9]+")


def strip_accents(text: str) -> str:
    """Tira os acentos: "São João" vira "Sao Joao"."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def normalize_description(description: str) -> str:
    """Minúsculas, sem acentos, sem pontuação e sem trechos só de números (inclusive datas).

    "PAG*Padaria São João 12/05 #4821" vira "pag padaria sao joao". Um trecho que mistura letras
    e números, como "uber2", é mantido: só os trechos puramente numéricos saem.
    """
    words = _NOT_ALPHANUMERIC.sub(" ", strip_accents(description.lower())).split()
    return " ".join(word for word in words if not word.isdigit())


def fingerprint(
    *,
    account_id: uuid.UUID,
    date: dt.date,
    transaction_type: str,
    amount_cents: int,
    description_normalized: str,
) -> str:
    """Hash de conta, data, tipo, valor e descrição normalizada.

    Não é único: duas compras iguais no mesmo dia são legítimas e têm a mesma impressão digital.
    """
    parts = [
        str(account_id),
        date.isoformat(),
        str(transaction_type),
        str(amount_cents),
        description_normalized,
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()
