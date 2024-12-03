import dotenv from "dotenv/config";
import { REST, Routes, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { db } from "./database.js";
import { tokenPrices } from "./priceTracker.js";
import {
  priceList,
  setAlert,
  connectWallet,
  walletAddress,
} from "./constants/command_name.js";
import {
  burnHistoryCommand,
  priceChangeCommand,
  checkBalanceCommand,
} from "./priceChange/price_change_commands.js";
import fetch from "node-fetch";

const setAlertCommand = new SlashCommandBuilder()
  .setName(setAlert)
  .setDescription("Set Alert")
  .addStringOption((option) =>
    option.setName("token").setDescription("Enter the Token").setRequired(true)
  )
  .addNumberOption((option) =>
    option.setName("price").setDescription("Enter the Price").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("direction")
      .setDescription("choose direction")
      .setRequired(true)
      .addChoices(
        { name: "Above", value: "above" },
        { name: "Below", value: "below" }
      )
  );
const priceListCommand = new SlashCommandBuilder()
  .setName(priceList)
  .setDescription("Price List");

const connectWalletCommand = new SlashCommandBuilder()
  .setName(connectWallet)
  .setDescription("Connect Wallet")
  .addStringOption((option) =>
    option
      .setName(walletAddress)
      .setDescription("Enter the Wallet Address")
      .setRequired(true)
  );

const commands = [
  connectWalletCommand,
  // setAlertCommand,
  priceListCommand,
  priceChangeCommand,
  burnHistoryCommand,
  checkBalanceCommand,
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUID_ID
      ),
      { body: commands }
    );
    console.log("slash command registered");
  } catch (error) {
    console.error(error);
  }
})();

async function handleSetAlert(message, token, price, direction) {
  if (!tokenPrices.has(token)) {
    await message.reply(
      "Invalid token. Available tokens: bitcoin, ethereum, solana, cardano"
    );
    return;
  }

  if (isNaN(price) || price <= 0) {
    await message.reply("Please provide a valid price");
    return;
  }

  if (!["above", "below"].includes(direction)) {
    await message.reply('Direction must be either "above" or "below"');
    return;
  }

  db.run(
    `INSERT INTO price_alerts (user_id, token_id, target_price, above_threshold)
     VALUES (?, ?, ?, ?)`,
    [message.author.id, token, price, direction === "above" ? 1 : 0],
    (err) => {
      if (err) {
        console.error("Error setting alert:", err);
        message.reply("Error setting price alert");
        return;
      }
      message.reply(
        `Alert set for ${token.toUpperCase()} ${direction} $${price}`
      );
    }
  );
}

async function handlePriceList(message) {
  const url = "https://api.binance.com/api/v3/ticker/price";
  const selectedSymbols = [
    "BTCUSDT",
    "BTCPAX",
    "ETHUSDT",
    "SOLUSDT",
    "BCCUSDT",
  ];

  try {
    const response = await fetch(url);
    if (!response.ok) {
      message.reply(`HTTP error! Status: ${response.status}`);
      return;
    }
    const prices = await response.json();
    const filteredPrices = prices
      .filter((item) => selectedSymbols.includes(item.symbol))
      .map((item) => ({
        symbol: item.symbol,
        price: item.price,
      }));

    if (filteredPrices.length === 0) {
      message.reply("No prices found for the selected symbols.");
      return; 
    }

    const recentPrices = filteredPrices.slice(0, 5);
    const embed = new EmbedBuilder()
    .setTitle("Current Token Prices")
    .setColor("#0099ff")
    .setTimestamp();
    recentPrices.forEach(price => {
      embed.addFields({
        name: price.symbol.toUpperCase(),
        value: `$${price.price}`,
      });
    });

  await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching recent prices:", error);
    message.reply('Error fetching recent prices');
  }
}


async function handleMyAlerts(message) {
  db.all(
    "SELECT * FROM price_alerts WHERE user_id = ? AND triggered = 0",
    [message.author.id],
    async (err, alerts) => {
      if (err) {
        console.error("Error fetching alerts:", err);
        await message.reply("Error fetching your alerts");
        return;
      }

      if (alerts.length === 0) {
        await message.reply("You have no active price alerts");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Your Active Price Alerts")
        .setColor("#0099ff")
        .setTimestamp();

      for (const alert of alerts) {
        embed.addFields({
          name: `${alert.token_id.toUpperCase()} ${
            alert.above_threshold ? "above" : "below"
          } $${alert.target_price}`,
          value: "\u200b",
        });
      }

      await message.reply({ embeds: [embed] });
    }
  );
}

export { handleSetAlert, handlePriceList, handleMyAlerts };
