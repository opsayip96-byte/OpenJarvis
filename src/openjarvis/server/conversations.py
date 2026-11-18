"""SQLite persistence for browser-facing chat conversations."""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


class ConversationStore:
    """Additive conversation tables stored alongside the existing agent DB."""

    def __init__(self, db_path: str | Path) -> None:
        self.path = str(Path(db_path).expanduser())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        if self.path != ":memory:":
            from openjarvis.security.file_utils import secure_create

            secure_create(Path(self.path))
        self._lock = threading.RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS chat_conversations (
                id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL
                    REFERENCES chat_conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL, content TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS chat_messages_conversation
                ON chat_messages(conversation_id, created_at);
        """)
        self._db.commit()

    def save_exchange(self, conversation_id: str, messages: list[Any], model: str) -> None:
        now = time.time()
        with self._lock, self._db:
            first = next((m.content for m in messages if m.role == "user" and m.content), "")
            self._db.execute(
                "INSERT INTO chat_conversations(id,title,model,created_at,updated_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET model=excluded.model, updated_at=excluded.updated_at",
                (conversation_id, first[:120], model, now, now),
            )
            # The browser supplies its complete transcript; replacing it keeps edits/deletions exact.
            self._db.execute("DELETE FROM chat_messages WHERE conversation_id=?", (conversation_id,))
            for i, message in enumerate(messages):
                content = message.content or ""
                if message.role not in {"system", "user", "assistant", "tool"} or not content:
                    continue
                self._db.execute(
                    "INSERT INTO chat_messages(id,conversation_id,role,content,model,created_at) VALUES(?,?,?,?,?,?)",
                    (f"{conversation_id}:{i}", conversation_id, message.role, content, model, now + i / 1_000_000),
                )

    def get(self, conversation_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute(
                "SELECT id,title,model,created_at,updated_at FROM chat_conversations WHERE id=?",
                (conversation_id,),
            ).fetchone()
            if row is None:
                return None
            messages = self._db.execute(
                "SELECT role,content,model,created_at FROM chat_messages WHERE conversation_id=? ORDER BY created_at",
                (conversation_id,),
            ).fetchall()
        return {"id": row[0], "title": row[1], "model": row[2], "created_at": row[3], "updated_at": row[4],
                "messages": [{"role": m[0], "content": m[1], "model": m[2], "created_at": m[3]} for m in messages]}

    def close(self) -> None:
        with self._lock:
            self._db.close()


__all__ = ["ConversationStore"]
