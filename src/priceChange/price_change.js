import fetch from "node-fetch";
import { EmbedBuilder } from "discord.js";

async function handlePriceChangeCommand(interaction) {
  const tokenAddress = interaction.options.getString("token");
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${tokenAddress}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      interaction.reply("Failed to fetching token price information.");
      return;
    }

    const data = await response.json();
    console.log(data);

    const embed = new EmbedBuilder()
      .setTitle("Token Price Information")
      .addFields(
        { name: "Symbol", value: data.symbol },
        { name: "Price Change", value: data.priceChange },
        { name: "Price Change Percent", value: `${data.priceChangePercent}%` },
        { name: "Last Price", value: data.lastPrice }
      )
      .setColor("#0099ff")
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Price fetch error:", error);
    await interaction.reply("Failed to fetch price information.");
  }
}

export { handlePriceChangeCommand };
