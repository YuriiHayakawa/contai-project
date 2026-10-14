"""Tipos de e-mail da conta do usuário. Registrados ao importar o módulo, na API e no worker."""

from app.email.templates import EmailType, register_email_type

ACCOUNT_DELETION_SCHEDULED = "account_deletion_scheduled"


def register_user_email_types() -> None:
    # Aviso de que a conta foi desativada e será apagada de vez na data informada; não leva link.
    register_email_type(
        EmailType(name=ACCOUNT_DELETION_SCHEDULED, template="account_deletion_scheduled")
    )


register_user_email_types()
