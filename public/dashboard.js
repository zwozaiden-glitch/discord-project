const PV = window.PVAuth;

const STATE = {
  session: null,
  data: null,
  view: 'overview',
};

const TITLES = {
  overview: 'Overview',
  rules: 'Rules',
  activity: 'Activity',
  settings: 'Settings',
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function fmtBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + ' MB';
  return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function fmtDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function toast(message) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  wrap.appendChild(item);
  requestAnimationFrame(() => item.classList.add('show'));
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 250);
  }, 2400);
}

async function api(path, options) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    },
    ...options,
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message = body && body.message ? body.message : 'Request failed (' + res.status + ')';
    const error = new Error(message);
    error.status = res.status;
    error.body = body;
    throw error;
  }

  return body;
}

function demoOverview(session) {
  return {
    status: 'ok',
    user: session.user,
    system: {
      botConnected: true,
      botTag: 'VMaxForwarder#0001',
      activeRules: 3,
      totalRules: 4,
      filesForwarded: 1824,
      failedTransfers: 17,
      duplicatesBlocked: 63,
      oversizedBlocked: 9,
      lastActivityAt: new Date().toISOString(),
      lastError: { message: 'Sample: oversized archive rejected by rule size limit.' },
    },
    rules: [
      {
        id: 'fwd_demo_1',
        sourceGuildId: '111111111111111111',
        sourceGuildName: 'Artists Hub',
        sourceChannelId: '222222222222222222',
        sourceChannelName: 'uploads',
        destinationType: 'webhook',
        destWebhookRedacted: 'webhook:9999/abcd…wxyz',
        enabled: true,
        allowedFileTypes: ['png', 'jpg', 'gif', 'webp', 'mp4'],
        maxFileSizeBytes: 8388608,
        forwardText: true,
        forwardEmbeds: false,
        showAuthor: true,
        stats: {
          forwardedCount: 1140,
          imageCount: 937,
          videoCount: 203,
          documentCount: 0,
          archiveCount: 0,
          textCount: 0,
          otherCount: 0,
          failedCount: 8,
          duplicateCount: 21,
          oversizedCount: 3,
          lastForwardedAt: new Date().toISOString(),
          lastFailedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
      },
      {
        id: 'fwd_demo_2',
        sourceGuildId: '111111111111111111',
        sourceGuildName: 'Artists Hub',
        sourceChannelId: '333333333333333333',
        sourceChannelName: 'deliveries',
        destinationType: 'channel',
        destinationChannelId: '444444444444444444',
        destinationGuildId: '111111111111111111',
        destinationGuildName: 'Artists Hub',
        destinationChannelName: 'archive',
        enabled: true,
        allowedFileTypes: ['pdf', 'zip', 'txt', 'json'],
        maxFileSizeBytes: 12582912,
        forwardText: true,
        forwardEmbeds: true,
        showAuthor: false,
        stats: {
          forwardedCount: 562,
          imageCount: 0,
          videoCount: 0,
          documentCount: 334,
          archiveCount: 112,
          textCount: 41,
          otherCount: 0,
          failedCount: 5,
          duplicateCount: 32,
          oversizedCount: 4,
          lastForwardedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
          lastFailedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        },
      },
    ],
    recentHistory: [
      {
        updatedAt: new Date().toISOString(),
        status: 'forwarded',
        attachmentName: 'concept-sheet.png',
        sizeLabel: '2.4 MB',
        category: 'image',
        authorName: 'Demo Artist',
        sourceChannelName: 'uploads',
        destination: 'webhook:9999/abcd…wxyz',
      },
      {
        updatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        status: 'oversized',
        attachmentName: 'release-build.zip',
        sizeLabel: '17.8 MB',
        category: 'archive',
        authorName: 'Build Bot',
        sourceChannelName: 'deliveries',
        destination: 'archive',
        reason: 'File exceeds the 12.00 MB rule limit.',
      },
    ],
    recentLogs: [
      {
        level: 'info',
        createdAt: new Date().toISOString(),
        message: 'Forwarded concept-sheet.png from uploads → webhook:9999/abcd…wxyz',
      },
      {
        level: 'warn',
        createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        message: 'Blocked oversized release-build.zip (17.8 MB) for rule fwd_demo_2',
      },
    ],
  };
}

async function loadOverview() {
  if (STATE.session && STATE.session.demo) {
    STATE.data = demoOverview(STATE.session);
    return;
  }
  STATE.data = await api('/api/forwarder/overview');
}

function card(value, label, sub) {
  return (
    '<article class="glass stat-card">' +
      '<div class="stat-value">' + escapeHtml(value) + '</div>' +
      '<div class="stat-label">' + escapeHtml(label) + '</div>' +
      (sub ? '<div class="stat-sub">' + escapeHtml(sub) + '</div>' : '') +
    '</article>'
  );
}

function systemCards(system) {
  return (
    '<div class="stats-grid">' +
      card(fmtNumber(system.filesForwarded), 'Files forwarded', system.botConnected ? 'Bot online' : 'Bot offline') +
      card(fmtNumber(system.activeRules), 'Active rules', fmtNumber(system.totalRules) + ' total configured') +
      card(fmtNumber(system.failedTransfers), 'Failed transfers', fmtNumber(system.duplicatesBlocked) + ' duplicates blocked') +
      card(fmtNumber(system.oversizedBlocked), 'Oversized blocks', system.lastActivityAt ? 'Last activity ' + fmtDate(system.lastActivityAt) : 'No activity yet') +
    '</div>'
  );
}

function ruleDestination(rule) {
  return rule.destinationType === 'webhook'
    ? (rule.destWebhookRedacted || 'webhook')
    : (rule.destinationChannelName || rule.destinationChannelId || 'channel');
}

function ruleRow(rule) {
  return (
    '<tr>' +
      '<td><div class="table-title">' + escapeHtml(rule.sourceChannelName || rule.sourceChannelId) + '</div><div class="table-sub">' + escapeHtml(rule.sourceGuildName || rule.sourceGuildId || '') + '</div></td>' +
      '<td>' + escapeHtml(ruleDestination(rule)) + '</td>' +
      '<td><span class="badge ' + (rule.enabled ? 'badge-on' : 'badge-off') + '">' + (rule.enabled ? 'Enabled' : 'Disabled') + '</span></td>' +
      '<td>' + escapeHtml((rule.allowedFileTypes || []).join(', ')) + '</td>' +
      '<td>' + escapeHtml(fmtBytes(rule.maxFileSizeBytes)) + '</td>' +
      '<td>' + escapeHtml(fmtNumber(rule.stats && rule.stats.forwardedCount)) + '</td>' +
      '<td class="actions-cell">' +
        '<button class="btn btn-ghost btn-sm" data-action="test" data-rule-id="' + escapeHtml(rule.id) + '">Test</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="toggle" data-enabled="' + (rule.enabled ? '1' : '0') + '" data-rule-id="' + escapeHtml(rule.id) + '">' + (rule.enabled ? 'Disable' : 'Enable') + '</button>' +
        '<button class="btn btn-ghost btn-sm danger" data-action="delete" data-rule-id="' + escapeHtml(rule.id) + '">Delete</button>' +
      '</td>' +
    '</tr>'
  );
}

function historyRow(entry) {
  return (
    '<tr>' +
      '<td>' + escapeHtml(fmtDate(entry.updatedAt)) + '</td>' +
      '<td><span class="badge badge-' + escapeHtml(entry.status || 'info') + '">' + escapeHtml(entry.status || 'unknown') + '</span></td>' +
      '<td>' + escapeHtml(entry.attachmentName || 'message payload') + '</td>' +
      '<td>' + escapeHtml(entry.category || 'other') + '</td>' +
      '<td>' + escapeHtml(entry.sizeLabel || '—') + '</td>' +
      '<td>' + escapeHtml(entry.sourceChannelName || entry.sourceChannelId || '—') + '</td>' +
      '<td>' + escapeHtml(entry.destination || '—') + '</td>' +
    '</tr>'
  );
}

function logRow(entry) {
  return (
    '<div class="log-item log-' + escapeHtml(entry.level || 'info') + '">' +
      '<div class="log-meta">' + escapeHtml(fmtDate(entry.createdAt)) + ' · ' + escapeHtml((entry.level || 'info').toUpperCase()) + '</div>' +
      '<div class="log-message">' + escapeHtml(entry.message || '') + '</div>' +
    '</div>'
  );
}

function overviewView(data) {
  const system = data.system || {};
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const lastError = system.lastError && system.lastError.message ? system.lastError.message : 'No recent delivery errors.';

  return (
    '<section class="view">' +
      '<div class="view-head"><h1 class="view-title">VMax Forwarder Dashboard</h1><p class="view-sub">Monitor delivery health, review recent activity, and manage your forwarding pipeline in one place.</p></div>' +
      systemCards(system) +
      '<div class="grid-2 gap-lg">' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>System status</h2><span class="badge ' + (system.botConnected ? 'badge-on' : 'badge-error') + '">' + (system.botConnected ? 'Connected' : 'Offline') + '</span></div>' +
          '<ul class="detail-list">' +
            '<li><span>Discord bot</span><strong>' + escapeHtml(system.botTag || 'Not connected') + '</strong></li>' +
            '<li><span>Images forwarded</span><strong>' + escapeHtml(fmtNumber(rules.reduce((sum, rule) => sum + Number((rule.stats && rule.stats.imageCount) || 0), 0))) + '</strong></li>' +
            '<li><span>Videos forwarded</span><strong>' + escapeHtml(fmtNumber(rules.reduce((sum, rule) => sum + Number((rule.stats && rule.stats.videoCount) || 0), 0))) + '</strong></li>' +
            '<li><span>Documents forwarded</span><strong>' + escapeHtml(fmtNumber(rules.reduce((sum, rule) => sum + Number((rule.stats && rule.stats.documentCount) || 0), 0))) + '</strong></li>' +
          '</ul>' +
        '</section>' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>Attention</h2><span class="badge badge-warn">Protected</span></div>' +
          '<p class="muted">Webhook URLs are redacted in the dashboard and never echoed back from the API. Store your bot token, OAuth secret, and optional forwarder secret in environment variables.</p>' +
          '<div class="notice-block">' + escapeHtml(lastError) + '</div>' +
        '</section>' +
      '</div>' +
      '<section class="glass panel mt-lg">' +
        '<div class="panel-head"><h2>Recent rules</h2><button class="btn btn-ghost btn-sm" data-goto="rules">Open rules</button></div>' +
        (rules.length
          ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Destination</th><th>Status</th><th>Types</th><th>Max size</th><th>Forwarded</th><th></th></tr></thead><tbody>' + rules.slice(0, 5).map(ruleRow).join('') + '</tbody></table></div>'
          : '<div class="empty-state"><h3>No rules configured</h3><p>Create your first forwarding rule to start monitoring and relaying attachments.</p><button class="btn btn-primary btn-sm" data-goto="rules">Create rule</button></div>') +
      '</section>' +
    '</section>'
  );
}

function rulesView(data) {
  const rules = Array.isArray(data.rules) ? data.rules : [];
  return (
    '<section class="view">' +
      '<div class="view-head"><h1 class="view-title">Forwarding rules</h1><p class="view-sub">Create channel-to-webhook or channel-to-channel routes with file filters, size limits, and author display controls.</p></div>' +
      '<div class="grid-2 gap-lg align-start">' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>Create rule</h2><span class="badge badge-on">Secure</span></div>' +
          '<form id="rule-form" class="form-grid">' +
            '<label><span>Source server ID</span><input name="sourceGuildId" required placeholder="123456789012345678" /></label>' +
            '<label><span>Source server name</span><input name="sourceGuildName" placeholder="Optional label" /></label>' +
            '<label><span>Source channel ID</span><input name="sourceChannelId" required placeholder="123456789012345678" /></label>' +
            '<label><span>Source channel name</span><input name="sourceChannelName" placeholder="Optional label" /></label>' +
            '<label class="full"><span>Destination webhook URL</span><input name="destinationWebhook" placeholder="https://discord.com/api/webhooks/..." /></label>' +
            '<label class="full"><span>Destination channel ID</span><input name="destinationChannelId" placeholder="Optional if bot can post there directly" /></label>' +
            '<label class="full"><span>Allowed file types</span><input name="allowedFileTypes" value="all" placeholder="all or png,jpg,pdf,zip" /></label>' +
            '<label><span>Maximum file size (MB)</span><input name="maxFileSizeMb" type="number" min="1" max="100" value="8" /></label>' +
            '<label class="toggle"><input name="forwardText" type="checkbox" checked /><span>Forward text/captions</span></label>' +
            '<label class="toggle"><input name="forwardEmbeds" type="checkbox" /><span>Forward embeds</span></label>' +
            '<label class="toggle"><input name="showAuthor" type="checkbox" checked /><span>Show author information</span></label>' +
            '<label class="toggle"><input name="enabled" type="checkbox" checked /><span>Enable immediately</span></label>' +
            '<div class="full form-actions"><button class="btn btn-primary" type="submit">Create forwarding rule</button></div>' +
          '</form>' +
        '</section>' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>Rule notes</h2><span class="badge badge-warn">Official API only</span></div>' +
          '<ul class="bullet-list">' +
            '<li>Use a destination webhook for servers where the bot is not installed.</li>' +
            '<li>Direct destination channel IDs only work when the bot can already post there.</li>' +
            '<li>Webhook URLs are redacted in the dashboard after saving.</li>' +
            '<li>Duplicate attachment deliveries are blocked using persistent message/attachment history.</li>' +
            '<li>Oversized files are logged instead of crashing the worker.</li>' +
          '</ul>' +
        '</section>' +
      '</div>' +
      '<section class="glass panel mt-lg">' +
        '<div class="panel-head"><h2>Configured rules</h2><span class="badge badge-neutral">' + escapeHtml(String(rules.length)) + '</span></div>' +
        (rules.length
          ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Destination</th><th>Status</th><th>Types</th><th>Max size</th><th>Forwarded</th><th></th></tr></thead><tbody>' + rules.map(ruleRow).join('') + '</tbody></table></div>'
          : '<div class="empty-state"><h3>No forwarding rules yet</h3><p>Fill out the form above to create your first rule.</p></div>') +
      '</section>' +
    '</section>'
  );
}

function activityView(data) {
  const history = Array.isArray(data.recentHistory) ? data.recentHistory : [];
  const logs = Array.isArray(data.recentLogs) ? data.recentLogs : [];
  return (
    '<section class="view">' +
      '<div class="view-head"><h1 class="view-title">Activity & logs</h1><p class="view-sub">Review forwarded files, blocked duplicates, webhook errors, permission problems, and configuration changes.</p></div>' +
      '<div class="grid-2 gap-lg align-start">' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>Forward history</h2><span class="badge badge-neutral">' + escapeHtml(String(history.length)) + '</span></div>' +
          (history.length
            ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Status</th><th>Attachment</th><th>Type</th><th>Size</th><th>Source</th><th>Destination</th></tr></thead><tbody>' + history.map(historyRow).join('') + '</tbody></table></div>'
            : '<div class="empty-state"><h3>No history yet</h3><p>Forwarded events will appear here after the first delivery.</p></div>') +
        '</section>' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>Recent logs</h2><button class="btn btn-ghost btn-sm" id="load-logs" type="button">Reload</button></div>' +
          (logs.length
            ? '<div class="log-list">' + logs.map(logRow).join('') + '</div>'
            : '<div class="empty-state"><h3>No logs yet</h3><p>Operational events will appear here as rules are used.</p></div>') +
        '</section>' +
      '</div>' +
    '</section>'
  );
}

function settingsView(data) {
  const user = data.user || (STATE.session && STATE.session.user) || {};
  const system = data.system || {};
  return (
    '<section class="view">' +
      '<div class="view-head"><h1 class="view-title">Dashboard settings</h1><p class="view-sub">Dashboard access is limited to the bot owner or explicitly configured forwarder managers.</p></div>' +
      '<div class="grid-2 gap-lg align-start">' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>Signed-in account</h2><span class="badge badge-on">Authenticated</span></div>' +
          '<ul class="detail-list">' +
            '<li><span>Name</span><strong>' + escapeHtml(user.global_name || user.username || 'Unknown user') + '</strong></li>' +
            '<li><span>Username</span><strong>@' + escapeHtml(user.username || 'unknown') + '</strong></li>' +
            '<li><span>User ID</span><strong class="mono">' + escapeHtml(user.id || '—') + '</strong></li>' +
            '<li><span>Bot status</span><strong>' + escapeHtml(system.botTag || 'offline') + '</strong></li>' +
          '</ul>' +
        '</section>' +
        '<section class="glass panel">' +
          '<div class="panel-head"><h2>Security checklist</h2><span class="badge badge-neutral">Production</span></div>' +
          '<ul class="bullet-list">' +
            '<li>Keep DISCORD_TOKEN and DISCORD_CLIENT_SECRET in environment variables only.</li>' +
            '<li>Set FORWARDER_SECRET_KEY to encrypt saved webhook URLs at rest.</li>' +
            '<li>Limit dashboard access with OWNER_IDS or FORWARDER_DASHBOARD_USER_IDS.</li>' +
            '<li>Use destination webhooks only when the destination admin intentionally created them.</li>' +
            '<li>Never attempt to bypass Discord server permissions or automate user accounts.</li>' +
          '</ul>' +
          '<div class="form-actions"><button class="btn btn-ghost" id="settings-logout" type="button">Log out</button></div>' +
        '</section>' +
      '</div>' +
    '</section>'
  );
}

function gate(title, text, buttonText) {
  return (
    '<section class="gate reveal is-visible">' +
      '<div class="glass gate-card">' +
        '<h1>' + escapeHtml(title) + '</h1>' +
        '<p class="gate-note">' + escapeHtml(text) + '</p>' +
        '<div class="gate-actions">' +
          '<button class="btn btn-primary btn-lg" id="gate-login" type="button">' + escapeHtml(buttonText || 'Log in with Discord') + '</button>' +
          (PV && PV.CONFIG && PV.CONFIG.DEMO_ENABLED ? '<a class="btn btn-ghost btn-lg" href="dashboard.html?demo=1">Open demo dashboard</a>' : '') +
        '</div>' +
      '</div>' +
    '</section>'
  );
}

function forbiddenScreen(message) {
  return (
    '<section class="gate reveal is-visible">' +
      '<div class="glass gate-card">' +
        '<h1>Access denied</h1>' +
        '<p class="gate-note">' + escapeHtml(message) + '</p>' +
        '<div class="gate-actions">' +
          '<a class="btn btn-ghost btn-lg" href="/">Return home</a>' +
          '<button class="btn btn-primary btn-lg" id="settings-logout" type="button">Log out</button>' +
        '</div>' +
      '</div>' +
    '</section>'
  );
}

function render() {
  const root = document.getElementById('dashboard-root');
  if (!root) return;
  if (!STATE.data) {
    root.innerHTML = '<div class="loading">Loading VMax Forwarder Dashboard…</div>';
    return;
  }

  const view = STATE.view;
  const html = {
    overview: overviewView,
    rules: rulesView,
    activity: activityView,
    settings: settingsView,
  }[view](STATE.data);

  root.innerHTML = html;
  document.getElementById('topbar-title').textContent = TITLES[view] || 'Overview';
  document.querySelectorAll('.side-link').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-view') === view);
  });

  bindViewActions(root);
}

function setView(view) {
  STATE.view = TITLES[view] ? view : 'overview';
  render();
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (sidebar) sidebar.classList.remove('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

async function refreshData(showToastMessage) {
  const root = document.getElementById('dashboard-root');
  if (root) root.innerHTML = '<div class="loading">Refreshing dashboard data…</div>';
  await loadOverview();
  render();
  if (showToastMessage) toast('Dashboard refreshed');
}

async function submitRuleForm(form) {
  const fd = new FormData(form);
  const payload = {
    sourceGuildId: String(fd.get('sourceGuildId') || '').trim(),
    sourceGuildName: String(fd.get('sourceGuildName') || '').trim(),
    sourceChannelId: String(fd.get('sourceChannelId') || '').trim(),
    sourceChannelName: String(fd.get('sourceChannelName') || '').trim(),
    destinationWebhook: String(fd.get('destinationWebhook') || '').trim(),
    destinationChannelId: String(fd.get('destinationChannelId') || '').trim(),
    allowedFileTypes: String(fd.get('allowedFileTypes') || 'all').trim(),
    maxFileSizeBytes: Number(fd.get('maxFileSizeMb') || 8) * 1024 * 1024,
    forwardText: fd.get('forwardText') === 'on',
    forwardEmbeds: fd.get('forwardEmbeds') === 'on',
    showAuthor: fd.get('showAuthor') === 'on',
    enabled: fd.get('enabled') === 'on',
  };

  await api('/api/forwarder/rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  form.reset();
  form.elements.allowedFileTypes.value = 'all';
  form.elements.maxFileSizeMb.value = '8';
  form.elements.forwardText.checked = true;
  form.elements.forwardEmbeds.checked = false;
  form.elements.showAuthor.checked = true;
  form.elements.enabled.checked = true;
  await refreshData(false);
  setView('rules');
  toast('Forwarding rule created');
}

async function handleRuleAction(action, ruleId, enabled) {
  if (action === 'delete' && !window.confirm('Delete this forwarding rule?')) return;
  const endpoint = '/api/forwarder/rules/' + encodeURIComponent(ruleId) + '/' + action;
  await api(endpoint, { method: 'POST', body: '{}' });
  await refreshData(false);
  if (action === 'delete') toast('Rule deleted');
  if (action === 'test') toast('Test payload sent');
  if (action === 'enable' || action === 'disable') toast('Rule updated');
  if (action === 'toggle') toast(enabled ? 'Rule disabled' : 'Rule enabled');
}

function bindViewActions(root) {
  root.querySelectorAll('[data-goto]').forEach((button) => {
    button.addEventListener('click', () => setView(button.getAttribute('data-goto')));
  });

  const form = document.getElementById('rule-form');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await submitRuleForm(form);
      } catch (error) {
        toast(error.message || 'Failed to create rule');
      }
    });
  }

  root.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const rawAction = button.getAttribute('data-action');
      const ruleId = button.getAttribute('data-rule-id');
      const enabled = button.getAttribute('data-enabled') === '1';
      const action = rawAction === 'toggle' ? (enabled ? 'disable' : 'enable') : rawAction;
      button.disabled = true;
      try {
        await handleRuleAction(action, ruleId, enabled);
      } catch (error) {
        toast(error.message || 'Action failed');
      } finally {
        button.disabled = false;
      }
    });
  });

  const loadLogs = document.getElementById('load-logs');
  if (loadLogs) {
    loadLogs.addEventListener('click', async () => {
      try {
        const data = await api('/api/forwarder/logs');
        STATE.data.recentLogs = data.logs || [];
        STATE.data.recentHistory = data.history || [];
        render();
        toast('Logs reloaded');
      } catch (error) {
        toast(error.message || 'Failed to load logs');
      }
    });
  }

  const settingsLogout = document.getElementById('settings-logout');
  if (settingsLogout) {
    settingsLogout.addEventListener('click', () => {
      PV.logout();
      location.href = '/';
    });
  }
}

function initLayout() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  document.querySelectorAll('.side-link').forEach((button) => {
    button.addEventListener('click', () => setView(button.getAttribute('data-view')));
  });

  const refresh = document.getElementById('refresh-dashboard');
  if (refresh) {
    refresh.addEventListener('click', async () => {
      try {
        await refreshData(true);
      } catch (error) {
        toast(error.message || 'Refresh failed');
      }
    });
  }
}

async function boot() {
  initLayout();

  try {
    await PV.restoreSession();
  } catch (error) {
    document.getElementById('dashboard-root').innerHTML = forbiddenScreen(error.message || 'Could not restore your session.');
    return;
  }

  let session = PV.getSession();
  if (!PV.isLoggedIn()) {
    if (PV.isDemoRequested()) {
      session = PV.makeDemoSession();
      session.demo = true;
      localStorage.setItem('pv_session', JSON.stringify(session));
    } else {
      document.getElementById('dashboard-root').innerHTML = gate(
        'Log in to VMax Forwarder Dashboard',
        'Sign in with Discord to manage forwarding rules, delivery history, webhooks, and operational status.',
        'Log in with Discord',
      );
      const gateLogin = document.getElementById('gate-login');
      if (gateLogin) gateLogin.addEventListener('click', () => PV.login());
      return;
    }
  }

  STATE.session = session;
  const sidePlan = document.getElementById('side-plan');
  if (sidePlan) sidePlan.textContent = session.demo ? 'Demo workspace' : 'Dashboard manager';

  try {
    await refreshData(false);
  } catch (error) {
    if (error.status === 403) {
      document.getElementById('dashboard-root').innerHTML = forbiddenScreen(error.message || 'Your account is not allowed to manage this dashboard.');
      const logout = document.getElementById('settings-logout');
      if (logout) logout.addEventListener('click', () => {
        PV.logout();
        location.href = '/';
      });
      return;
    }
    document.getElementById('dashboard-root').innerHTML = forbiddenScreen(error.message || 'Dashboard failed to load.');
    return;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
