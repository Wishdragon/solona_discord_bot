import sqlite3 from "sqlite3";
import fs from "fs";

const db = new sqlite3.Database(
  "bot.db",
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error(err.message);
    }
  }
);

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
  db.run(`
    CREATE TABLE IF NOT EXISTS token_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT,
      data TEXT      
    )
  `);
}

async function storeMetaDataToDB(metaData) {
  try {
    const row = await getRowByMint(metaData.mint);

    if (row) {
      return `${metaData.data.name} (${metaData.data.symbol}) already exists.`;
    } else {
      const jsonString = JSON.stringify(metaData);
      const lastID = await insertData(jsonString, metaData.mint);
      return `${metaData.data.name} (${metaData.data.symbol}) registered successfuly.`;
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

function insertData(data, mint) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO token_meta (data, mint) VALUES (?, ?)",
      [data, mint],
      function (err) {
        if (err) {
          return reject(err);
        }
        resolve(this.lastID);
      }
    );
  });
}

function getRowByMint(mint) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM token_meta WHERE mint = ?", [mint], (err, row) => {
      if (err) {
        return reject(err);
      }
      resolve(row);
    });
  });
}

function fetchMetaDataFromDB() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM token_meta", [], (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows.map((row) => JSON.parse(row.data)));
    });
  });
}

export { db, initializeDatabase, storeMetaDataToDB, fetchMetaDataFromDB };
