import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { deobfuscate, detectObfuscator, OBFUSCATORS } from '../lib/deobfuscator.js';

const MAX_BYTES = 1024 * 1024;
const ALLOWED_EXT = ['.lua', '.luau', '.txt', '.luac'];

export default {
  data: new SlashCommandBuilder()
    .setName('deobf')
    .setDescription('Detect the Lua obfuscator, then deobfuscate a script file.')
    .addAttachmentOption((o) =>
      o.setName('file').setDescription('Obfuscated .lua / .luau / .txt file').setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('obfuscator')
        .setDescription('Auto-detect, or pick the obfuscator yourself')
        .setRequired(false)
        .addChoices(...OBFUSCATORS.map((item) => ({ name: item.name, value: item.id })))
    )
    .addBooleanOption((o) =>
      o.setName('detect_only').setDescription('Only detect the obfuscator — do not deobfuscate')
    ),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment('file', true);
    const obfuscator = interaction.options.getString('obfuscator') || 'auto';
    const detectOnly = interaction.options.getBoolean('detect_only') || false;

    const name = (attachment.name || 'script.lua').toLowerCase();
    if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
      return interaction.reply({
        content: `❌ Only ${ALLOWED_EXT.join(', ')} files are allowed (you sent \`${attachment.name}\`).`,
        ephemeral: true,
      });
    }
    if (attachment.size > MAX_BYTES) {
      return interaction.reply({ content: '❌ File is too large (max 1 MB).', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let source;
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      source = await response.text();
    } catch {
      return interaction.editReply({ content: '❌ Could not download the attached file.' });
    }
    if (!source.trim()) return interaction.editReply({ content: '❌ The file is empty.' });

    const detection = detectObfuscator(source);
    const detectLines = detection.hits.length
      ? detection.hits
          .slice(0, 6)
          .map((hit) => `• **${hit.name}** (${hit.confidence}%) — \`${hit.evidence.replace(/`/g, '')}\``)
          .join('\n')
      : '• No known banner — treating as **generic** Lua obfuscation.';

    if (detectOnly) {
      return interaction.editReply({
        content:
          `🔎 **Obfuscator detect** — \`${attachment.name}\`\n${detectLines}\n\n` +
          `${detection.recommendation}\n` +
          `Re-run \`/deobf\` without detect_only (or set \`obfuscator:\`) to clean it.`,
      });
    }

    const result = deobfuscate(source, obfuscator);
    const findings = [];
    if (result.findings.urls.length) {
      findings.push(`**URLs:** ${result.findings.urls.slice(0, 5).map((u) => `\`${u}\``).join(' ')}`);
    }
    if (result.findings.bytecode.length) {
      findings.push(`**Bytecode:** ${result.findings.bytecode.join('; ')}`);
    }
    if (result.findings.strings.length) {
      findings.push(`**Strings:** ${result.findings.strings.length} interesting constant(s)`);
    }

    const tool = OBFUSCATORS.find((item) => item.id === result.obfuscator);
    const header =
      `✅ **Deobf — ${tool?.name || result.obfuscator}** · \`${attachment.name}\`\n` +
      `${detectLines}\n\n` +
      `${result.notes.map((n) => `• ${n}`).join('\n')}\n` +
      `• ${result.stats.inputBytes} → ${result.stats.outputBytes} bytes\n` +
      (findings.length ? `\n${findings.join('\n')}` : '');

    const file = new AttachmentBuilder(Buffer.from(result.output, 'utf8'), {
      name: attachment.name.replace(/\.(lua|luau|txt|luac)$/i, '') + '.deobf.lua',
    });

    await interaction.editReply({ content: header.slice(0, 1900), files: [file] });
  },
};
