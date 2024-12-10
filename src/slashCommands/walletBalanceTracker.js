import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

class WalletBalanceTracker {
  constructor(connection) {
    this.connection =
      connection ||
      new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    this.priceCache = new Map();
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  }

  async fetchWalletBalances(walletAddress, options = {}) {
    const { currency = "usd", includeNativeSOL = true } = options;

    try {
      const walletPublicKey = new PublicKey(walletAddress);

      // Fetch token accounts
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        walletPublicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      // Process token balances
      const balancePromises = tokenAccounts.value.map(async (tokenAccount) =>
        this.processTokenBalance(tokenAccount, currency)
      );

      // Include native SOL if requested
      if (includeNativeSOL) {
        balancePromises.push(
          this.getNativeSolBalance(walletPublicKey, currency)
        );
      }

      const tokenBalances = await Promise.all(balancePromises);

      // Filter out zero balance tokens
      return tokenBalances.filter((token) => token.balance > 0);
    } catch (error) {
      console.error("Wallet balance fetch error:", error);
      throw new Error(`Failed to retrieve wallet balances: ${error.message}`);
    }
  }

  async processTokenBalance(tokenAccount, currency) {
    try {
      const accountInfo = tokenAccount.account.data.parsed.info;
      const mintAddress = accountInfo.mint;
      const balance = accountInfo.tokenAmount.uiAmount;
      const decimals = accountInfo.tokenAmount.decimals;

      // Fetch token price
      const tokenPrice = await this.getTokenPrice(mintAddress, currency);

      return {
        token: mintAddress,
        symbol: await this.getTokenSymbol(mintAddress),
        balance: balance,
        value: balance * tokenPrice,
        price: tokenPrice,
        decimals: decimals,
      };
    } catch (error) {
      console.error(`Token balance error for ${mintAddress}:`, error);
      return null;
    }
  }

  async getNativeSolBalance(walletPublicKey, currency) {
    try {
      const solBalance = await this.connection.getBalance(walletPublicKey);
      const solPrice = await this.getTokenPrice(
        "So11111111111111111111111111111111111111112",
        currency
      );

      return {
        token: "SOL",
        symbol: "SOL",
        balance: solBalance / 10 ** 9, // Convert lamports to SOL
        value: (solBalance / 10 ** 9) * solPrice,
        price: solPrice,
        decimals: 9,
      };
    } catch (error) {
      console.error("Native SOL balance error:", error);
      return null;
    }
  }

  async getTokenPrice(mintAddress, currency = "usd") {
    // Implement caching to reduce API calls
    const cacheKey = `${mintAddress}-${currency}`;
    const cachedPrice = this.priceCache.get(cacheKey);

    if (
      cachedPrice &&
      Date.now() - cachedPrice.timestamp < this.CACHE_DURATION
    ) {
      return cachedPrice.price;
    }

    try {
      // Multiple price API fallbacks
      const priceAPIs = [
        `https://price.jup.ag/v4/price?ids=${mintAddress}`,
        `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mintAddress}&vs_currencies=${currency}`,
      ];

      for (const apiUrl of priceAPIs) {
        try {
          const response = await axios.get(apiUrl);
          const price = this.extractPriceFromResponse(
            response.data,
            mintAddress,
            currency
          );

          if (price) {
            // Cache the price
            this.priceCache.set(cacheKey, {
              price,
              timestamp: Date.now(),
            });
            return price;
          }
        } catch {}
      }

      return 0;
    } catch (error) {
      console.error(`Price fetch error for ${mintAddress}:`, error);
      return 0;
    }
  }

  extractPriceFromResponse(data, mintAddress, currency) {
    // Handle different API response structures
    if (data.data && data.data[mintAddress]) {
      return data.data[mintAddress].price;
    }

    if (data[mintAddress.toLowerCase()]) {
      return data[mintAddress.toLowerCase()][currency];
    }

    return 0;
  }

  async getTokenSymbol(mintAddress) {
    // Implement token symbol lookup
    // You might want to use a token registry or API
    const symbolMap = {
      So11111111111111111111111111111111111111112: "SOL",
      // Add more known token symbols
    };

    return symbolMap[mintAddress] || mintAddress.substring(0, 6);
  }

  // Discord command handler
  async handleWalletBalanceCommand(interaction) {
    const walletAddress = interaction.options.getString("wallet");
    const currency = interaction.options.getString("currency") || "usd";

    try {
      // Validate wallet address
      if (!this.isValidSolanaAddress(walletAddress)) {
        return interaction.reply({
          content: "Invalid Solana wallet address.",
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      // Fetch wallet balances
      const balances = await this.fetchWalletBalances(walletAddress, {
        currency,
      });

      // Sort balances by total value (descending)
      const sortedBalances = balances
        .sort((a, b) => b.value - a.value)
        .slice(0, 10); // Limit to top 10 tokens

      // Create embed for wallet balances
      const balanceFields = sortedBalances.map((token) => ({
        name: `${token.symbol || "Unknown Token"}`,
        value: `
            **Balance:** ${token.balance.toFixed(token.decimals)}
            **Value:** $${token.value.toFixed(2)} 
            **Price:** $${token.price.toFixed(4)}
          `,
        inline: false,
      }));

      const totalWalletValue = sortedBalances.reduce(
        (sum, token) => sum + token.value,
        0
      );

      const balanceEmbed = {
        color: 0x00ff00,
        title: `💰 Wallet Balance (${currency.toUpperCase()})`,
        description: `**Total Wallet Value:** $${totalWalletValue.toFixed(2)}`,
        fields: balanceFields.length
          ? balanceFields
          : [
              {
                name: "No Tokens",
                value: "No token balances found.",
              },
            ],
        footer: {
          text: `Address: ${this.truncateAddress(walletAddress)}`,
        },
      };

      await interaction.editReply({ embeds: [balanceEmbed] });
    } catch (error) {
      await interaction.editReply({
        content: `Error fetching wallet balances: ${error.message}`,
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

  truncateAddress(address) {
    return `${address.substring(0, 6)}...${address.substring(
      address.length - 6
    )}`;
  }
}

export { WalletBalanceTracker };
