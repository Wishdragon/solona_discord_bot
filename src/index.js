import { Client, IntentsBitField } from "discord.js";
import "dotenv/config";
import { Keypair, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { handlePriceList, handleSetAlert } from "./command.js";
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
} from "./constants/command_name.js";
import { handlePriceChangeCommand } from "./priceChange/price_change.js";
import { BurnHistoryTracker } from "./priceChange/burnHistoryTracker.js";
import { WalletBalanceTracker } from "./priceChange/walletBalanceTracker.js";

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
  ],
});

async function init() {
  // initializeDatabase();
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
      default:
        break;
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

init();
