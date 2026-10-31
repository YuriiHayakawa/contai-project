"""Configurações da aplicação, lidas exclusivamente de variáveis de ambiente."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

JWT_SECRET_PLACEHOLDER = "troque-este-valor-em-producao-por-um-segredo-gerado"  # noqa: S105 - marcador, não é segredo
MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    environment: Literal["development", "production"] = "development"

    # Banco de dados
    database_url: str
    test_database_url: str | None = None

    # Aplicação
    app_origin: str
    cors_allowed_origins: str = ""

    # Segredos: sem valor padrão, sempre vindos do ambiente
    jwt_secret: SecretStr
    totp_encryption_key: SecretStr
    # Segredo que a Vercel acrescenta a cada requisição repassada; vazio desliga a checagem.
    proxy_shared_secret: SecretStr = SecretStr("")
    # Temporário: registra os cabeçalhos de IP dos health checks que chegam pela Vercel.
    log_client_ip_headers: bool = False

    # E-mail
    smtp_host: str
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_use_tls: bool = True
    email_from: str

    # Inteligência artificial
    ai_provider: Literal["fake", "gemini"] = "fake"
    ai_api_key: SecretStr = SecretStr("")
    ai_model_chat: str = ""
    ai_model_extraction: str = ""
    # Modelos reserva: tentados quando o principal está indisponível ou sem cota.
    ai_model_chat_fallback: str = ""
    ai_model_extraction_fallback: str = ""
    ai_daily_question_limit: int = 30
    ai_daily_extraction_limit: int = 10

    # Limites de frequência (formato do slowapi, por exemplo "10/minute")
    rate_limit_login: str = "10/minute"
    rate_limit_register: str = "5/hour"
    rate_limit_email_requests: str = "5/hour"
    rate_limit_upload: str = "20/hour"
    rate_limit_assistant: str = "10/minute"

    # Uploads
    upload_max_bytes: int = 10 * 1024 * 1024
    upload_dir: Path = Path("/data/uploads")

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def _require_real_secrets_in_production(self) -> Self:
        if not self.is_production:
            return self
        jwt_secret = self.jwt_secret.get_secret_value()
        if jwt_secret == JWT_SECRET_PLACEHOLDER or len(jwt_secret) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                "JWT_SECRET precisa ser gerado para produção (mínimo de 32 caracteres)"
            )
        if not self.totp_encryption_key.get_secret_value():
            raise ValueError("TOTP_ENCRYPTION_KEY é obrigatória em produção")
        if len(self.proxy_shared_secret.get_secret_value()) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                "PROXY_SHARED_SECRET precisa ser gerado para produção (mínimo de 32 caracteres)"
            )
        if self.ai_provider == "gemini" and not self.ai_api_key.get_secret_value():
            raise ValueError("AI_API_KEY é obrigatória com AI_PROVIDER=gemini")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
