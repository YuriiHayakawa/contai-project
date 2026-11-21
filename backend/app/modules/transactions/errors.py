"""Erros de domínio do desfazer e do refazer da voz (contracts/rest-api.md)."""

from app.core.errors import Conflict, DomainError, NotFound


class VoiceEntryNotFound(NotFound):
    """O lançamento não existe, ou já foi desfeito (FR-030)."""

    code = "transaction_not_found"
    message = "Esse lançamento já tinha sido desfeito."


class NotVoiceEntry(Conflict):
    code = "not_voice_entry"
    message = (
        "Só os lançamentos feitos por voz se desfazem com um toque. Para este, use Excluir, que "
        "pede confirmação."
    )


class RestoreExpired(DomainError):
    status_code = 410
    code = "restore_expired"
    message = "O tempo para refazer acabou. Lance de novo, se precisar."


class RestoreConflict(Conflict):
    code = "restore_conflict"
    message = (
        "Não deu para refazer: a conta ou a categoria do lançamento não existe mais. Lance de novo."
    )
