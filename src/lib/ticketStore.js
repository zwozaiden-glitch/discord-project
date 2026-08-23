// Persistent ticket configuration and open-ticket records.
//
// ticketconfigs.json: guildId -> category/support/log/panel configuration
// tickets.json:       channelId -> one currently open ticket
import { db, save } from './store.js';

function id(value) {
  return value == null ? null : String(value);
}

export function getTicketConfig(guildId) {
  if (!guildId) return null;
  return db.ticketconfigs[id(guildId)] || null;
}

export function setTicketConfig(guildId, values) {
  const guildKey = id(guildId);
  if (!guildKey) throw new Error('guildId is required');

  const existing = db.ticketconfigs[guildKey] || {};
  const config = {
    ...existing,
    categoryId: id(values.categoryId),
    supportRoleId: id(values.supportRoleId),
    logChannelId: id(values.logChannelId),
    panelChannelId: id(values.panelChannelId),
    panelMessageId: id(values.panelMessageId),
    title: values.title || 'Support Tickets',
    description:
      values.description ||
      'Need help? Press **Open Ticket** below and the support team will assist you in a private channel.',
    nextNumber: Math.max(1, Number(existing.nextNumber) || 1),
    updatedAt: new Date().toISOString(),
  };

  db.ticketconfigs[guildKey] = config;
  save('ticketconfigs');
  return config;
}

export function takeNextTicketNumber(guildId) {
  const config = getTicketConfig(guildId);
  if (!config) return null;
  const number = Math.max(1, Number(config.nextNumber) || 1);
  config.nextNumber = number + 1;
  config.updatedAt = new Date().toISOString();
  save('ticketconfigs');
  return number;
}

export function getTicket(channelId) {
  if (!channelId) return null;
  return db.tickets[id(channelId)] || null;
}

export function findOpenTicket(guildId, userId) {
  const guildKey = id(guildId);
  const userKey = id(userId);
  return (
    Object.values(db.tickets).find(
      (ticket) => ticket.guildId === guildKey && ticket.userId === userKey
    ) || null
  );
}

export function createTicketRecord({ channelId, guildId, userId, number }) {
  const channelKey = id(channelId);
  if (!channelKey) throw new Error('channelId is required');

  const record = {
    channelId: channelKey,
    guildId: id(guildId),
    userId: id(userId),
    number: Number(number),
    claimedBy: null,
    addedUserIds: [],
    messageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.tickets[channelKey] = record;
  save('tickets');
  return record;
}

export function updateTicket(channelId, changes) {
  const record = getTicket(channelId);
  if (!record) return null;

  Object.assign(record, changes, { updatedAt: new Date().toISOString() });
  if (Array.isArray(record.addedUserIds)) {
    record.addedUserIds = [...new Set(record.addedUserIds.map(String))];
  } else {
    record.addedUserIds = [];
  }
  save('tickets');
  return record;
}

export function removeTicket(channelId) {
  const channelKey = id(channelId);
  if (!channelKey || !db.tickets[channelKey]) return false;
  delete db.tickets[channelKey];
  save('tickets');
  return true;
}
