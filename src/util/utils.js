import { programs } from "@metaplex/js";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

const { Metadata } = programs.metadata;
const QUICK_CONNECT = new Connection(
  "https://cosmological-evocative-season.solana-mainnet.quiknode.pro/d9d3e63af0e78584d8477901191a985c9a71966b/"
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
