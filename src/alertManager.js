import { EmbedBuilder } from "discord.js";
import { db } from "./database.js";

async function checkAlerts(tokenPrices) {
  db.all(
    "SELECT * FROM price_alerts WHERE triggered = 0",
    [],
    async (err, alerts) => {
      if (err) {
        console.error("Error checking alerts:", err);
        return;
      }

      for (const alert of alerts) {
        const currentPrice = tokenPrices.get(alert.token_id);

        if (!currentPrice) continue;

        const shouldTrigger = alert.above_threshold
          ? currentPrice >= alert.target_price
          : currentPrice <= alert.target_price;

        if (shouldTrigger) {
          try {
            const user = await global.client.users.fetch(alert.user_id);
            const embed = new EmbedBuilder()
              .setTitle("🚨 Price Alert Triggered!")
              .setColor("#FF0000")
              .addFields(
                { name: "Token", value: alert.token_id.toUpperCase() },
                { name: "Current Price", value: `$${currentPrice.toFixed(2)}` },
                {
                  name: "Target Price",
                  value: `$${alert.target_price.toFixed(2)}`,
                }
              )
              .setTimestamp();

            await user.send({ embeds: [embed] });

            // Mark alert as triggered
            db.run("UPDATE price_alerts SET triggered = 1 WHERE id = ?", [
              alert.id,
            ]);
          } catch (error) {
            console.error("Error sending alert:", error);
          }
        }
      }
    }
  );
}

export { checkAlerts };
