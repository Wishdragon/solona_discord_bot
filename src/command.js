import dotenv from "dotenv/config";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
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
  DEV_BURNS_CHANNEL_ID,
  FRESH_ONE_SOL_CHANNEL_ID,
  FRESH_OVER_ONE_SOL_CHANNE_ID,
  LARGE_BUYS_CHANNEL_ID,
  PREPAID_DEX_CHANNEL_ID,
  TEN_DEV_BURNS_CHANNEL_ID,
} from "./constants/channels.js";
import { TOKEN_META_DATA } from "./constants/token_meta_data.js";

// Solana mainnet connection
// const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

const QUICK_CONNECT = new Connection(
  "https://cosmological-evocative-season.solana-mainnet.quiknode.pro/d9d3e63af0e78584d8477901191a985c9a71966b/"
);

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

async function monitorTransactions(client) {
  const connection = new Connection(clusterApiUrl("mainnet-beta"), {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0, // Ensures compatibility with transaction version 0
  });
  TOKEN_META_DATA.map(async (token) => {
    const monitoredAddress = new PublicKey(token.mint);

    const largestAccounts = await QUICK_CONNECT.getTokenLargestAccounts(
      monitoredAddress
    );
    const totalSupply = largestAccounts.value.reduce(
      (acc, account) => acc + account.uiAmount,
      0
    );

    const accountInfoPromises = largestAccounts.value.map(async (account) => {
      return {
        address: account.address,
        amount: account.uiAmount,
      };
    });
    const topHolders = await Promise.all(accountInfoPromises);
    let holdersList = "Top 10 Holders\n";
    topHolders.slice(0, 10).forEach((holder, index) => {
      const percentage = ((holder.amount / totalSupply) * 100).toFixed(2);
      holdersList += `${index + 1}. ${holder.address
        .toBase58()
        .slice(0, 6)} - ${percentage}%\n`;
    });

    connection.onLogs(monitoredAddress, async (logs) => {
      const signature = logs.signature;
      console.log(`${token.name}:`, signature);

      await waitForSeconds(60);

      const url = "https://api.mainnet-beta.solana.com";
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

        const { isFresh, fundingSources } = await isFreshWallet(buyerAddress);

        if (!isFresh && solReceived > 3 && tokenPaid > 0) {
          sendLargeBuysChannel(
            client,
            buyerAddress,
            tokenPaid,
            solReceived,
            holdersList,
            token
          );
        } else if (isFresh && solReceived > 2 && tokenPaid > 0) {
          sendFreshOverOneSoleChannel(
            client,
            fundingSources,
            buyerAddress,
            tokenPaid,
            solReceived,
            holdersList,
            token
          );
        } else if (isFresh && solReceived > 1 && tokenPaid > 0) {
          sendFreshOneSolChannel(
            client,
            fundingSources,
            buyerAddress,
            tokenPaid,
            solReceived,
            holdersList,
            token
          );
        }
      } catch (error) {
        console.error("Error fetching transaction:", error);
      }
    });
  });
}

async function monitorDeveloperBurns(client) {
  const connection = new Connection(clusterApiUrl("mainnet-beta"), {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0, // Ensures compatibility with transaction version 0
  });
  TOKEN_META_DATA.map(async (token) => {
    const monitoredWallet = new PublicKey(token.updateAuthority);

    connection.onLogs(monitoredWallet, async (logs, ctx) => {
      try {
        // const signature = logs.signature;

        const signature =
          "hQnzcHeYPLM4jv5nZ4fwxQHfRhyjQKRqdvTM17PPS3EehTA6dArSwfL9Sfsv1hwJoc7FLSyHexpkkCPaKsKHJbC";
        console.log("Dev Transaction", signature);

        // waitForSeconds(60);

        const url = "https://api.mainnet-beta.solana.com";
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

        const message = txDetails.transaction.message;

        // Look for burn instructions in the transaction
        for (const instruction of message.instructions) {
          const programId =
            message.accountKeys[instruction.programIdIndex].toString();

          // Check if the program is the Token Program (standard for token instructions)
          if (programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
            const data = Buffer.from(instruction.data, "base64");

            // Check if it's a burn instruction (0x0a is the code for burn)
            if (data[0] === 0x0a) {
              const sourceAccount =
                message.accountKeys[instruction.accounts[0]].toString();
              const mint =
                message.accountKeys[instruction.accounts[1]].toString();
              const owner =
                message.accountKeys[instruction.accounts[2]].toString();

              if (mint === token.mint && owner === token.updateAuthority) {
                const amountBuffer = data.slice(1, 9); // Burn amount is in the next 8 bytes
                const amountBurned = amountBuffer.readBigUInt64LE();

                // Fetch total supply to calculate percentage burned
                const tokenSupply = await getTokenSupply(token.mint);
                const burnPercentage = (
                  (amountBurned / tokenSupply) *
                  100
                ).toFixed(2);
                if (burnPercentage < 10)
                  sendDevBurnChannel(
                    client,
                    amountBurned,
                    burnPercentage,
                    token
                  );
                else
                  sendTenDevBurnChannel(
                    client,
                    amountBurned,
                    burnPercentage,
                    token
                  );
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error processing logs: ${error.message}`);
      }
    });
  });
}

// Function to fetch total token supply
async function getTokenSupply(tokenAddress) {
  const tokenSupplyInfo = await QUICK_CONNECT.getTokenSupply(
    new PublicKey(tokenAddress)
  );
  return Number(tokenSupplyInfo.value.amount); // Returns total supply as a number
}

function waitForSeconds(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function sendDevBurnChannel(client, amountBurned, burnPercentage, token) {
  let channel = await client.channels.fetch(DEV_BURNS_CHANNEL_ID);
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
  client,
  buyerAddress,
  tokenPaid,
  solReceived,
  holdersList,
  token
) {
  let channel = await client.channels.fetch(LARGE_BUYS_CHANNEL_ID);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff5733)
      .setTitle(`${token.name.toUpperCase()} (${token.symbol})`)
      .setThumbnail(token.image)
      .addFields(
        {
          name: "Purchase Information 📄",
          value:
            "```" +
            `${buyerAddress.slice(
              0,
              6
            )} purchased ${tokenPaid} PBTC\nBought ${solReceived} SOL` +
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
          value: `[Twitter](${token.twitter})\n[Telegram](${token.telegram})\n[Website](${token.website})`,
          inline: true,
        },
        {
          name: "Useful Links 📎",
          value:
            "[Dev Wallet](https://link-to-dev-wallet) | [Buy Token](https://link-to-buy-token)",
          inline: true,
        },
        { name: "Coin Created 💿", value: "5 hours ago", inline: true },
        { name: "Bought 💿", value: "4 hours ago", inline: true },
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

async function sendFreshOverOneSoleChannel(
  client,
  fundingSources,
  buyerAddress,
  tokenPaid,
  solReceived,
  holdersList,
  token
) {
  let channel = await client.channels.fetch(FRESH_OVER_ONE_SOL_CHANNE_ID);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff5733)
      .setTitle(`${token.name.toUpperCase()} (${token.symbol})`)
      .addFields(
        {
          name: "Purchase Information 📄",
          value:
            "```" +
            `${buyerAddress.slice(
              0,
              6
            )} purchased ${tokenPaid} PBTC\nBought ${solReceived} SOL` +
            "```",
        },
        {
          name: "Wallet Information 📜",
          value:
            "```" +
            `Wallet\n${buyerAddress}\nfunded from\n${fundingSources[0]?.senderAddress}\nfor ${fundingSources[0]?.fundedAmount} SOL` +
            "```",
        },
        {
          name: "Contract Address 📜",
          value: "```" + `${token.mint}` + "```",
        },
        {
          name: "Holders 👯‍♀️",
          value: `${holdersList}`,
        },
        {
          name: "Social Media 📱",
          value: `[Twitter](${token.twitter})\n[Telegram](${token.telegram})\n[Website](${token.website})`,
          inline: true,
        },
        {
          name: "Useful Links 📎",
          value:
            "[Dev Wallet](https://link-to-dev-wallet)|[Buy Token](https://link-to-buy-token)",
          inline: true,
        },
        { name: "Coin Created 💿", value: "5 hours ago", inline: true },
        { name: "Funded 💰", value: "4 hours ago", inline: true },
        { name: "Bought 💿", value: "15 hours ago", inline: true },
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

async function sendFreshOneSolChannel(
  client,
  fundingSources,
  buyerAddress,
  tokenPaid,
  solReceived,
  holdersList
) {
  let channel = await client.channels.fetch(FRESH_ONE_SOL_CHANNEL_ID);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xff5733)
      .setTitle(`${token.name.toUpperCase()} (${token.symbol})`)
      .addFields(
        {
          name: "Purchase Information 📄",
          value:
            "```" +
            `${buyerAddress.slice(
              0,
              6
            )} purchased ${tokenPaid} PBTC\nBought ${solReceived} SOL` +
            "```",
        },
        {
          name: "Wallet Information 📜",
          value:
            "```" +
            `Wallet\n${buyerAddress}\nfunded from\n${fundingSources[0].senderAddress}\nfor ${fundingSources[0].fundedAmount} SOL` +
            "```",
        },
        {
          name: "Contract Address 📜",
          value: "```" + `${token.mint}` + "```",
        },
        {
          name: "Holders 👯‍♀️",
          value: `${holdersList}`,
        },
        {
          name: "Social Media 📱",
          value: `[Twitter](${token.twitter})\n[Telegram](${token.telegram})\n[Website](${token.website})`,
          inline: true,
        },
        {
          name: "Useful Links 📎",
          value:
            "[Dev Wallet](https://link-to-dev-wallet)|[Buy Token](https://link-to-buy-token)",
          inline: true,
        },
        { name: "Coin Created 💿", value: "5 hours ago", inline: true },
        { name: "Funded 💰", value: "4 hours ago", inline: true },
        { name: "Bought 💿", value: "15 hours ago", inline: true },
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

async function isFreshWallet(walletAddress) {
  try {
    const walletPubKey = new PublicKey(walletAddress);
    const confirmedSignatures = await QUICK_CONNECT.getSignaturesForAddress(
      walletPubKey,
      { limit: 10 }
    );

    const fundingSources = [];
    const isFresh = confirmedSignatures.length === 2;

    if (isFresh) {
      for (let signatureObj of confirmedSignatures) {
        const url = "https://api.mainnet-beta.solana.com"; // Devnet Solana endpoint
        const requestBody = {
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [
            signatureObj.signature,
            { maxSupportedTransactionVersion: 0 },
          ],
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        const data = await response.json();
        const transaction = data.result;

        if (transaction && transaction.transaction.message.accountKeys) {
          const senderAddress = transaction.transaction.message.accountKeys[0]; // The sender address is typically the first account in the array
          const receiverAddress =
            transaction.transaction.message.accountKeys[1]; // The receiver is typically the second account in the array

          // If the wallet address is the receiver, it's the wallet we're monitoring
          if (receiverAddress === walletAddress) {
            const fundedAmount =
              transaction.meta.postBalances[1] -
              transaction.meta.preBalances[1];
            fundingSources.push({ senderAddress, fundedAmount }); // Add sender to funding sources
          }
        }
      }
    }

    return { isFresh, fundingSources }; // If the wallet has no prior transactions, it's fresh
  } catch (error) {
    console.error("Error checking wallet freshness:", error);
    return false;
  }
}

export {
  handleSetAlert,
  handlePriceList,
  handleMyAlerts,
  monitorTransactions,
  monitorDeveloperBurns,
};
