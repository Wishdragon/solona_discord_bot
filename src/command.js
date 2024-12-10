import dotenv from "dotenv/config";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { REST, Routes, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { TokenListProvider } from "@solana/spl-token-registry";
import { db, fetchMetaDataFromDB, storeMetaDataToDB } from "./util/database.js";
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
} from "./slashCommands/price_change_commands.js";
import { registerTokenCommand } from "./slashCommands/registerToken.js";
import fetch from "node-fetch";
import {
  DEV_BURNS_CHANNEL_ID,
  FRESH_ONE_SOL_CHANNEL_ID,
  FRESH_OVER_ONE_SOL_CHANNE_ID,
  LARGE_BUYS_CHANNEL_ID,
  PREPAID_DEX_CHANNEL_ID,
  TEN_DEV_BURNS_CHANNEL_ID,
} from "./constants/channels.js";
import {
  TOKEN_META_DATA,
  DEV_TOKEN_META_DATA,
} from "./constants/token_meta_data.js";
import {
  extractInformation,
  getTokenCreationTime,
  getTokenMetadata,
  getTopHolders,
  isFreshWallet,
  timeDifference,
} from "./util/utils.js";

// Solana mainnet connection
// const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

const DEVNET_ENDPOINT = "https://api.devnet.solana.com";
// const DEV_CONNECTION = new Connection(DEVNET_ENDPOINT);
const DEV_CONNECTION = new Connection(DEVNET_ENDPOINT, {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0, // Ensures compatibility with transaction version 0
});

const QUICK_CONNECT = new Connection(
  "https://cosmological-evocative-season.solana-mainnet.quiknode.pro/d9d3e63af0e78584d8477901191a985c9a71966b/"
);

const connection = new Connection(clusterApiUrl("mainnet-beta"), {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
});

const PURPLE_BITCOIN_ADDRESS = "HfMbPyDdZH6QMaDDUokjYCkHxzjoGBMpgaUvpLWGbF5p";

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
  registerTokenCommand,
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

async function handleRegisterToken(interaction, mint, client) {
  try {
    const metaData = await getTokenMetadata(mint);
    const { message, success } = await storeMetaDataToDB(metaData);
    await interaction.reply({
      content: message,
      ephemeral: true,
    });
    if (success) {
      monitorTransaction(metaData, client);
    }
  } catch (error) {
    console.error("handleRegisterToken():", error);
  }
}

async function handleMonitoringTransactions(client) {
  try {
    const metaData = await fetchMetaDataFromDB();
    metaData.forEach(async (token) => {
      monitorTransaction(token, client);
    });
  } catch (error) {
    console.error("handleRegisterToken():", error);
  }
}

async function monitorTransaction(token, client) {
  const monitoredAddress = new PublicKey(token.mint);
  QUICK_CONNECT.onLogs(monitoredAddress, async (logs) => {
    try {
      const signature = logs.signature;
      console.log(`${token.data.name}:`, signature);

      await waitForSeconds(60);

      const url =
        "https://cosmological-evocative-season.solana-mainnet.quiknode.pro/d9d3e63af0e78584d8477901191a985c9a71966b/";
      const requestBody = {
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { maxSupportedTransactionVersion: 0 }],
      };

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

      const { buyerAddress, solReceived, tokenPaid, txDateString } =
        extractInformation(txDetails, monitoredAddress);
      const { isFresh, fundingSource } = await isFreshWallet(buyerAddress);

      const holdersList = await getTopHolders(monitoredAddress);

      if (!isFresh && solReceived > 3 && tokenPaid > 0) {
        let channel = await client.channels.fetch(LARGE_BUYS_CHANNEL_ID);
        sendLargeBuysChannel(
          channel,
          buyerAddress,
          tokenPaid,
          solReceived,
          holdersList,
          txDateString,
          token
        );
      } else if (isFresh && solReceived > 0.001 && tokenPaid > 0) {
        let channel = await client.channels.fetch(FRESH_OVER_ONE_SOL_CHANNE_ID);
        sendFreshSolChannel(
          channel,
          fundingSource,
          buyerAddress,
          tokenPaid,
          solReceived,
          holdersList,
          txDateString,
          token
        );
      } else if (isFresh && solReceived > 0.0000000001 && tokenPaid > 0) {
        let channel = await client.channels.fetch(FRESH_ONE_SOL_CHANNEL_ID);
        sendFreshSolChannel(
          channel,
          fundingSource,
          buyerAddress,
          tokenPaid,
          solReceived,
          holdersList,
          txDateString,
          token
        );
      }
    } catch (error) {
      console.error("Error fetching transaction:", error);
    }
  });
}

async function monitorDeveloperBurns(client) {
  DEV_TOKEN_META_DATA.map(async (token) => {
    const monitoredWallet = new PublicKey(token.updateAuthority);
    DEV_CONNECTION.onLogs(monitoredWallet, async (logs, ctx) => {
      try {
        const signature = logs.signature;
        console.log(`${token.name} Dev Burn Detected: `, signature);
        waitForSeconds(60);
        const txDetails = await DEV_CONNECTION.getTransaction(signature);
        const { logMessages, preTokenBalances, postTokenBalances } =
          txDetails.meta;
        let isBurnt = false;
        logMessages.forEach((message) => {
          if (message.includes("BurnChecked")) isBurnt = true;
        });
        if (isBurnt) {
          const tokenSupplyInfo = await DEV_CONNECTION.getTokenSupply(
            new PublicKey("fFYguHSEEk1cUQs3SMKKTUyoRfQtPLTYvRFCBtnJXgZ")
          );
          const tokenSupply = Number(tokenSupplyInfo.value.uiAmount);
          const burntAmount =
            preTokenBalances[0].uiTokenAmount.uiAmount -
            postTokenBalances[0].uiTokenAmount.uiAmount;
          const burnPercentage =
            (burntAmount / (tokenSupply + burntAmount)) * 100;
          const transactionDate = new Date(txDetails.blockTime * 1000);
          if (burnPercentage < 0.003) {
            let channel = await client.channels.fetch(DEV_BURNS_CHANNEL_ID);
            sendDevBurnChannel(
              channel,
              burntAmount,
              burnPercentage,
              token,
              transactionDate
            );
          } else {
            let channel = await client.channels.fetch(TEN_DEV_BURNS_CHANNEL_ID);
            sendDevBurnChannel(
              channel,
              burntAmount,
              burnPercentage,
              token,
              transactionDate
            );
          }
        }
      } catch (error) {
        console.error(`Error processing logs: ${error.message}`);
      }
    });
  });
}

function waitForSeconds(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function sendDevBurnChannel(
  channel,
  amountBurned,
  burnPercentage,
  token,
  transactionDate
) {
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff5733)
      .setTitle(`${token.name.toUpperCase()} (${token.symbol})`)
      .setThumbnail(token.image)
      .addFields(
        {
          name: "Token Information 📄",
          value:
            "```" +
            `Dev has burnt ${amountBurned} (${burnPercentage}%) ${token.symbol} tokens from ${token.name}!` +
            "```",
        },
        {
          name: "Contract Address 📜",
          value: "```" + `${token.mint}` + "```",
        },
        {
          name: "Token Description 📝",
          value: "```" + `${token.description}` + "```",
        },
        {
          name: "Social Media 📱",
          value: `${token.twitter ? "[Twitter](" + token.twitter + ")" : ""}\n${
            token.telegram ? "[Telegram](" + token.telegram + ")" : ""
          }\n${token.website ? "[Website](" + token.website + ")" : ""}`,
          inline: true,
        },
        {
          name: "Useful Links 📎",
          value:
            "[Dev Wallet](https://link-to-dev-wallet) | [Buy Token](https://link-to-buy-token)",
          inline: true,
        },
        {
          name: "Burnt 🔥",
          value: `${transactionDate.toLocaleString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false, // 24-hour format
          })}`,
          inline: true,
        },
        { name: "Current Market Cap 💰", value: "138604.74$" }
      )
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
}

async function sendTenDevBurnChannel(
  client,
  amountBurned,
  burnPercentage,
  token
) {
  let channel = await client.channels.fetch(TEN_DEV_BURNS_CHANNEL_ID);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff5733)
      .setTitle(`${token.name.toUpperCase()} (${token.symbol})`)
      .setThumbnail(token.image)
      .addFields(
        {
          name: "Token Information 📄",
          value:
            "```" +
            `Dev has burnt ${amountBurned} (${burnPercentage}) ${token.symbol} tokens from ${token.name}!` +
            "```",
        },
        {
          name: "Contract Address 📜",
          value: "```" + `${token.mint}` + "```",
        },
        {
          name: "Token Description 📝",
          value: "```" + `${token.description}` + "```",
        },
        {
          name: "Social Media 📱",
          value: `[Twitter](${token.twitter})\n[Telegram](${token.telegram})\n[Website](${token.website})`,
          inline: true,
        },
        {
          name: "Useful Links 📎",
          value:
            "[Dev Wallet](https://link-to-dev-wallet) | [Buy Token](https://link-to-buy-token)",
          inline: true,
        },
        { name: "Burnt 🔥", value: "5 hours ago", inline: true },
        { name: "Current Market Cap 💰", value: "138604.74$" }
      )
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
}

async function sendLargeBuysChannel(
  channel,
  buyerAddress,
  tokenPaid,
  solReceived,
  holdersList,
  txDateString,
  token
) {
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff5733)
      .setTitle(`${token.data.name.toUpperCase()} (${token.data.symbol})`)
      .setThumbnail(token.data.image)
      .addFields(
        {
          name: "Purchase Information 📄",
          value:
            "```" +
            `${buyerAddress.slice(0, 6)} purchased ${tokenPaid} ${
              token.data.symbol
            }\nBought ${solReceived} SOL` +
            "```",
        },
        {
          name: "Contract Address 📜",
          value: "```" + `${token.mint}` + "```",
        },
        {
          name: "Holders 👯‍♀️",
          value: "```" + `${holdersList}` + "```",
        },
        {
          name: "Social Media 📱",
          value: `${
            token.data.twitter ? "[Twitter](" + token.data.twitter + ")" : ""
          }\n${
            token.data.telegram ? "[Telegram](" + token.data.telegram + ")" : ""
          }\n${
            token.data.website ? "[Website](" + token.data.website + ")" : ""
          }`,
          inline: true,
        },
        {
          name: "Useful Links 📎",
          value:
            "[Dev Wallet](https://link-to-dev-wallet) | [Buy Token](https://link-to-buy-token)",
          inline: true,
        },
        { name: "Coin Created 💿", value: "5 hours ago", inline: true },
        { name: "Bought 💿", value: txDateString, inline: true },
        { name: "Current Market Cap 💰", value: "138604.74$", inline: true },
        {
          name: "Current Token Price",
          value: "0.000000805 SOL/token",
          inline: true,
        }
      )
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
}

async function sendFreshSolChannel(
  channel,
  fundingSource,
  buyerAddress,
  tokenPaid,
  solReceived,
  holdersList,
  transactionDate,
  token
) {
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff5733)
      .setTitle(`${token.data.name.toUpperCase()} (${token.data.symbol})`)
      .setThumbnail(token.data.image)
      .addFields(
        {
          name: "Purchase Information 📄",
          value:
            "```" +
            `${buyerAddress.slice(0, 6)} purchased ${Math.round(tokenPaid)} ${
              token.data.name
            }\nBought ${solReceived} SOL` +
            "```",
        },
        {
          name: "Wallet Information 💰",
          value:
            "```" +
            `Wallet\n${buyerAddress}\nfunded from\n${fundingSource?.senderAddress}\nfor ${fundingSource?.fundedAmount} SOL` +
            "```",
        },
        {
          name: "Contract Address 📜",
          value: "```" + `${token.mint}` + "```",
        },
        {
          name: "Holders 👯",
          value: "```" + `${holdersList}` + "```",
        },
        {
          name: "Social Media 📱",
          value: `${
            token.data.twitter ? "[Twitter](" + token.data.twitter + ")" : ""
          }\n${
            token.data.telegram ? "[Telegram](" + token.data.telegram + ")" : ""
          }\n${
            token.data.website ? "[Website](" + token.data.website + ")" : ""
          }`,
          inline: true,
        },
        {
          name: "Useful Links 📎",
          value:
            "[Dev Wallet](https://link-to-dev-wallet)|[Buy Token](https://link-to-buy-token)",
          inline: true,
        },
        { name: "Coin Created 💿", value: "5 hours ago", inline: true },
        {
          name: "Funded 💰",
          value: `${fundingSource?.dateString}`,
          inline: true,
        },
        {
          name: "Bought 💿",
          value: `${transactionDate}`,
          inline: true,
        },
        {
          name: "Current Market Cap 💰",
          value: "0.000000805 SOL/token",
          inline: true,
        }
      )
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
}

export {
  handleSetAlert,
  handlePriceList,
  handleMyAlerts,
  handleRegisterToken,
  handleMonitoringTransactions,
  monitorTransaction,
  monitorDeveloperBurns,
};
