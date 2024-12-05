import dotenv from "dotenv/config";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import bs58 from "bs58";
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
import {
  LARGE_BUYS_CHANNEL_ID,
  PREPAID_DEX_CHANNEL_ID,
} from "./constants/channels.js";

// Solana mainnet connection
// const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

const QUICK_CONNECT = new Connection(
  "https://cosmological-evocative-season.solana-mainnet.quiknode.pro/d9d3e63af0e78584d8477901191a985c9a71966b/"
);

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
    recentPrices.forEach((price) => {
      embed.addFields({
        name: price.symbol.toUpperCase(),
        value: `$${price.price}`,
      });
    });

    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching recent prices:", error);
    message.reply("Error fetching recent prices");
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

async function monitorPrepaidDex(client) {
  const connection = new Connection(clusterApiUrl("mainnet-beta"), {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0, // Ensures compatibility with transaction version 0
  });
  const PURPLE_BITCOIN_ADDRESS = "HfMbPyDdZH6QMaDDUokjYCkHxzjoGBMpgaUvpLWGbF5p";
  const monitoredAddress = new PublicKey(PURPLE_BITCOIN_ADDRESS);
  const MINIMUM_SOL_BOUGHT = 0; // Minimum SOL threshold

  const largestAccounts = await QUICK_CONNECT.getTokenLargestAccounts(
    monitoredAddress
  );

  // Fetch account information for each of these accounts
  const accountInfoPromises = largestAccounts.value.map(async (account) => {
    const accountInfo = await QUICK_CONNECT.getParsedAccountInfo(
      account.address
    );
    return {
      address: account.address,
      amount: account.uiAmount,
    };
  });

  const topHolders = await Promise.all(accountInfoPromises);

  let holdersList = "Top 10 Holders\n";
  topHolders.slice(0, 10).forEach((holder, index) => {
    holdersList += `${index + 1}. Address: ${holder.address}, Balance: ${
      holder.amount
    }\n`;
  });

  connection.onLogs(monitoredAddress, async (logs) => {
    const signature = logs.signature;
    // const signature =
    //   "WZVta642pcCeupZ6zt7MvARp1QVdgVt3XDxWDyLQxFKthtvBQjca9zBBfx17jvzUJxKk9r7kcttGmZpbqzRTvno";
    console.log("Signature", signature);
    await waitForSeconds(60);

    const url = "https://api.mainnet-beta.solana.com"; // Devnet Solana endpoint
    const requestBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [signature, { maxSupportedTransactionVersion: 0 }],
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      const txDetails = data.result;

      if (!txDetails) return;

      const { meta, transaction } = txDetails;
      const preBalances = meta.preBalances;
      const postBalances = meta.postBalances;

      // Identify SOL inflow and token outflow
      let solReceived = 0;
      let tokenPaid = 0;
      let buyerAddress = "";

      meta.preTokenBalances.forEach((preTokenBalance, index) => {
        const postTokenBalance = meta.postTokenBalances[index];

        if (preTokenBalance.mint === monitoredAddress.toBase58()) {
          tokenPaid = Math.abs(
            (preTokenBalance.uiTokenAmount.uiAmount || 0) -
              (postTokenBalance.uiTokenAmount.uiAmount || 0)
          );
        }
      });

      solReceived = Math.abs((postBalances[0] - preBalances[0]) / 1e9); // Lamports to SOL

      // Identify buyer (sender of transaction)
      buyerAddress = transaction.message.accountKeys[0];

      if (solReceived > 3 && tokenPaid > 0) {
        let channel = await client.channels.fetch(LARGE_BUYS_CHANNEL_ID);
        if (channel) {
          const embed = new EmbedBuilder()
            .setColor(0xff5733)
            .setTitle("PURPLE BITCOIN (PBTC)")
            .addFields(
              {
                name: "Purchase Information",
                value: `${buyerAddress.slice(
                  0,
                  6
                )} purchased ${tokenPaid} PBTC\nBought ${solReceived} SOL`,
              },
              { name: "Contract Address", value: `${PURPLE_BITCOIN_ADDRESS}` },
              {
                name: "Holders",
                value: `${holdersList}`,
              },
              {
                name: "Social Media",
                value: "No Twitter\nNo Telegram\nNo Website",
              },
              {
                name: "Useful Links",
                value:
                  "[Dev Wallet](https://link-to-dev-wallet)\n[Buy Token](https://link-to-buy-token)",
              },
              { name: "Coin Created", value: "5 hours ago" },
              { name: "Current Market Cap", value: "138604.74$" },
              { name: "Current Token Price", value: "0.000000805 SOL/token" }
            )
            .setTimestamp()
            .setFooter({ text: "Quick Buy: BULXI | PHOTON | PLONK | BULXRF" });
          channel.send({ embeds: [embed] });
        }
      }
    } catch (error) {
      console.error("Error fetching transaction:", error);
    }
  });

  function waitForSeconds(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}

export { handleSetAlert, handlePriceList, handleMyAlerts, monitorPrepaidDex };
