"""SQLite persistence for explicitly user-approved personal facts."""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

from openjarvis.memory.store import TRUST_TRUSTED, Fact


class PersonalMemoryStore:
    """A small fact store sharing the existing agent-manager SQLite file."""

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
            CREATE TABLE IF NOT EXISTS jarvis_personal_memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'user-approved',
                trust TEXT NOT NULL DEFAULT 'trusted',
                created_at REAL NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS jarvis_personal_memory_text
                ON jarvis_personal_memories(lower(text));
        """)
        self._db.commit()

    def list(self) -> list[Fact]:
        with self._lock:
            rows = self._db.execute(
                "SELECT text,source,created_at,trust FROM jarvis_personal_memories ORDER BY id"
            ).fetchall()
        return [Fact(text=r[0], source=r[1], created_at=r[2], trust=r[3]) for r in rows]

    def add_with_trust(self, text: str, source: str = "user-approved", trust: str = TRUST_TRUSTED) -> bool:
        text = (text or "").strip()
        if not text or trust != TRUST_TRUSTED:
            return False
        with self._lock, self._db:
            cursor = self._db.execute(
                "INSERT OR IGNORE INTO jarvis_personal_memories(text,source,trust,created_at) VALUES(?,?,?,?)",
                (text, source, trust, time.time()),
            )
            return cursor.rowcount == 1

    def add(self, text: str, source: str = "user-approved") -> bool:
        return self.add_with_trust(text, source=source)

    def update(self, index: int, text: str) -> bool:
        text = (text or "").strip()
        if not text:
            return False
        with self._lock, self._db:
            row = self._db.execute(
                "SELECT id FROM jarvis_personal_memories ORDER BY id LIMIT 1 OFFSET ?", (index,)
            ).fetchone()
            if row is None:
                return False
            try:
                self._db.execute(
                    "UPDATE jarvis_personal_memories SET text=?,trust=? WHERE id=?",
                    (text, TRUST_TRUSTED, row[0]),
                )
            except sqlite3.IntegrityError:
                return False
            return True

    def delete(self, index: int) -> bool:
        with self._lock, self._db:
            row = self._db.execute(
                "SELECT id FROM jarvis_personal_memories ORDER BY id LIMIT 1 OFFSET ?", (index,)
            ).fetchone()
            if row is None:
                return False
            self._db.execute("DELETE FROM jarvis_personal_memories WHERE id=?", (row[0],))
            return True

    def close(self) -> None:
        with self._lock:
            self._db.close()


__all__ = ["PersonalMemoryStore"]
