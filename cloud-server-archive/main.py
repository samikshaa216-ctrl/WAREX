from fastapi import FastAPI
import sqlite3
import json
import time
import random

app = FastAPI()

DB_FILE = "checkpoints.db"


def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS checkpoints (
            robot_id TEXT PRIMARY KEY,
            data TEXT
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.post("/checkpoint/{robot_id}")
def save_checkpoint(robot_id: str, payload: dict):

    # Simulate network latency
    time.sleep(random.uniform(0.1, 1.0))

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("""
        INSERT OR REPLACE INTO checkpoints (robot_id, data)
        VALUES (?, ?)
    """, (robot_id, json.dumps(payload)))

    conn.commit()
    conn.close()

    return {"status": "saved", "robot_id": robot_id}


@app.get("/checkpoint/{robot_id}")
def get_checkpoint(robot_id: str):

    # Simulate network latency
    time.sleep(random.uniform(0.1, 1.0))

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("SELECT data FROM checkpoints WHERE robot_id = ?", (robot_id,))
    row = cursor.fetchone()
    conn.close()

    if row:
        return json.loads(row[0])
    else:
        return {"error": "No checkpoint found"}
