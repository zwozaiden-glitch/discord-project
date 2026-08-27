import { Events } from 'discord.js';
import { handleForwardedMessage } from '../lib/forward.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      await handleForwardedMessage(message);
    } catch (error) {
      console.warn('Forward handler failed:', error.message);
    }
  },
};
