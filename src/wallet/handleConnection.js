import { PhantomProvider } from "@solana/wallet-adapter-phantom";

let userWallets = new Map();
async function handleWalletConnection(interaction) {
  try {
    // Phantom wallet connection (Solana example)
    const phantomProvider = new PhantomProvider();
    await phantomProvider.connect();

    // Get wallet address
    const publicKey = phantomProvider.publicKey.toBase58();

    // Store wallet connection
    userWallets.set(interaction.user.id, {
      provider: phantomProvider,
      address: publicKey,
      type: "solana",
    });

    await interaction.reply({
      content: `Wallet successfully connected! Address: ${publicKey}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error("Wallet connection error:", error);
    await interaction.reply({
      content: "Failed to connect wallet. Please try again.",
      ephemeral: true,
    });
  }
}

async function displayWalletInfo(interaction) {
  const userWallet = userWallets.get(interaction.user.id);

  if (!userWallet) {
    await interaction.reply({
      content: "No wallet connected. Use /connect-wallet first.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `Connected Wallet:\nAddress: ${userWallet.address}\nType: ${userWallet.type}`,
    ephemeral: true,
  });
}

async function disconnectWallet(interaction) {
  const userWallet = userWallets.get(interaction.user.id);

  if (!userWallet) {
    await interaction.reply({
      content: "No wallet connected.",
      ephemeral: true,
    });
    return;
  }

  // Disconnect wallet provider
  await userWallet.provider.disconnect();

  // Remove from stored wallets
  this.userWallets.delete(interaction.user.id);

  await interaction.reply({
    content: "Wallet successfully disconnected.",
    ephemeral: true,
  });
}

export { handleWalletConnection, displayWalletInfo, disconnectWallet };
