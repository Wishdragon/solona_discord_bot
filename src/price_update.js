require("dotenv").config();
const { Client, IntentsBitField, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch");
const nodeSchedule = require("node-schedule");
const sqlite3 = require("sqlite3").verbose();

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
  ],
});

const db = new sqlite3.Database(
  "./price_alert.db",
  sqlite3.OPEN_READWRITE,
  (err) => {
    if (err) {
      console.error(err.message);
    }
  }
);

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

let tokenPrices = new Map();

async function updateTokenPrices() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano&vs_currencies=usd"
    );
    const data = await response.json();
    console.log("response data :::", data);
    tokenPrices.clear();

    for (const coin of data) {
      const coinId = coin.id;
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
      const response = await fetch(url);
      const data = await response.json();
      tokenPrices.set(coinId, data[coinId].usd);
    }
  } catch (error) {
    console.error("Error fetching token prices:", error);
  }
}

async function checkAlerts() {
  db.all("SELECT * FROM price_alerts", (err, alerts) => {
    if (err) {
      console.error("Error checking price alerts:", err);
      return;
    }

    for (const alert of alerts) {
      const currentPrice = tokenPrices.get(alert.token_id);
      console.log("currentPrice :::", currentPrice);

      if (!currentPrice) continue;

      const shouldTrigger = alert.above_threshold
        ? currentPrice >= alert.target_price
        : currentPrice <= alert.target_price;

      if (shouldTrigger) {
        try {
          const user = client.users.cache.get(alert.user_id);
          if (!user) {
            console.log(`User with ID ${alert.user_id} not found`);
            continue;
          }
          const embed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle("🚨 Price Alert Triggered")
            .addFields(
              { name: "Token", value: alert.token_id },
              { name: "Target Price", value: alert.target_price },
              { name: "Current Price", value: currentPrice }
            )
            .setDescription(
              `Token: ${alert.token_id}\nTarget Price: ${alert.target_price}\nCurrent Price: ${currentPrice}`
            )
            .setTimestamp();

          user.send({ embeds: [embed] });

          db.run(
            "UPDATE price_alerts SET triggered = 1 WHERE id = ?",
            alert.id,
            (err) => {
              if (err) {
                console.error("Error updating triggered status:", err);
              }
            }
          );
        } catch (error) {
          console.error("Error sending price alert:", error);
        }
      }
    }
  });
}

const job = nodeSchedule.scheduleJob("*/5 * * * *", async () => {
  await updateTokenPrices();
  await checkAlerts();
});
