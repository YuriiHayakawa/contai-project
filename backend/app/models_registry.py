"""Importa os modelos de todos os módulos, para que o metadata do SQLAlchemy esteja completo.

Usado pelo Alembic e pelos testes. Todo módulo novo com `models.py` entra aqui.
"""

from app.ai import models as ai_models
from app.modules.auth import models as auth_models
from app.modules.users import models as users_models
from app.worker import models as worker_models

__all__ = ["ai_models", "auth_models", "users_models", "worker_models"]
