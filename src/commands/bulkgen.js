import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { ensureScript, generateKeys } from '../lib/keySystem.js';
import { formatKey } from '../lib/keys.js';
import { sendLog, clientEmbed } from '../lib/notify.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bulkgen')
    .setDescription('Bulk-generates N unredeemed keys for a script (only you can see the result).')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script the keys are for').setRequired(true).setAutocomplete(true)
    )
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many keys (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('How long the keys stay valid')
        .addChoices(
          { name: 'Never expires', value: 'never' },
          { name: '1 day', value: '1d' },
          { name: '3 days', value: '3d' },
          { name: '7 days', value: '7d' },
          { name: '30 days', value: '30d' }
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      Object.values((await import('../lib/store.js')).db.scripts || {})
        .map((s) => s.name)
        .filter((n) => n.includes(focused))
        .slice(0, 25)
        .map((name) => ({ name, value: name }))
    );
  },

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;

    const script = interaction.options.getString('script', true).trim();
    const amount = interaction.options.getInteger('amount', true);
    const duration = interaction.options.getString('duration') || 'never';

    const record = await ensureScript(script);
    const rawKeys = generateKeys(record.name, amount, { duration, createdBy: interaction.user.id, dropped: false });
    const list = rawKeys.map(formatKey).join('\n');

    // Private canalization: keys stay in the log channel so they survive a crash.
    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        `📦 Bulk generated ${rawKeys.length} keys — ${record.name} (${duration})`,
        `\`\`\`\n${list}\n\`\`\``,
        0x5865f2
      )
    );

    const block = `\`\`\`\n${list}\n\`\`\``;
    const reply =
      block.length <= 1900
        ? { content: `✅ Generated **${rawKeys.length}** keys for **${record.name}**:\n${block}`, ephemeral: true }
        : {
            content: `✅ Generated **${rawKeys.length}** keys for **${record.name}** — too many to show in one message, they were saved to the log channel.`,
            ephemeral: true,
          };

    await interaction.reply(reply);
  },
};
