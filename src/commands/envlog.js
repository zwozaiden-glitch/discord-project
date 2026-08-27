import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { envLoggerSource } from '../lib/deobfuscator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('envlog')
    .setDescription('Get the ENV-Logger dump script (getsenv functions/values/upvalues).'),

  async execute(interaction) {
    const source = envLoggerSource();
    const file = new AttachmentBuilder(Buffer.from(source, 'utf8'), { name: 'env-logger.lua' });
    await interaction.reply({
      content:
        '🧬 **ENV-Logger** — dump a LocalScript environment from your executor.\n' +
        '1. Set `getgenv().FilePath` to the Script/LocalScript Instance\n' +
        '2. Optional: `getgenv().Flags` (`only-functions`, `no-tables`, `no-writing`, …)\n' +
        '3. Paste/run this file. It prints and `writefile`s the dump.',
      files: [file],
      ephemeral: true,
    });
  },
};
