"""Exportação de todos os dados do usuário em um arquivo ZIP de formato aberto (FR-016).

Lê os dados apenas pelos repositórios de cada módulo, sempre com o `user_id`, de modo que a
exportação nunca alcança dados de outra conta. O ZIP traz um `README.txt` com o índice, planilhas
em CSV (contas, categorias, lançamentos, importações e regras de categoria) que qualquer pessoa
abre numa planilha, e JSON para o perfil e as conversas do assistente.
"""

import csv
import io
import json
import uuid
import zipfile
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import Account
from app.modules.accounts.repository import AccountRepository
from app.modules.assistant.repository import AssistantRepository
from app.modules.categories.models import Category
from app.modules.categories.repository import CategoryRepository
from app.modules.categorization.models import CategorizationRule
from app.modules.categorization.repository import CategorizationRepository
from app.modules.imports.models import Import
from app.modules.imports.repository import ImportRepository
from app.modules.transactions.models import Transaction
from app.modules.transactions.repository import TransactionRepository
from app.modules.users.models import User
from app.modules.users.repository import UserRepository

README = """Seus dados no Contaí
====================

Este arquivo reúne tudo o que o Contaí guarda da sua conta.

- perfil.json .............. seus dados de cadastro
- contas.csv ............... suas contas e cartões
- categorias.csv ........... suas categorias
- lancamentos.csv .......... todos os seus lançamentos
- importacoes.csv .......... o histórico de arquivos importados
- regras-de-categoria.csv .. as regras que categorizam lançamentos automaticamente
- conversas.json ........... suas conversas com o assistente

Os arquivos .csv abrem em qualquer planilha (Excel, Google Planilhas, LibreOffice).
Os valores estão em reais, com o ponto separando os centavos.
"""


def _reais(cents: int | None) -> str:
    """Centavos inteiros para reais com duas casas: 123456 vira "1234.56"."""
    if cents is None:
        return ""
    return f"{cents / 100:.2f}"


def _when(moment: datetime | None) -> str:
    """Instante em ISO 8601, ou vazio."""
    return moment.isoformat() if moment is not None else ""


def _csv(header: list[str], rows: Iterable[list[object]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        writer.writerow(["" if value is None else value for value in row])
    return buffer.getvalue()


class AccountExporter:
    """Monta o ZIP com os dados de um usuário, lendo só pelos repositórios."""

    def __init__(self, session: AsyncSession) -> None:
        self._users = UserRepository(session)
        self._accounts = AccountRepository(session)
        self._categories = CategoryRepository(session)
        self._transactions = TransactionRepository(session)
        self._imports = ImportRepository(session)
        self._rules = CategorizationRepository(session)
        self._assistant = AssistantRepository(session)

    async def build(self, user_id: uuid.UUID) -> bytes:
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise ValueError("usuário inexistente")

        accounts = await self._accounts.list_all(user_id, include_archived=True)
        categories = await self._categories.list_all(user_id, include_archived=True)
        account_name = {account.id: account.name for account in accounts}
        category_name = {category.id: category.name for category in categories}

        files: dict[str, str] = {
            "README.txt": README,
            "perfil.json": self._profile_json(user),
            "contas.csv": self._accounts_csv(accounts),
            "categorias.csv": self._categories_csv(categories, category_name),
            "lancamentos.csv": self._transactions_csv(
                await self._transactions.list_all_for_user(user_id), account_name, category_name
            ),
            "importacoes.csv": self._imports_csv(
                await self._imports.list_all_for_user(user_id), account_name
            ),
            "regras-de-categoria.csv": self._rules_csv(
                await self._rules.list_all(user_id), category_name
            ),
            "conversas.json": await self._conversations_json(user_id),
        }

        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in files.items():
                archive.writestr(name, content)
        return out.getvalue()

    @staticmethod
    def _profile_json(user: User) -> str:
        data = {
            "nome": user.name,
            "email": user.email,
            "situacao": str(user.status),
            "verificacao_em_duas_etapas": user.totp_enabled_at is not None,
            "versao_politica_privacidade": user.privacy_policy_version,
            "politica_aceita_em": _when(user.privacy_policy_accepted_at),
            "conta_criada_em": _when(user.created_at),
            "exclusao_agendada_para": _when(user.deletion_scheduled_at),
        }
        return json.dumps(data, ensure_ascii=False, indent=2)

    @staticmethod
    def _accounts_csv(accounts: Iterable[Account]) -> str:
        header = [
            "id",
            "nome",
            "tipo",
            "instituicao",
            "saldo_inicial",
            "data_saldo_inicial",
            "limite_credito",
            "arquivada_em",
        ]
        rows = [
            [
                a.id,
                a.name,
                str(a.type),
                a.institution,
                _reais(a.initial_balance_cents),
                a.initial_balance_date.isoformat(),
                _reais(a.credit_limit_cents),
                _when(a.archived_at),
            ]
            for a in accounts
        ]
        return _csv(header, rows)

    @staticmethod
    def _categories_csv(categories: Iterable[Category], category_name: dict[uuid.UUID, str]) -> str:
        header = ["id", "nome", "tipo", "categoria_mae", "cor", "icone", "arquivada_em"]
        rows = [
            [
                c.id,
                c.name,
                str(c.kind),
                category_name.get(c.parent_id, "") if c.parent_id else "",
                str(c.color),
                c.icon,
                _when(c.archived_at),
            ]
            for c in categories
        ]
        return _csv(header, rows)

    @staticmethod
    def _transactions_csv(
        transactions: Iterable[Transaction],
        account_name: dict[uuid.UUID, str],
        category_name: dict[uuid.UUID, str],
    ) -> str:
        header = [
            "id",
            "data",
            "descricao",
            "valor",
            "tipo",
            "conta",
            "categoria",
            "observacoes",
            "origem",
            "parcela",
            "importacao_id",
        ]
        rows = []
        for t in transactions:
            parcela = (
                f"{t.installment_number}/{t.installment_count}"
                if t.installment_number and t.installment_count
                else ""
            )
            rows.append(
                [
                    t.id,
                    t.date.isoformat(),
                    t.description,
                    _reais(t.amount_cents),
                    str(t.type),
                    account_name.get(t.account_id, ""),
                    category_name.get(t.category_id, "") if t.category_id else "",
                    t.notes,
                    str(t.source),
                    parcela,
                    t.import_id,
                ]
            )
        return _csv(header, rows)

    @staticmethod
    def _imports_csv(imports: Iterable[Import], account_name: dict[uuid.UUID, str]) -> str:
        header = [
            "id",
            "criada_em",
            "tipo",
            "formato",
            "arquivo",
            "conta",
            "situacao",
            "itens",
            "importados",
            "concluida_em",
        ]
        rows = [
            [
                i.id,
                _when(i.created_at),
                str(i.kind),
                str(i.format),
                i.original_filename,
                account_name.get(i.account_id, ""),
                str(i.status),
                i.item_count,
                i.imported_count,
                _when(i.completed_at),
            ]
            for i in imports
        ]
        return _csv(header, rows)

    @staticmethod
    def _rules_csv(rules: Iterable[CategorizationRule], category_name: dict[uuid.UUID, str]) -> str:
        header = ["descricao", "categoria", "origem"]
        rows = [
            [r.description_normalized, category_name.get(r.category_id, ""), str(r.source)]
            for r in rules
        ]
        return _csv(header, rows)

    async def _conversations_json(self, user_id: uuid.UUID) -> str:
        conversations = await self._assistant.list_all_conversations(user_id)
        exported = []
        for conversation in conversations:
            messages = await self._assistant.list_messages(user_id, conversation.id)
            exported.append(
                {
                    "id": str(conversation.id),
                    "titulo": conversation.title,
                    "criada_em": _when(conversation.created_at),
                    "atualizada_em": _when(conversation.updated_at),
                    "mensagens": [
                        {
                            "posicao": m.position,
                            "autor": str(m.role),
                            "tipo": str(m.kind),
                            "conteudo": m.content,
                            "criada_em": _when(m.created_at),
                        }
                        for m in messages
                    ],
                }
            )
        return json.dumps(exported, ensure_ascii=False, indent=2)


async def build_account_export(session: AsyncSession, user_id: uuid.UUID) -> bytes:
    """Monta o ZIP com todos os dados do usuário."""
    return await AccountExporter(session).build(user_id)
