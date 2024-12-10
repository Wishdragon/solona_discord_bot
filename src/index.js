import { Client, IntentsBitField, EmbedBuilder } from "discord.js";
import "dotenv/config";
import { Keypair, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import {
  handlePriceList,
  handleSetAlert,
  handleRegisterToken,
  monitorTransactions,
  monitorDeveloperBurns,
  handleMonitoringTransactions,
} from "./command.js";
import {
  priceList,
  setAlert,
  myAlerts,
  connectWallet,
  walletAddress,
  priceChange,
  optionToken,
  burnHistoryString,
  checkBalanceString,
  registerToken,
  mintAddress,
} from "./constants/command_name.js";
import { handlePriceChangeCommand } from "./slashCommands/price_change.js";
import { BurnHistoryTracker } from "./slashCommands/burnHistoryTracker.js";
import { WalletBalanceTracker } from "./slashCommands/walletBalanceTracker.js";
import {
  FRESH_ONE_SOL_CHANNEL_ID,
  LARGE_BUYS_CHANNEL_ID,
  PREPAID_DEX_CHANNEL_ID,
} from "./constants/channels.js";
import { initializeDatabase } from "./util/database.js";

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
  ],
});

async function init() {
  initializeDatabase();
  // startPriceTracking();

  let keypair = Keypair.generate();
  let connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
  // const publicKey = keypair.publicKey;

  const walletInfo = {
    publicKey: keypair.publicKey.toString(),
    secretKey: Buffer.from(keypair.secretKey).toString("hex"),
  };

  const burnTracker = new BurnHistoryTracker();
  const walletBalance = new WalletBalanceTracker();

  // Listen for when the bot is ready
  client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    handleMonitoringTransactions(client);

    // monitorTransactions(client);
    // monitorDeveloperBurns(client);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    switch (commandName) {
      case connectWallet:
        const walletAddressKey = options.get(walletAddress).value;
        const publicKey = new PublicKey(walletAddressKey);
        const accountInfo = await connection.getAccountInfo(publicKey);
        const balance = await connection.getBalance(publicKey);
        console.log("accountInfo :::", accountInfo);
        await interaction.reply({
          content: `🔗 Wallet successfully connected!
  Wallet Address: ${walletInfo.publicKey}
  Balance: ${balance / 1000000000} SOL`,
          ephemeral: true,
        });
        break;
      case priceList:
        await handlePriceList(interaction);
        break;
      case setAlert:
        const token = options.get("token").value;
        const price = options.get("price").value;
        const direction = options.get("direction").value;
        await handleSetAlert(interaction, token, price, direction);
        break;
      case priceChange:
        handlePriceChangeCommand(interaction);
        break;
      case burnHistoryString:
        await burnTracker.handleBurnHistoryCommand(interaction);
        break;
      case checkBalanceString:
        await walletBalance.handleWalletBalanceCommand(interaction);
        break;
      case registerToken:
        const mint = options.get(mintAddress).value;
        await handleRegisterToken(interaction, mint);
        console.log("token mint :::", mint);
        break;
      default:
        break;
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

init();
