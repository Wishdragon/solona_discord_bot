import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";

class BurnHistoryTracker {
  constructor(connection) {
    this.connection =
      connection ||
      new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  }

  async fetchBurnHistory(tokenMintAddress) {
    try {
      const mintPublicKey = new PublicKey(tokenMintAddress);

      // Fetch burn transactions
      const burnTransactions = await this.getBurnTransactions(mintPublicKey);

      // Enrich transaction data
      const enrichedBurnHistory = await Promise.all(
        burnTransactions.map(async (tx) => ({
          ...tx,
          blockTime: await this.getBlockTime(tx.blockHash),
          burnAmount: this.formatTokenAmount(tx.amount, tx.decimals),
        }))
      );

      return enrichedBurnHistory;
    } catch (error) {
      console.error("Burn history fetch error:", error);
      throw new Error(`Failed to retrieve burn history: ${error.message}`);
    }
  }

  async getBurnTransactions(mintPublicKey) {
    try {
      // Search for burn transactions (transfer to null address or 11111...)
      const burnSignatures = await this.connection.getSignaturesForAddress(
        mintPublicKey,
        {
          limit: 50, // Limit to recent 50 burns
          commitment: "confirmed",
        }
      );

      const burnTransactions = [];

      // Fetch details for each burn transaction
      for (const sig of burnSignatures) {
        const txDetails = await this.connection.getParsedTransaction(
          sig.signature
        );

        const burnInfo = this.extractBurnInfo(txDetails);
        if (burnInfo) {
          burnTransactions.push({
            signature: sig.signature,
            blockHash: sig.blockhash,
            ...burnInfo,
          });
        }
      }

      return burnTransactions;
    } catch (error) {
      console.error("Burn transactions retrieval error:", error);
      return [];
    }
  }

  extractBurnInfo(transaction) {
    try {
      // Look for burn-like transactions (transfer to burn address or zero balance)
      const instructions =
        transaction?.transaction?.message?.instructions || [];

      for (const instruction of instructions) {
        if (instruction.program === "spl-token") {
          const burnData = instruction.parsed;

          if (burnData.type === "burn") {
            return {
              amount: burnData.info.amount,
              authority: burnData.info.authority,
              decimals: burnData.info.decimals,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Burn info extraction error:", error);
      return null;
    }
  }

  async getBlockTime(blockHash) {
    try {
      const blockTime = await this.connection.getBlockTime(blockHash);
      return blockTime ? new Date(blockTime * 1000).toISOString() : "Unknown";
    } catch {
      return "Timestamp Unavailable";
    }
  }

  formatTokenAmount(amount, decimals) {
    try {
      return (parseInt(amount) / Math.pow(10, decimals)).toFixed(decimals);
    } catch {
      return "Unknown Amount";
    }
  }

  // Discord command handler
  async handleBurnHistoryCommand(interaction) {
    const tokenAddress = interaction.options.getString("token");

    try {
      // Validate token address
      if (!this.isValidSolanaAddress(tokenAddress)) {
        return interaction.reply({
          content: "Invalid Solana token address.",
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      // Fetch burn history
      const burnHistory = await this.fetchBurnHistory(tokenAddress);

      // Create embed for burn history
      const embedFields = burnHistory.slice(0, 10).map((burn, index) => ({
        name: `Burn #${index + 1}`,
        value: `
          **Amount:** ${burn.burnAmount}
          **Time:** ${burn.blockTime}
          **Signature:** \`${this.truncateSignature(burn.signature)}\`
        `,
        inline: false,
      }));

      const burnEmbed = {
        color: 0xff0000,
        title: `🔥 Burn History for Token`,
        description: `Total Burns: ${burnHistory.length}`,
        fields: embedFields.length
          ? embedFields
          : [
              {
                name: "No Burns",
                value: "No burn transactions found for this token.",
              },
            ],
        footer: { text: "Burn history may not be complete" },
      };

      await interaction.editReply({ embeds: [burnEmbed] });
    } catch (error) {
      await interaction.editReply({
        content: `Error fetching burn history: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  // Utility methods
  isValidSolanaAddress(address) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  truncateSignature(signature) {
    return `${signature.substring(0, 6)}...${signature.substring(
      signature.length - 6
    )}`;
  }
}

export { BurnHistoryTracker };
