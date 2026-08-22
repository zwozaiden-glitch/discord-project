import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { ensureScript, makeKey } from '../lib/keySystem.js';
import { formatKey } from '../lib/keys.js';
import { sendDM } from '../lib/notify.js';
import { loaderMessage } from '../lib/loader.js';
import { db } from '../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('generatekey')
    .setDescription('Generates an unredeemed key for one of your scripts.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script the key is for').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('How long the key stays valid')
        .addChoices(
          { name: 'Never expires', value: 'never' },
          { name: '1 day', value: '1d' },
          { name: '3 days', value: '3d' },
          { name: '7 days', value: '7d' },
          { name: '30 days', value: '30d' }
        )
    )
    .addUserOption((o) => o.setName('user').setDescription('Immediately whitelist this user (optional)')),

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
    const duration = interaction.options.getString('duration') || 'never';
    const user = interaction.options.getUser('user');

    if (user) await interaction.deferReply({ ephemeral: true });

    const record = await ensureScript(script);
    const raw = makeKey(record.name, {
      duration,
      createdBy: interaction.user.id,
      claimedBy: user?.id || null,
    });

    const formatted = formatKey(raw);
    const content = `🔑 Key for **${record.name}** (\`${duration}\`):\n\`\`\`\n${formatted}\n\`\`\``;
    const hasSource = Boolean(db.scriptsources?.[record.name]?.source);

    if (user) {
      const dmBody = hasSource
        ? `🎫 You have been whitelisted for **${record.name}**!\nYour key: \`${formatted}\`\n\n${loaderMessage(record.name, raw)}`
        : `🎫 You have been whitelisted for **${record.name}**!\nYour key: \`${formatted}\`\nRun the script — the first run binds this account (HWID) to it.`;
      const sent = await sendDM(interaction.client, user.id, { content: dmBody });
      return interaction.editReply({
        content: `${content}\n✅ User <@${user.id}> whitelisted${sent ? '' : ' — ⚠️ could not DM them, send the key yourself!'}`,
      });
    }

    await interaction.reply({ content, ephemeral: true });
  },
};
