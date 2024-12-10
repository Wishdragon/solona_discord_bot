import fetch from "node-fetch";

class TokenPriceFetcher {
  static async fetchTokenPrice(tokenAddress) {
    try {
      // Multiple fallback price APIs
      const apis = [
        `https://price.jup.ag/v4/price?ids=${tokenAddress}`,
        `https://api.solana.fm/v1/tokens/${tokenAddress}/price`,
        `https://public-api.solscan.io/token/meta?tokenAddress=${tokenAddress}`,
      ];

      // Try multiple APIs
      for (const apiUrl of apis) {
        try {
          const response = await axios.get(apiUrl, {
            timeout: 5000,
            headers: {
              Accept: "application/json",
              "User-Agent": "SolanaTokenTracker/1.0",
            },
          });

          // Different APIs have different response structures
          const priceInfo = this.parsePrice(response.data, apiUrl);
          if (priceInfo) return priceInfo;
        } catch (apiError) {
          console.warn(`Failed to fetch from ${apiUrl}:`, apiError.message);
          continue;
        }
      }

      // Fallback coingecko or manual price lookup
      return await this.fallbackPriceLookup(tokenAddress);
    } catch (error) {
      console.error("Comprehensive price fetch error:", error);
      throw new Error("Unable to fetch token price");
    }
  }

  static parsePrice(data, sourceApi) {
    switch (true) {
      // Jupiter Aggregator API
      case sourceApi.includes("jup.ag"):
        return data.data?.[Object.keys(data.data)[0]] || null;

      // Solana.fm API
      case sourceApi.includes("solana.fm"):
        return {
          price: data.price || 0,
          priceChange24h: data.priceChange24h || 0,
        };

      // Solscan API
      case sourceApi.includes("solscan.io"):
        return {
          price: data.price?.usd || 0,
          priceChange24h: data.priceChangePercent || 0,
        };

      default:
        return null;
    }
  }

  static async fallbackPriceLookup(tokenAddress) {
    try {
      // CoinGecko or other fallback price API
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${tokenAddress}&vs_currencies=usd&include_24hr_change=true`
      );

      const tokenData = response.data[tokenAddress.toLowerCase()];
      return {
        price: tokenData?.usd || 0,
        priceChange24h: tokenData?.usd_24h_change || 0,
      };
    } catch (fallbackError) {
      console.error("Fallback price lookup failed:", fallbackError);
      return {
        price: 0,
        priceChange24h: 0,
      };
    }
  }
}
