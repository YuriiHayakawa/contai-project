"""Conferência do segundo fator, compartilhada pelo login e pela gestão da conta.

Aceita um código do app autenticador (TOTP) ou um código de recuperação de uso único. Protege
contra reuso: o passo do TOTP aceito avança `totp_last_used_step` do usuário, e cada código de
recuperação vale uma única vez.
"""

from datetime import datetime

from app.core.security import decrypt_totp_secret, hash_recovery_code, verify_totp
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import User


async def verify_second_factor(
    auth: AuthRepository,
    user: User,
    *,
    code: str | None,
    recovery_code: str | None,
    now: datetime,
) -> bool:
    """Confere um código do app ou um código de recuperação; devolve se algum conferiu.

    Quando um TOTP confere, grava o passo em `user.totp_last_used_step` (o chamador persiste o
    usuário). Quando um código de recuperação confere, ele é marcado como usado.
    """
    if code:
        if user.totp_secret_encrypted is None:
            return False
        step = verify_totp(
            decrypt_totp_secret(user.totp_secret_encrypted),
            code,
            last_used_step=user.totp_last_used_step,
            now=now,
        )
        if step is None:
            return False
        user.totp_last_used_step = step
        return True
    if recovery_code:
        return await auth.use_recovery_code(user.id, hash_recovery_code(recovery_code), now)
    return False
