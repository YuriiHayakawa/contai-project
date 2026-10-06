"""Ferramentas do assistente. Importar este pacote registra todas elas."""

from app.modules.assistant.tools import (  # noqa: F401 - o import registra as ferramentas
    balances,
    cards,
    compare,
    propose,
    search,
    spending,
    top_expenses,
)
from app.modules.assistant.tools.base import (
    ToolContext,
    ToolResult,
    execute,
    registered,
    specs,
)

__all__ = ["ToolContext", "ToolResult", "execute", "registered", "specs"]
