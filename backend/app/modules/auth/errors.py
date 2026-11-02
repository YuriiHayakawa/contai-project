"""Erros de domínio da autenticação, com os códigos de contracts/rest-api.md."""

from app.core.errors import Conflict, DomainError, Forbidden, ValidationFailed
from app.modules.auth.emails import SPAM_REMINDER


class InvalidCredentials(DomainError):
    """E-mail inexistente e senha errada recebem exatamente esta resposta (FR-008)."""

    status_code = 401
    code = "invalid_credentials"
    message = "E-mail ou senha incorretos. Confira os dois e tente de novo."


class AccountLocked(DomainError):
    status_code = 423
    code = "account_locked"
    message = (
        "Por segurança, a entrada nesta conta foi bloqueada depois de várias tentativas "
        "erradas. Tente de novo em alguns minutos ou crie uma nova senha."
    )

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(
            details={"retry_after": retry_after_seconds},
            headers={"Retry-After": str(retry_after_seconds)},
        )


class InvalidOrExpiredToken(DomainError):
    status_code = 400
    code = "invalid_or_expired_token"
    message = "Este link não vale mais. Peça um novo link e use o mais recente."


class EmailNotVerified(Forbidden):
    code = "email_not_verified"
    message = (
        "Confirme seu e-mail para continuar. Abra o link que enviamos para você ou peça um novo. "
        f"{SPAM_REMINDER}"
    )


class RefreshNotFromApp(Forbidden):
    """O refresh só aceita pedidos feitos pelo próprio app (proteção contra CSRF)."""

    message = "Este pedido não veio do Contaí. Abra o app e tente de novo."


class IncorrectPassword(ValidationFailed):
    """Senha atual errada, ao confirmar uma ação sensível (trocar senha, desativar 2FA)."""

    code = "incorrect_password"

    def __init__(self, field: str = "current_password") -> None:
        message = "Senha incorreta. Confira e tente de novo."
        super().__init__(message, details={"fields": {field: message}})


class InvalidTwoFactorCode(DomainError):
    """Código do app autenticador ou código de recuperação que não confere (FR-012)."""

    status_code = 401
    code = "invalid_two_factor_code"
    message = "Código inválido. Confira no app autenticador e tente de novo."


class TwoFactorAlreadyEnabled(Conflict):
    code = "two_factor_already_enabled"
    message = "A verificação em duas etapas já está ativa nesta conta."


class TwoFactorNotEnabled(Conflict):
    code = "two_factor_not_enabled"
    message = "A verificação em duas etapas não está ativa nesta conta."


class TwoFactorSetupRequired(Conflict):
    """Pediram para ativar sem antes gerar o segredo (`/2fa/setup`)."""

    code = "two_factor_setup_required"
    message = "Comece a configuração da verificação em duas etapas antes de ativá-la."
