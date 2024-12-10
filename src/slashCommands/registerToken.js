import { SlashCommandBuilder } from "discord.js";
import { registerToken, mintAddress } from "../constants/command_name.js";

const registerTokenCommand = new SlashCommandBuilder()
  .setName(registerToken)
  .setDescription("Register token to monitor")
  .addStringOption((option) =>
    option
      .setName(mintAddress)
      .setDescription("Add mint address")
      .setRequired(true)
  );

export { registerTokenCommand };
