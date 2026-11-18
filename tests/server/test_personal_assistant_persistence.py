"""Regression coverage for durable conversations and approved memory recall."""

from __future__ import annotations

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from openjarvis.core.config import JarvisConfig
from openjarvis.server.app import create_app


def _config(tmp_path):
    cfg = JarvisConfig()
    cfg.analytics.enabled = False
    cfg.traces.enabled = False
    cfg.security.enabled = False
    cfg.agent_manager.db_path = str(tmp_path / "agents.db")
    cfg.memory.facts_path = str(tmp_path / "facts.jsonl")
    cfg.memory.enabled = False  # Explicit memory APIs remain available.
    return cfg


def _engine():
    engine = MagicMock()
    engine.engine_id = "test"
    engine.health.return_value = True
    engine.list_models.return_value = ["openrouter/free"]
    engine.generate.return_value = {
        "content": "The answer is 42.",
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        "model": "openrouter/free",
        "finish_reason": "stop",
    }

    async def stream(messages, **kwargs):
        yield "Streaming "
        yield "answer."

    engine.stream = stream
    return engine


def test_approved_memory_and_chat_survive_app_restart(tmp_path):
    config = _config(tmp_path)
    conversation_id = "browser-chat-1"
    engine = _engine()
    app = create_app(engine, "test-model", config=config)
    with TestClient(app) as client:
        saved = client.post("/v1/chat/completions", json={
            "model": "test-model", "conversation_id": "remember-command",
            "messages": [{"role": "user", "content": "Remember this: My preferred name is Ada."}],
        })
        assert saved.status_code == 200, saved.text
        assert saved.json()["choices"][0]["message"]["content"] == "I've saved that to your personal memory."
        assert engine.generate.call_count == 0
        response = client.post("/v1/chat/completions", json={
            "model": "test-model", "conversation_id": conversation_id,
            "messages": [{"role": "user", "content": "What is my preferred name?"}],
        })
        assert response.status_code == 200, response.text
        sent_messages = engine.generate.call_args.args[0]
        assert any("My preferred name is Ada." in message.content for message in sent_messages)

    # A fresh app and SQLite connection represent a server restart.
    app2 = create_app(_engine(), "test-model", config=config)
    with TestClient(app2) as client:
        memories = client.get("/v1/memories").json()["memories"]
        assert any(item["text"] == "My preferred name is Ada." for item in memories)
        exported = client.get("/v1/memories/export")
        assert exported.status_code == 200
        assert any(item["text"] == "My preferred name is Ada." for item in exported.json()["memories"])
        transcript = client.get(f"/v1/conversations/{conversation_id}")
        assert transcript.status_code == 200, transcript.text
        assert [m["role"] for m in transcript.json()["messages"]] == ["user", "assistant"]

        # Verify memory management is durable and supports edits/deletion.
        assert client.put("/v1/memories/0", json={"text": "Call me Ada."}).status_code == 200
        assert client.delete("/v1/memories/0").status_code == 200
        assert client.get("/v1/memories").json()["memories"] == []

        import sqlite3
        with sqlite3.connect(config.agent_manager.db_path) as db:
            assert db.execute(
                "SELECT COUNT(*) FROM jarvis_personal_memories"
            ).fetchone()[0] == 0


def test_streamed_chat_is_persisted(tmp_path):
    app = create_app(_engine(), "test-model", config=_config(tmp_path))
    with TestClient(app) as client:
        response = client.post("/v1/chat/completions", json={
            "model": "test-model", "conversation_id": "streamed-chat",
            "stream": True,
            "messages": [{"role": "user", "content": "Say hello."}],
        })
        assert response.status_code == 200
        import json
        deltas = []
        for line in response.text.splitlines():
            if line.startswith("data: ") and line[6:] != "[DONE]":
                try:
                    delta = json.loads(line[6:])["choices"][0]["delta"].get("content")
                    if delta:
                        deltas.append(delta)
                except (ValueError, KeyError, IndexError):
                    pass
        assert "".join(deltas) == "Streaming answer."
        saved = client.get("/v1/conversations/streamed-chat")
        assert saved.status_code == 200
        assert saved.json()["messages"][-1]["content"] == "Streaming answer."


def test_streaming_remember_command_confirms_only_after_sqlite_write(tmp_path):
    config = _config(tmp_path)
    app = create_app(_engine(), "test-model", config=config)
    with TestClient(app) as client:
        response = client.post("/v1/chat/completions", json={
            "model": "test-model", "stream": True,
            "messages": [{"role": "user", "content": "Remember this: I prefer concise replies."}],
        })
        assert response.status_code == 200
        assert "I've saved that to your personal memory." in response.text
        assert client.get("/v1/memories").json()["memories"][0]["text"] == "I prefer concise replies."


def test_chat_tool_registry_executes_local_calculator(tmp_path):
    from openjarvis.tools.calculator import CalculatorTool

    calculator = CalculatorTool()
    result = calculator.execute(expression="(19 + 23) * 2")
    assert result.success
    assert result.content == "84.0"


def test_orchestrator_executes_calculator_during_chat(tmp_path):
    from openjarvis.agents.orchestrator import OrchestratorAgent
    from openjarvis.tools.calculator import CalculatorTool

    engine = _engine()
    results = []
    calls = 0

    def generate(messages, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"content": "", "tool_calls": [{
                "id": "calc-1", "name": "calculator",
                "arguments": '{"expression":"(19 + 23) * 2"}',
            }], "usage": {}}
        return {"content": "84", "tool_calls": [], "usage": {}}

    engine.generate.side_effect = generate
    agent = OrchestratorAgent(engine, "test-model", tools=[CalculatorTool()])
    original_run = agent.run

    def capture_result(*args, **kwargs):
        result = original_run(*args, **kwargs)
        results.append(result)
        return result

    agent.run = capture_result
    app = create_app(engine, "test-model", agent=agent, config=_config(tmp_path))
    with TestClient(app) as client:
        response = client.post("/v1/chat/completions", json={
            "model": "test-model", "messages": [{"role": "user", "content": "Calculate this."}],
        })
    assert response.status_code == 200, response.text
    assert response.json()["choices"][0]["message"]["content"] == "84"
    assert len(results) == 1
    assert [(item.tool_name, item.content, item.success) for item in results[0].tool_results] == [
        ("calculator", "84.0", True)
    ]
