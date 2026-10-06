"""Modelos de e-mail e o registro dos tipos de e-mail que o sistema envia.

Cada modelo é um arquivo de texto em `app/email/templates/`: a primeira linha é
`Assunto: ...`, seguida de uma linha em branco e do corpo. As variáveis usam a sintaxe de
`string.Template` (`$name`, `$link`).
"""

from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from string import Template

from app.modules.auth.models import EmailTokenType

TEMPLATES_DIR = Path(__file__).parent / "templates"
_SUBJECT_PREFIX = "Assunto:"


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    body: str


@dataclass(frozen=True)
class EmailType:
    """Um tipo de e-mail: qual modelo usa e, se leva um link, que token e que caminho."""

    name: str
    template: str
    token_type: EmailTokenType | None = None
    token_ttl: timedelta | None = None
    link_path: str | None = None
    templates_dir: Path = TEMPLATES_DIR


_EMAIL_TYPES: dict[str, EmailType] = {}


def register_email_type(email_type: EmailType) -> None:
    _EMAIL_TYPES[email_type.name] = email_type


def get_email_type(name: str) -> EmailType | None:
    return _EMAIL_TYPES.get(name)


def render(
    template: str, context: dict[str, str], templates_dir: Path = TEMPLATES_DIR
) -> RenderedEmail:
    """Preenche um modelo. Variável sem valor no contexto é erro, e não texto vazio."""
    raw = (templates_dir / f"{template}.txt").read_text(encoding="utf-8")
    first_line, _, rest = raw.partition("\n")
    if not first_line.startswith(_SUBJECT_PREFIX):
        raise ValueError(f"o modelo {template} precisa começar com '{_SUBJECT_PREFIX}'")
    subject = Template(first_line[len(_SUBJECT_PREFIX) :].strip()).substitute(context)
    body = Template(rest.lstrip("\n")).substitute(context)
    return RenderedEmail(subject=subject, body=body)
