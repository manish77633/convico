"""Create a reproducible 5,000-message SQLite history for emulator profiling.

Run against a copy of the app database, then install that copy on a stopped,
rootable emulator. This script never edits the phone or running app directly.
"""

import argparse
import sqlite3
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--count", type=int, default=5000)
    args = parser.parse_args()
    if args.count < 2 or args.count % 2:
        parser.error("--count must be a positive even number")

    db = sqlite3.connect(args.database)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL,
        reply_to_id TEXT, request_id TEXT, error TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_order ON messages(thread_id, created_at, id);
      CREATE INDEX IF NOT EXISTS messages_request ON messages(request_id);
      CREATE TABLE IF NOT EXISTS sync_queue (
        message_id TEXT PRIMARY KEY REFERENCES messages(id), created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      );
    """)
    rows = []
    base = 1_700_000_000_000
    for pair in range(args.count // 2):
        user_id = f"bench-user-{pair:05d}"
        rows.append((user_id, "main", "user", f"Test prompt {pair}: make a simple plan for this week.",
                     base + pair * 2, "delivered", None, None, None))
        rows.append((f"bench-answer-{pair:05d}", "main", "assistant",
                     "Start with one clear goal. Choose a small step, try it, and review the result.",
                     base + pair * 2 + 1, "delivered", user_id, user_id, None))
    with db:
        db.executemany("INSERT OR IGNORE INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    count = db.execute("SELECT COUNT(*) FROM messages WHERE id LIKE 'bench-%'").fetchone()[0]
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.close()
    print(f"Seed rows present: {count}")


if __name__ == "__main__":
    main()
