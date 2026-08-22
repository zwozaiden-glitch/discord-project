// Small helpers shared by slash commands.

// Run async work over a list with a fixed concurrency (keeps Discord rate-limits happy).
export async function mapPool(items, concurrency, fn) {
  const list = [...items];
  const limit = Math.max(1, Math.min(concurrency, list.length || 1));
  const results = new Array(list.length);
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return results;
}

// Pull every member that currently has `roleId`. Uses the cache when it's
// already complete so we don't wait on a full guild member sweep.
export async function fetchRoleMembers(guild, roleId) {
  if (!guild) throw new Error('no guild');

  try {
    if (guild.members.cache.size < guild.memberCount) {
      await guild.members.fetch();
    }
  } catch {
    // Missing Server Members Intent — fall through to whatever is cached.
  }

  const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) throw new Error('role not found');
  return [...role.members.values()];
}
