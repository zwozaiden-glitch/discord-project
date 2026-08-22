import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { ensureScript, listScripts } from '../lib/keySystem.js';
import { CONFIG } from '../lib/config.js';
import { db, save } from '../lib/store.js';
import { sendLog, clientEmbed } from '../lib/notify.js';
import { buildLoader } from '../lib/loader.js';

const MAX_BYTES = 512 * 1024; // 512 KB
const ALLOWED_EXT = ['.lua', '.luau', '.txt', '.js'];

export default {
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Upload your script — the bot adds the whitelist check and gives you a protected loadstring.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script name to attach it to').setRequired(true).setAutocomplete(true)
    )
    .addAttachmentOption((o) =>
      o.setName('file').setDescription('Your script file (.lua / .luau / .txt)').setRequired(true)
    )
    .addBooleanOption((o) =>
      o.setName('overwrite').setDescription('Replace the current protected script (default false)')
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

    const scriptName = interaction.options.getString('script', true).trim();
    const attachment = interaction.options.getAttachment('file', true);
    const overwrite = interaction.options.getBoolean('overwrite') || false;

    // Validate the file before any network work.
    const ext = (attachment.name || '').toLowerCase();
    if (!ALLOWED_EXT.some((e) => ext.endsWith(e))) {
      return interaction.reply({
        content: `❌ Only ${ALLOWED_EXT.join(', ')} files are allowed (you sent \`${attachment.name}\`).`,
        ephemeral: true,
      });
    }
    if (attachment.size > MAX_BYTES) {
      return interaction.reply({ content: '❌ Script is too large (max 512 KB).', ephemeral: true });
    }

    if (db.scriptsources?.[scriptName]?.source && !overwrite) {
      return interaction.reply({
        content: `ℹ️ **${scriptName}** already has a protected script. Run \`/apply\` again with \`overwrite: true\` to replace it.`,
        ephemeral: true,
      });
    }

    // Acknowledge immediately — Discord times out after 3s if we wait on the download.
    await interaction.deferReply({ ephemeral: true });

    let source;
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      source = await response.text();
    } catch {
      return interaction.editReply({ content: '❌ Could not download the attached file.' });
    }
    if (!source.trim()) return interaction.editReply({ content: '❌ The file is empty.' });

    const record = await ensureScript(scriptName);
    db.scriptsources[scriptName] = {
      name: scriptName,
      source,
      size: source.length,
      version: (db.scriptsources[scriptName]?.version || 0) + 1,
      updatedAt: new Date().toISOString(),
      by: interaction.user.id,
    };
    save('scriptsources');

    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        `📦 Script uploaded — ${record.name}`,
        `Version ${db.scriptsources[scriptName].version} (${(source.length / 1024).toFixed(1)} KB) by ${interaction.user}.`,
        0x5865f2,
      ),
      interaction.guild?.id
    );

    const loader = buildLoader(record.name, null);
    const publicHint = CONFIG.publicUrl
      ? ''
      : `\n⚠️ Set \`PUBLIC_URL\` in Railway Variables to your domain (e.g. \`https://your-service.up.railway.app\`) so loadstrings use the real URL.`;

    await interaction.editReply({
      content:
        `✅ **${record.name}** is protected! (v${db.scriptsources[scriptName].version}, ${(source.length / 1024).toFixed(1)} KB)\n\n` +
        `Users get this from **📦 Get Script** or \`/getscript\`:\n` +
        `\`\`\`lua\n${loader}\n\`\`\`\n` +
        publicHint +
        `\nProtected by **Protect-Vmax** · made by ${CONFIG.creditName}.`,
    });
  },
};
