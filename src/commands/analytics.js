import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { analyticsStats } from '../lib/analytics.js';
import { listScripts } from '../lib/keySystem.js';
import { CONFIG } from '../lib/config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('Shows script run analytics: validations, records by day, top keys, recent activity.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Filter to one script (default: all)').setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      listScripts()
        .map((s) => s.name)
        .filter((n) => n.includes(focused))
        .slice(0, 25)
        .map((name) => ({ name, value: name }))
    );
  },

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;

    const script = interaction.options.getString('script');
    const stats = analyticsStats({ script });

    const dayBar = stats.byDay
      .map((d) => `\`${d.label}\` ${'█'.repeat(Math.min(Math.ceil(d.count / Math.max(1, stats.last7d / 8)), 20)).padEnd(20, '░')} ${d.count}`)
      .join('\n');

    const topKeys = stats.topKeys.length
      ? stats.topKeys.map((k) => `\`${k.key}\` — **${k.count}** runs`).join('\n')
      : 'No runs yet.';

    const recent = stats.recent.length
      ? stats.recent
          .map((e) => `<t:${Math.floor(e.t / 1000)}:t> · **${e.script || '-'}** · \`${e.code}\` · \`${e.hwid}\` · \`${e.key}\``)
          .join('\n')
      : 'No runs yet.';

    const embed = new EmbedBuilder()
      .setTitle(`📊 Analytics${script ? ` — ${script}` : ''} (all scripts)`)
      .setColor(0x5865f2)
      .setTimestamp()
      .addFields(
        { name: 'Total validations', value: `**${stats.total}**`, inline: true },
        { name: 'Last 24h', value: `**${stats.last24h}**`, inline: true },
        { name: 'Last 7 days', value: `**${stats.last7d}**`, inline: true },
        { name: 'Last 7 days', value: `\`\`\`\n${dayBar}\n\`\`\``, inline: false },
        { name: 'Top keys', value: topKeys, inline: false },
        { name: 'Recent activity', value: recent, inline: false },
      )
      .setFooter({ text: `Protect-Vmax · by ${CONFIG.creditName}` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
