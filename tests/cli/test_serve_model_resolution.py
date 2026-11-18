"""Tests for API server model selection."""

from __future__ import annotations

from openjarvis.cli.serve import _resolve_server_model
from openjarvis.core.config import JarvisConfig
from openjarvis.core.registry import EngineRegistry


class _FakeEngine:
    def __init__(self, models: list[str]) -> None:
        self._models = models

    def list_models(self) -> list[str]:
        return self._models


def test_server_model_falls_back_to_reachable_ollama_model() -> None:
    cfg = JarvisConfig()
    cfg.server.model = "mlx-community/Qwen2.5-7B-Instruct-4bit"
    cfg.intelligence.default_model = "mlx-community/Qwen2.5-7B-Instruct-4bit"
    cfg.intelligence.fallback_model = "qwen3.5:9b"

    model = _resolve_server_model(
        None,
        config=cfg,
        engine_name="multi",
        engine=_FakeEngine(["qwen3.5:9b"]),
        all_models={"multi": ["qwen3.5:9b"]},
    )

    assert model == "qwen3.5:9b"


def test_server_model_prefers_reachable_configured_model() -> None:
    cfg = JarvisConfig()
    cfg.server.model = "mlx-community/Qwen2.5-7B-Instruct-4bit"
    cfg.intelligence.default_model = "qwen3.5:9b"
    cfg.intelligence.fallback_model = "qwen3.5:9b"

    model = _resolve_server_model(
        None,
        config=cfg,
        engine_name="multi",
        engine=_FakeEngine(["mlx-community/Qwen2.5-7B-Instruct-4bit", "qwen3.5:9b"]),
        all_models={"multi": ["mlx-community/Qwen2.5-7B-Instruct-4bit"]},
    )

    assert model == "mlx-community/Qwen2.5-7B-Instruct-4bit"


def test_server_model_keeps_explicit_cli_model() -> None:
    cfg = JarvisConfig()
    cfg.server.model = "configured-model"
    cfg.intelligence.fallback_model = "fallback-model"

    model = _resolve_server_model(
        "explicit-model",
        config=cfg,
        engine_name="multi",
        engine=_FakeEngine(["fallback-model"]),
        all_models={"multi": ["fallback-model"]},
    )

    assert model == "explicit-model"


def test_server_model_keeps_configured_openrouter_model(monkeypatch) -> None:
    cfg = JarvisConfig()
    cfg.intelligence.default_model = "openrouter/free"
    monkeypatch.setattr(
        "openjarvis.server.cloud_router.provider_is_configured",
        lambda model: model == "openrouter/free",
    )

    model = _resolve_server_model(
        None,
        config=cfg,
        engine_name="multi",
        engine=_FakeEngine(["bigcode/starcoder2-15b"]),
        all_models={"multi": ["bigcode/starcoder2-15b"]},
    )

    assert model == "openrouter/free"


def test_server_model_skips_unconfigured_cloud_default(monkeypatch) -> None:
    cfg = JarvisConfig()
    cfg.intelligence.default_model = "openrouter/free"
    cfg.intelligence.fallback_model = "local-model"
    monkeypatch.setattr(
        "openjarvis.server.cloud_router.provider_is_configured",
        lambda model: False,
    )

    model = _resolve_server_model(
        None,
        config=cfg,
        engine_name="multi",
        engine=_FakeEngine(["local-model"]),
        all_models={"multi": ["local-model"]},
    )

    assert model == "local-model"


def test_cloud_engine_is_registered_and_can_initialize_openrouter_model(monkeypatch) -> None:
    from openjarvis.engine.cloud import CloudEngine
    from openjarvis.engine._discovery import get_engine

    if not EngineRegistry.contains("cloud"):
        EngineRegistry.register_value("cloud", CloudEngine)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    cfg = JarvisConfig()
    cfg.engine.default = "cloud"

    assert EngineRegistry.contains("cloud")
    resolved = get_engine(cfg, "cloud", model="openrouter/free")

    assert resolved is not None
    assert resolved[0] == "cloud"
    assert resolved[1].can_serve("openrouter/free")
    resolved[1].close()
