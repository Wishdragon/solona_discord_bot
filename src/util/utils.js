import { programs } from "@metaplex/js";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

const { Metadata } = programs.metadata;
const QUICK_CONNECT = new Connection(
  "https://practical-thrumming-mountain.solana-mainnet.quiknode.pro/ecb66c08b2c93b801e98a19668ee7bc8df6f8ceb",
  {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  }
);

export async function getTokenMetadata(tokenAddress) {
  try {
    const metadataPDA = await Metadata.getPDA(new PublicKey(tokenAddress));
    const metadata = await Metadata.load(QUICK_CONNECT, metadataPDA);

    const response = await fetch(metadata.data.data.uri);

    // Check if the response is successful
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse the JSON data
    const uriData = await response.json();

    const meta = {
      ...metadata.data,
      data: {
        ...metadata.data.data,
        ...uriData,
      },
    };

    return meta;
  } catch (error) {
    console.error("getTokenMetadata():", error);
  }
}

export async function getTopHolders(monitoredAddress) {
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

  return holdersList;
}

export function extractInformation(txDetails, monitoredAddress) {
  const { meta, transaction, blockTime } = txDetails;
  const preBalances = meta.preBalances;
  const postBalances = meta.postBalances;

  let txDateString;
  if (blockTime) {
    const date = new Date(blockTime * 1000);
    txDateString = timeDifference(date.getTime());
  }

  // Identify SOL inflow and token outflow
  let solReceived = 0;
  let tokenPaid = 0;
  let buyerAddress = "";
  meta.preTokenBalances.forEach((preTokenBalance, index) => {
    const postTokenBalance = meta.postTokenBalances[index];

    if (preTokenBalance.mint === monitoredAddress.toBase58()) {
      if (preTokenBalance.uiTokenAmount && postTokenBalance.uiTokenAmount)
        tokenPaid = Math.abs(
          (preTokenBalance.uiTokenAmount.uiAmount || 0) -
            (postTokenBalance.uiTokenAmount.uiAmount || 0)
        );
    }
  });

  solReceived = Math.abs((postBalances[0] - preBalances[0]) / 1e9); // Lamports to SOL

  // Identify buyer (sender of transaction)
  buyerAddress = transaction.message.accountKeys[0];

  let isPrepaidDEX = false;
  transaction.message.instructions.forEach((instruction, index) => {
    const programId =
      transaction.message.accountKeys[instruction.programIdIndex];
    const knownDEXProgramIDs = [
      "9xQeWvG816bUx9EPjHcB8zixKD6zvQNeCzpx1LtzC6z", // Serum
      "nAqDh2wQRnfnjRU8zQZyz1DjoEVCtx76AzDpp5kPCW4", // Orca
      "4k3Dyjzvzp8eMJN9xYbMxMmhD7f8y3ULp2cRZG2hgNm3", // Raydium,
      "JUP2jxvNmAq9ScfH9xr6ht9WZutUrhYxQbQZfUrwcSN", // Jupiter
      "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ", //Saber
      "AMM55ShGKWzZP5xr4rdrujw9HhRmzzUTnXbH5ii59tz", //Aldrin
      "5KGNRodP3BvGdLjkY7PUoAjtA1oe4eSTZQMRhRx1sPft", //Mango Markets
    ];

    if (knownDEXProgramIDs.includes(programId.toString())) {
      isPrepaidDEX = true;
    }
  });

  return { buyerAddress, solReceived, tokenPaid, txDateString, isPrepaidDEX };
}

export async function getTokenCreationTime(mintPubkey) {
  try {
    const signatures = await QUICK_CONNECT.getSignaturesForAddress(mintPubkey, {
      limit: 1,
      before,
    });
    if (signatures.length === 0) {
      return;
    }
    const firstTransactionSignature =
      signatures[signatures.length - 1].signature;
    const url =
      "https://cosmological-evocative-season.solana-mainnet.quiknode.pro/d9d3e63af0e78584d8477901191a985c9a71966b/";
    const requestBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        firstTransactionSignature,
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
    const txDetails = data.result;
    if (!txDetails) return null;

    const blockTime = txDetails.blockTime;
    if (blockTime) {
      const creationDate = new Date(blockTime * 1000);
      return timeDifference(creationDate.getTime());
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching token creation time:", error);
  }
}

export async function isFreshWallet(walletAddress) {
  try {
    const walletPubKey = new PublicKey(walletAddress);
    const confirmedSignatures = await QUICK_CONNECT.getSignaturesForAddress(
      walletPubKey,
      { limit: 100 }
    );

    const fundingSources = [];
    let isFresh = false;
    if (confirmedSignatures.length < 75) {
      isFresh = true;
    }

    if (isFresh) {
      for (let signatureObj of confirmedSignatures) {
        // const url = "https://api.mainnet-beta.solana.com"; // Devnet Solana endpoint
        const url =
          "https://cosmological-evocative-season.solana-mainnet.quiknode.pro/d9d3e63af0e78584d8477901191a985c9a71966b/";
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
            const fundedAmount = Math.abs(
              (transaction.meta.postBalances[1] -
                transaction.meta.preBalances[1]) /
                1e9
            );

            let transactionDate;
            const blockTime = transaction.blockTime;
            if (blockTime) {
              transactionDate = new Date(blockTime * 1000);
            } else {
              console.log("Block time is not available for this transaction.");
            }
            fundingSources.push({
              senderAddress,
              fundedAmount,
              transactionDate,
            }); // Add sender to funding sources
          }
        }
      }
    }

    let fundingSource;
    if (fundingSources.length > 0) {
      let fundingDate = fundingSources[0].transactionDate;
      for (let i = 0; i < fundingSources.length; i++) {
        if (fundingSources[i].transactionDate < fundingDate) {
          fundingDate = fundingSources[i].transactionDate;
          fundingSource = fundingSources[i];
        }
      }
    } else isFresh = false;

    if (fundingSource) {
      const dateString = timeDifference(fundingSource.transactionDate);
      fundingSource.dateString = dateString;
    }

    return { isFresh, fundingSource }; // If the wallet has no prior transactions, it's fresh
  } catch (error) {
    console.error("Error checking wallet freshness:", error);
    return false;
  }
}

export function timeDifference(timestamp) {
  const now = new Date();
  const givenTime = new Date(timestamp);
  const differenceInSeconds = Math.floor((now - givenTime) / 1000);

  if (differenceInSeconds < 60) {
    return `${differenceInSeconds} seconds ago`;
  } else if (differenceInSeconds < 3600) {
    const minutes = Math.floor(differenceInSeconds / 60);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  } else if (differenceInSeconds < 86400) {
    const hours = Math.floor(differenceInSeconds / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  } else if (differenceInSeconds < 2592000) {
    const days = Math.floor(differenceInSeconds / 86400);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  } else if (differenceInSeconds < 31536000) {
    const months = Math.floor(differenceInSeconds / 2592000);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  } else {
    const years = Math.floor(differenceInSeconds / 31536000);
    return `${years} year${years > 1 ? "s" : ""} ago`;
  }
}
