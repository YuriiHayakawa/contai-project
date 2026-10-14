"""O seed de demonstração recusa-se a rodar em produção (T221)."""

import pytest

from app.core.config import get_settings
from scripts.seed_demo import SeedRefusedInProduction, ensure_not_production


def test_refuses_to_run_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "environment", "production")
    with pytest.raises(SeedRefusedInProduction):
        ensure_not_production()


def test_allows_running_in_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "environment", "development")
    # Não lança: em desenvolvimento o seed pode rodar.
    ensure_not_production()
