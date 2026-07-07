// Pointe vers le backend. En dev, le backend sert aussi ce frontend en
// statique sur le meme port, donc l'origine courante suffit; sinon on peut
// forcer via ?api=http://localhost:4000
const params = new URLSearchParams(location.search);
const API_BASE = params.get('api') || '';

const $app = document.getElementById('app');
const $breadcrumb = document.getElementById('breadcrumb');
const $status = document.getElementById('status-label');

async function api(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`);
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  return res.json();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function healthDotClass(health) {
  if (health === 'Healthy') return 'healthy';
  if (health === 'Progressing') return 'progressing';
  return 'degraded';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [section, namespace] = hash.split('/').filter(Boolean);
  if (section === 'namespace' && namespace) {
    $breadcrumb.innerHTML = `<a href="#/">namespaces</a> / ${escapeHtml(namespace)}`;
    renderNamespacePage(namespace);
  } else {
    $breadcrumb.innerHTML = '';
    renderOverview();
  }
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// Overview page
// ---------------------------------------------------------------------------

async function renderOverview() {
  $app.innerHTML = `<div class="empty">Chargement…</div>`;
  try {
    const summary = await api('/api/summary');
    $status.textContent = `${summary.length} namespaces`;
    $app.innerHTML = `
      <div class="section-label">Namespaces</div>
      <div class="ns-grid">
        ${summary.map(nsCard).join('')}
      </div>
    `;
  } catch (err) {
    $app.innerHTML = errorBlock(err);
  }
}

function guardrailBadge(namespace) {
  if (namespace === 'ai-remediation') return { cls: 'source', label: 'moteur IA' };
  if (namespace === 'dev') return { cls: 'allowed', label: 'IA autorisée' };
  return { cls: 'blocked', label: 'IA bloquée' };
}

function nsCard(ns) {
  const badge = guardrailBadge(ns.namespace);
  return `
    <a class="ns-card" href="#/namespace/${ns.namespace}">
      <div class="ns-card-top">
        <span class="ns-name">${escapeHtml(ns.namespace)}</span>
        <span class="ns-guardrail ${badge.cls}">${badge.label}</span>
      </div>
      <div class="ns-stats">
        <div class="stat">
          <span class="val">${ns.metrics?.pod_count ?? '—'}</span>
          <span class="label">pods</span>
        </div>
        <div class="stat">
          <span class="val">${ns.metrics?.restarts_total ?? '—'}</span>
          <span class="label">restarts</span>
        </div>
        <div class="stat">
          <span class="val errors">${ns.errors_total}</span>
          <span class="label">erreurs</span>
        </div>
        <div class="stat">
          <span class="val">${ns.ai_commands_total}</span>
          <span class="label">cmd IA</span>
        </div>
      </div>
      ${ns.gitops ? `
        <div class="ns-gitops">
          <span class="dot ${healthDotClass(ns.gitops.health_status)}"></span>
          ${escapeHtml(ns.gitops.app)} · ${escapeHtml(ns.gitops.sync_status)} / ${escapeHtml(ns.gitops.health_status)}
        </div>
      ` : `
        <div class="ns-gitops">non géré par Argo CD</div>
      `}
    </a>
  `;
}

// ---------------------------------------------------------------------------
// Namespace detail page
// ---------------------------------------------------------------------------

async function renderNamespacePage(namespace) {
  $app.innerHTML = `<div class="empty">Chargement de ${escapeHtml(namespace)}…</div>`;
  try {
    const [logs, aiCommands, metrics, gitops] = await Promise.all([
      api(`/api/namespaces/${namespace}/logs`),
      api(`/api/namespaces/${namespace}/ai-command-logs`),
      api(`/api/namespaces/${namespace}/metrics`),
      api(`/api/namespaces/${namespace}/gitops`),
    ]);
    $status.textContent = `${namespace} · ${logs.length} logs · ${aiCommands.length} cmd IA`;

    const isSource = namespace === 'ai-remediation';
    const isAiAllowed = namespace === 'dev';

    const aiSectionLabel = isSource
      ? 'Commandes IA émises (toutes cibles confondues)'
      : `Commandes IA (target_namespace = ${escapeHtml(namespace)})`;

    const aiBanner = isSource
      ? `<div class="guardrail-banner" style="color:var(--accent); border-color:var(--accent);">
           ℹ️ Ce namespace est la source de toutes les commandes du remédiateur —
           chaque ligne indique ci-dessous vers quel <code>target_namespace</code> elle était destinée.
         </div>`
      : (isAiAllowed ? '' : `
        <div class="guardrail-banner">
          ⛔ La remédiation IA est restreinte au namespace <strong>dev</strong>. Les commandes ciblant
          <strong>${escapeHtml(namespace)}</strong> sont bloquées avant exécution.
        </div>
      `);

    $app.innerHTML = `
      ${metrics ? `
        <div class="section-label">Métriques</div>
        <div class="metrics-row">
          ${metricTile(metrics.pod_count, 'pods')}
          ${metricTile(metrics.restarts_total, 'restarts')}
          ${metricTile(`${Math.round(metrics.cpu_usage_rate * 100)}%`, 'CPU')}
          ${metricTile(`${Math.round(metrics.memory_usage_ratio * 100)}%`, 'mémoire')}
        </div>
      ` : ''}

      ${gitops ? `
        <div class="section-label">GitOps</div>
        <div class="metrics-row">
          <div class="metric-tile">
            <div class="val" style="font-size:15px;">${escapeHtml(gitops.app)}</div>
            <div class="label">${escapeHtml(gitops.sync_status)} / ${escapeHtml(gitops.health_status)} · sync ${fmtTime(gitops.last_synced_at)}</div>
          </div>
        </div>
      ` : `
        <div class="section-label">GitOps</div>
        <div class="empty">Non géré par Argo CD (CronJob, pas une app GitOps).</div>
      `}

      <div class="section-label">${aiSectionLabel}</div>
      ${aiBanner}
      ${aiCommands.length ? `<div class="pipeline">${aiCommands.map(cmd => aiCommandRow(cmd, isSource)).join('')}</div>` : `<div class="empty">Aucune commande IA pour ce namespace.</div>`}

      <div class="section-label">Logs applicatifs</div>
      ${logs.length ? `<div class="log-list">${logs.map(logRow).join('')}</div>` : `<div class="empty">Aucun log.</div>`}
    `;
  } catch (err) {
    $app.innerHTML = errorBlock(err);
  }
}

function metricTile(val, label) {
  return `
    <div class="metric-tile">
      <div class="val">${escapeHtml(val)}</div>
      <div class="label">${escapeHtml(label)}</div>
    </div>
  `;
}

function aiCommandRow(cmd, showTarget = false) {
  const summary = cmd.status === 'success' ? cmd.stdout_summary : cmd.stderr_summary;
  return `
    <div class="cmd">
      <div class="node ${cmd.status}">${cmd.status === 'success' ? '✓' : cmd.status === 'failure' ? '✗' : '⛔'}</div>
      <div class="cmd-card">
        <div class="cmd-top">
          <span class="cmd-step">${escapeHtml(cmd.step)}</span>
          ${showTarget ? `<span class="cmd-status" style="background:rgba(56,189,248,0.12); color:var(--accent);">→ ${escapeHtml(cmd.target_namespace)}</span>` : ''}
          <span class="cmd-status ${cmd.status}">${escapeHtml(cmd.status)}</span>
          <span class="cmd-ts">${fmtTime(cmd.timestamp)}</span>
        </div>
        ${summary ? `<div class="cmd-summary ${cmd.status === 'failure' ? 'err' : ''}">${escapeHtml(summary)}</div>` : ''}
        ${cmd.duration_ms ? `<div class="cmd-summary">durée: ${cmd.duration_ms} ms</div>` : ''}
      </div>
    </div>
  `;
}

function logRow(log) {
  return `
    <div class="log-row">
      <span class="ts">${fmtTime(log.timestamp)}</span>
      <span class="level ${log.level}">${escapeHtml(log.level)}</span>
      <span class="msg">${escapeHtml(log.message)}</span>
    </div>
  `;
}

function errorBlock(err) {
  return `<div class="empty" style="color:var(--fail)">Erreur : ${escapeHtml(err.message)}<br><br>Le backend est-il lancé sur ${API_BASE || location.origin} ?</div>`;
}

route();
