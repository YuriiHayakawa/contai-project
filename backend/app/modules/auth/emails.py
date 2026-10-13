"""Tipos de e-mail da autenticação. Registrados ao importar o módulo, na API e no worker.

Os caminhos dos links são rotas públicas do frontend (`frontend/src/router.tsx`).
"""

from datetime import timedelta

from app.email.templates import EmailType, register_email_type
from app.modules.auth.models import EmailTokenType

VERIFY_EMAIL = "verify_email"
ALREADY_REGISTERED = "already_registered"
PASSWORD_RESET = "password_reset"  # noqa: S105 - nome do tipo de e-mail, não é senha
TWO_FACTOR_RESET_LINK = "two_factor_reset_link"
TWO_FACTOR_RESET_NOTICE = "two_factor_reset_notice"
TWO_FACTOR_RESET_REMINDER = "two_factor_reset_reminder"
TWO_FACTOR_RESET_APPLIED = "two_factor_reset_applied"

VERIFICATION_LINK_TTL = timedelta(hours=24)
PASSWORD_RESET_LINK_TTL = timedelta(hours=1)
# O link que abre a contagem de 72 horas vale 1 hora; o de cancelamento, as 72 horas inteiras.
TWO_FACTOR_RESET_CONFIRM_LINK_TTL = timedelta(hours=1)
TWO_FACTOR_RESET_CANCEL_LINK_TTL = timedelta(hours=72)

VERIFY_EMAIL_PATH = "/confirmar-email"
RESET_PASSWORD_PATH = "/redefinir-senha"  # noqa: S105 - caminho de rota, não é senha
TWO_FACTOR_RESET_CONFIRM_PATH = "/desativar-duas-etapas/confirmar"
TWO_FACTOR_RESET_CANCEL_PATH = "/desativar-duas-etapas/cancelar"


def register_auth_email_types() -> None:
    register_email_type(
        EmailType(
            name=VERIFY_EMAIL,
            template="verify_email",
            token_type=EmailTokenType.EMAIL_VERIFICATION,
            token_ttl=VERIFICATION_LINK_TTL,
            link_path=VERIFY_EMAIL_PATH,
        )
    )
    # Aviso a quem já tem conta e teve o e-mail usado em um novo cadastro; não leva link.
    register_email_type(EmailType(name=ALREADY_REGISTERED, template="already_registered"))
    register_email_type(
        EmailType(
            name=PASSWORD_RESET,
            template="password_reset",
            token_type=EmailTokenType.PASSWORD_RESET,
            token_ttl=PASSWORD_RESET_LINK_TTL,
            link_path=RESET_PASSWORD_PATH,
        )
    )
    # Pedido de desativação da verificação em duas etapas: o link abre a contagem de 72 horas.
    register_email_type(
        EmailType(
            name=TWO_FACTOR_RESET_LINK,
            template="two_factor_reset_link",
            token_type=EmailTokenType.TWO_FACTOR_RESET_CONFIRM,
            token_ttl=TWO_FACTOR_RESET_CONFIRM_LINK_TTL,
            link_path=TWO_FACTOR_RESET_CONFIRM_PATH,
        )
    )
    # Avisos com link de cancelamento: no momento do pedido e 24 horas antes de valer.
    register_email_type(
        EmailType(
            name=TWO_FACTOR_RESET_NOTICE,
            template="two_factor_reset_notice",
            token_type=EmailTokenType.TWO_FACTOR_RESET_CANCEL,
            token_ttl=TWO_FACTOR_RESET_CANCEL_LINK_TTL,
            link_path=TWO_FACTOR_RESET_CANCEL_PATH,
        )
    )
    register_email_type(
        EmailType(
            name=TWO_FACTOR_RESET_REMINDER,
            template="two_factor_reset_reminder",
            token_type=EmailTokenType.TWO_FACTOR_RESET_CANCEL,
            token_ttl=TWO_FACTOR_RESET_CANCEL_LINK_TTL,
            link_path=TWO_FACTOR_RESET_CANCEL_PATH,
        )
    )
    # Aviso de que a desativação passou a valer; não leva link.
    register_email_type(
        EmailType(name=TWO_FACTOR_RESET_APPLIED, template="two_factor_reset_applied")
    )


register_auth_email_types()
