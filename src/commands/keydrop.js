import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { ensureScript } from '../lib/keySystem.js';
import { formatKey } from '../lib/keys.js';
import { CONFIG } from '../lib/config.js';
import { db } from '../lib/store.js';

function pickUnredeemed(script, amount) {
  const candidates = Object.values(db.keys).filter(
    (k) => k.script === script && !k.claimedBy && !k.voided && !(k.expiresAt && Date.parse(k.expiresAt) < Date.now())
  );
  return candidates.slice(0, amount).map((k) => k.raw);
}

export default {
  data: new SlashCommandBuilder()
    .setName('keydrop')
    .setDescription('Drops N unredeemed keys publicly in chat with a countdown reveal.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script to drop keys for').setRequired(true).setAutocomplete(true)
    )
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many keys to drop (default 1)').setMinValue(1).setMaxValue(10)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      Object.values(db.scripts || {})
        .map((s) => s.name)
        .filter((n) => n.includes(focused))
        .slice(0, 25)
        .map((name) => ({ name, value: name }))
    );
  },

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;

    const script = interaction.options.getString('script', true).trim();
    const amount = interaction.options.getInteger('amount') || 1;

    const record = await ensureScript(script);
    const rawKeys = pickUnredeemed(record.name, amount);

    if (!rawKeys.length) {
      return interaction.reply({
        content: `❌ No unredeemed keys available for **${record.name}**. Generate some with \`/generatekey\` or \`/bulkgen\` first.`,
        ephemeral: true,
      });
    }

    const countdown = CONFIG.dropCountdown;
    const startedAt = Date.now();

    const buildEmbed = (remaining) => {
      const elapsed = Math.min(countdown - remaining, countdown);
      const dots = '🟩'.repeat(Math.floor((elapsed / countdown) * 10)).padEnd(10, '⬛');
      return new EmbedBuilder()
        .setTitle(`🎁 KEYDROP — ${record.name}`)
        .setDescription(`**${rawKeys.length}** key(s) dropping for **${record.name}**!\n${dots}\nKey${rawKeys.length > 1 ? 's' : ''} reveal in **${remaining}s** — whoever claims first wins!`)
        .setColor(0xfee75c)
        .setTimestamp();
    };

    await interaction.reply({ embeds: [buildEmbed(countdown)] });
    const message = await interaction.fetchReply();

    for (let remaining = countdown - 1; remaining >= 1; remaining -= 1) {
      await new Promise((r) => setTimeout(r, 1000));
      if (message.deleted) return;
      await message.edit({ embeds: [buildEmbed(remaining)] });
    }

    // Reveal
    await message.edit({
      content: rawKeys.map((k) => `\`${formatKey(k)}\``).join('  '),
      embeds: [
        new EmbedBuilder()
          .setTitle(`🎉 KEYS REVEALED — ${record.name}`)
          .setDescription('Claim one fast with `/redeem <key>` or the panel button!')
          .setColor(0x57f287)
          .setTimestamp(),
      ],
    });
    for (const emoji of ['🎉', '🔥']) {
      await message.react(emoji).catch(() => {});
    }
  },
};
