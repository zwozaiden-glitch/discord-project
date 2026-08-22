import { SlashCommandBuilder } from 'discord.js';
import { claimKey } from '../lib/keySystem.js';
import { formatKey } from '../lib/keys.js';
import { sendLog, clientEmbed } from '../lib/notify.js';

const CLAIM_MESSAGES = {
  invalid: 'That does not look like a valid key. Check for missing/extra characters.',
  not_found: 'Key not found. Double-check it was copied completely.',
  wrong_script: 'That key belongs to a different script.',
  voided: 'This key has been revoked. Ask an admin for a new one.',
  expired: 'This key has expired. Ask an admin for a new one.',
  claimed: 'This key belongs to someone else.',
};

export default {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Claims a key you were given and whitelists you for its script.')
    .addStringOption((o) => o.setName('key').setDescription('Your key, e.g. LSN-XXXXX-XXXXX-XXXXX').setRequired(true)),

  async execute(interaction) {
    const keyInput = interaction.options.getString('key', true);
    const result = claimKey(keyInput, interaction.user.id);
    if (!result.ok) {
      return interaction.reply({
        content: `❌ ${CLAIM_MESSAGES[result.reason] || 'Invalid key.'}`,
        ephemeral: true,
      });
    }

    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        '🎫 Key claimed',
        `${interaction.user} claimed \`${formatKey(result.raw)}\` for **${result.record.script}**.`,
        0x57f287,
      ),
      interaction.guild?.id
    );

    await interaction.reply({
      content: `✅ You are whitelisted for **${result.record.script}**!\nYour key: \`${formatKey(result.raw)}\`\nRun the script — the first run binds this account (HWID) to it.`,
      ephemeral: true,
    });
  },
};
