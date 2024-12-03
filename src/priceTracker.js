import fetch from "node-fetch";
import schedule from "node-schedule";
import { checkAlerts } from "./alertManager.js";

let tokenPrices = new Map();

async function updateTokenPrices() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano&vs_currencies=usd"
    );
    const data = await response.json();
    tokenPrices.clear();

    for (const [token, price] of Object.entries(data)) {
      tokenPrices.set(token, price.usd);
    }
  } catch (error) {
    console.error("Error fetching prices:", error);
  }
}

function startPriceTracking() {
  // Initial price update
  updateTokenPrices();

  // Schedule regular updates
  schedule.scheduleJob("*/5 * * * *", async () => {
    await updateTokenPrices();
    await checkAlerts(tokenPrices);
  });
}

export { tokenPrices, updateTokenPrices, startPriceTracking };
