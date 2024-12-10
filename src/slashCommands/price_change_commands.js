import { SlashCommandBuilder } from "discord.js";
import {
  priceChange,
  optionToken,
  burnHistoryString,
  checkBalanceString,
  walletString,
  currencyOptionString,
} from "../constants/command_name.js";

const priceChangeCommand = new SlashCommandBuilder()
  .setName(priceChange)
  .setDescription("See recent price change")
  .addStringOption((option) =>
    option
      .setName(optionToken)
      .setDescription("Add wallet token")
      .setRequired(true)
  );

const burnHistoryCommand = new SlashCommandBuilder()
  .setName(burnHistoryString)
  .setDescription("See token's burn history")
  .addStringOption((option) =>
    option
      .setName(optionToken)
      .setDescription("Enter wallet token")
      .setRequired(true)
  );

const checkBalanceCommand = new SlashCommandBuilder()
  .setName(checkBalanceString)
  .setDescription("Check Wallet balance history")
  .addStringOption((option) =>
    option
      .setName(walletString)
      .setDescription("Enter wallet token")
      .setRequired(true)
  );

export { priceChangeCommand, burnHistoryCommand, checkBalanceCommand };
