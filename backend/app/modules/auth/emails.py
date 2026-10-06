"""Tipos de e-mail da autenticação. Registrados ao importar o módulo, na API e no worker.

Os caminhos dos links são rotas públicas do frontend (`frontend/src/router.tsx`).
"""

from datetime import timedelta

from app.email.templates import EmailType, register_email_type
from app.modules.auth.models import EmailTokenType

VERIFY_EMAIL = "verify_email"
ALREADY_REGISTERED = "already_registered"
PASSWORD_RESET = "password_reset"  # noqa: S105 - nome do tipo de e-mail, não é senha

VERIFICATION_LINK_TTL = timedelta(hours=24)
PASSWORD_RESET_LINK_TTL = timedelta(hours=1)

VERIFY_EMAIL_PATH = "/confirmar-email"
RESET_PASSWORD_PATH = "/redefinir-senha"  # noqa: S105 - caminho de rota, não é senha


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


register_auth_email_types()
