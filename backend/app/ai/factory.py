"""Escolha do provedor de IA, pela variável de ambiente `AI_PROVIDER`."""

from functools import lru_cache

from app.ai.fake import FakeLLMProvider
from app.ai.provider import LLMProvider
from app.core.config import get_settings


@lru_cache
def get_provider() -> LLMProvider:
    settings = get_settings()
    if settings.ai_provider == "gemini":
        # Importado só quando usado: o SDK do fornecedor não é carregado nos testes.
        from app.ai.gemini import GeminiProvider

        return GeminiProvider(api_key=settings.ai_api_key.get_secret_value())
    return FakeLLMProvider()
