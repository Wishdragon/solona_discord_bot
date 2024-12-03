import sqlite3 from "sqlite3";

const db = new sqlite3.Database("alerts.db", sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error(err.message);
  }
});

function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      token_id TEXT,
      target_price REAL,
      above_threshold INTEGER,
      triggered INTEGER DEFAULT 0
    )
  `);
}

export { db, initializeDatabase };
