"""FocusLock API: durable preferences and study statistics with SQLite."""

import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from server.companion import create_demo_reply


DATABASE_PATH = Path(
    os.environ.get(
        "FOCUSLOCK_DB",
        str(Path(__file__).resolve().parent.parent / "data" / "focuslock.sqlite3"),
    )
)

app = FastAPI(title="FocusLock API", version="1.0.0")


def connect_db() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with closing(connect_db()) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                focus_minutes INTEGER NOT NULL DEFAULT 25,
                break_minutes INTEGER NOT NULL DEFAULT 5,
                blocked_sites TEXT NOT NULL DEFAULT '[]'
            );
            INSERT OR IGNORE INTO settings (id) VALUES (1);

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL CHECK (kind IN ('focus', 'break')),
                duration_seconds INTEGER NOT NULL,
                completed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                correct INTEGER NOT NULL,
                total INTEGER NOT NULL,
                score_percent INTEGER NOT NULL,
                completed_at TEXT NOT NULL
            );
            """
        )
        connection.commit()


initialize_database()


class SettingsPayload(BaseModel):
    focus_minutes: int = Field(ge=1, le=120)
    break_minutes: int = Field(ge=1, le=60)
    blocked_sites: list[str] = Field(max_length=100)


class SessionPayload(BaseModel):
    kind: Literal["focus", "break"] = "focus"
    duration_seconds: int = Field(ge=1, le=86_400)


class QuizPayload(BaseModel):
    correct: int = Field(ge=0)
    total: int = Field(ge=1, le=50)


class ChatPayload(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


def normalize_site(value: str) -> str:
    candidate = value.strip()
    if not candidate or len(candidate) > 255:
        raise HTTPException(status_code=422, detail="Enter a website address.")
    if any(character.isspace() for character in candidate):
        raise HTTPException(
            status_code=422, detail="Website addresses cannot contain spaces."
        )

    parsed = urlsplit(candidate if "://" in candidate else f"https://{candidate}")
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if not hostname or "." not in hostname and hostname != "localhost":
        raise HTTPException(
            status_code=422, detail="Enter a valid website host, such as example.com."
        )
    if not re.fullmatch(r"[a-z0-9.-]+", hostname):
        raise HTTPException(status_code=422, detail="Enter a valid website host.")
    return hostname


def current_settings(connection: sqlite3.Connection) -> dict:
    row = connection.execute(
        "SELECT focus_minutes, break_minutes, blocked_sites FROM settings WHERE id = 1"
    ).fetchone()
    return {
        "focus_minutes": row["focus_minutes"],
        "break_minutes": row["break_minutes"],
        "blocked_sites": json.loads(row["blocked_sites"]),
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/dashboard")
def dashboard(
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
) -> dict:
    local_timezone = timezone(timedelta(minutes=-timezone_offset_minutes))
    local_now = datetime.now(timezone.utc).astimezone(local_timezone)
    local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = local_start.astimezone(timezone.utc).isoformat()
    end_utc = (local_start + timedelta(days=1)).astimezone(timezone.utc).isoformat()

    with closing(connect_db()) as connection:
        settings = current_settings(connection)
        today = connection.execute(
            """
            SELECT COALESCE(SUM(duration_seconds), 0) AS seconds,
                   COUNT(*) AS sessions
            FROM sessions
            WHERE kind = 'focus' AND completed_at >= ? AND completed_at < ?
            """,
            (start_utc, end_utc),
        ).fetchone()
        totals = connection.execute(
            """
            SELECT COALESCE(SUM(duration_seconds), 0) AS seconds, COUNT(*) AS sessions
            FROM sessions WHERE kind = 'focus'
            """
        ).fetchone()
        quizzes = connection.execute(
            """
            SELECT COUNT(*) AS attempts, MAX(score_percent) AS best
            FROM quiz_attempts
            """
        ).fetchone()
        recent_sessions = connection.execute(
            """
            SELECT kind, duration_seconds, completed_at
            FROM sessions ORDER BY id DESC LIMIT 5
            """
        ).fetchall()

    return {
        "settings": settings,
        "stats": {
            "today_focus_minutes": today["seconds"] // 60,
            "today_sessions": today["sessions"],
            "total_focus_minutes": totals["seconds"] // 60,
            "total_sessions": totals["sessions"],
            "quizzes_completed": quizzes["attempts"],
            "best_quiz_score": quizzes["best"],
        },
        "recent_sessions": [dict(row) for row in recent_sessions],
    }


@app.put("/api/settings")
def save_settings(payload: SettingsPayload) -> dict:
    sites = list(dict.fromkeys(normalize_site(site) for site in payload.blocked_sites))
    with closing(connect_db()) as connection:
        connection.execute(
            """
            UPDATE settings
            SET focus_minutes = ?, break_minutes = ?, blocked_sites = ?
            WHERE id = 1
            """,
            (
                payload.focus_minutes,
                payload.break_minutes,
                json.dumps(sites),
            ),
        )
        connection.commit()
        return {"settings": current_settings(connection)}


@app.post("/api/sessions")
def log_session(payload: SessionPayload) -> dict:
    completed_at = datetime.now(timezone.utc).isoformat()
    with closing(connect_db()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO sessions (kind, duration_seconds, completed_at)
            VALUES (?, ?, ?)
            """,
            (payload.kind, payload.duration_seconds, completed_at),
        )
        connection.commit()
        return {
            "id": cursor.lastrowid,
            "kind": payload.kind,
            "duration_seconds": payload.duration_seconds,
            "completed_at": completed_at,
        }


@app.post("/api/quizzes")
def save_quiz(payload: QuizPayload) -> dict:
    if payload.correct > payload.total:
        raise HTTPException(
            status_code=422, detail="Correct answers cannot exceed the quiz length."
        )
    score_percent = round(payload.correct / payload.total * 100)
    completed_at = datetime.now(timezone.utc).isoformat()
    with closing(connect_db()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO quiz_attempts (correct, total, score_percent, completed_at)
            VALUES (?, ?, ?, ?)
            """,
            (payload.correct, payload.total, score_percent, completed_at),
        )
        connection.commit()
        return {
            "id": cursor.lastrowid,
            "correct": payload.correct,
            "total": payload.total,
            "score_percent": score_percent,
            "completed_at": completed_at,
        }


@app.post("/api/chat")
def chat(payload: ChatPayload) -> dict:
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Write a message first.")
    return {"reply": create_demo_reply(message), "mode": "local-demo"}
