/**
 * Generates example HTML briefs for each task type.
 * Run: node generate-examples.js
 * Output: examples/*.html
 */

const fs = require('node:fs');
const path = require('node:path');

// ── Helper: define multi-line content with backticks safely ──────────────────
function md(...lines) { return lines.join('\n'); }

// ── Constants (mirrored from debrief.ts) ─────────────────────────────────────

const TASK_META = {
  implementation: { label: 'Implementation', bg: '#1f3a5f', color: '#58a6ff', icon: '🔧' },
  planning:       { label: 'Planning',       bg: '#2d1f4e', color: '#bc8cff', icon: '🗺️' },
  research:       { label: 'Research',       bg: '#1a3628', color: '#3fb950', icon: '🔍' },
  review:         { label: 'Review',         bg: '#3a2d0f', color: '#d29922', icon: '🔎' },
  debug:          { label: 'Debug',          bg: '#2d1a1a', color: '#f85149', icon: '🐛' },
  requirements:   { label: 'Requirements',   bg: '#1a2d3a', color: '#39c5cf', icon: '📋' },
};

// ── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markdownToHtml(text) {
  const lines = text.split('\n');
  let html = '', inUl = false, inOl = false;
  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };
  const inline = s =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    const ul = line.match(/^[-•*]\s+(.+)/);
    const ol = line.match(/^\d+\.\s+(.+)/);
    const h  = line.match(/^#{2,3}\s+(.*)/);
    if (ul) {
      if (inOl) closeList();
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${inline(ul[1])}</li>`;
    } else if (ol) {
      if (inUl) closeList();
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += `<li>${inline(ol[1])}</li>`;
    } else if (h) {
      closeList(); html += `<h4>${inline(h[1])}</h4>`;
    } else {
      closeList(); html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function renderHtml(p) {
  const meta = TASK_META[p.taskType] || TASK_META.implementation;
  const dateStr = p.timestamp.toLocaleString('en-AU', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const metaBadges = [
    p.repoName ? `<span class="badge-meta">📁 ${escapeHtml(p.repoName)}</span>` : '',
    `<span class="badge-meta">🏷 ${escapeHtml(p.slug)}</span>`,
    `<span class="badge-meta">📅 ${dateStr}</span>`,
    `<span class="badge-meta">${escapeHtml(path.basename(p.filepath))}</span>`,
  ].filter(Boolean).join('\n      ');
  const sectionsHtml = p.sections.map(s =>
    `    <section class="brief-section">\n      <h2 class="section-heading">${escapeHtml(s.heading)}</h2>\n      <div class="section-body">${markdownToHtml(s.content)}</div>\n    </section>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(p.title)} — pi debrief</title>
<style>
  :root {
    --bg:#0d1117;--surface:#161b22;--surface2:#21262d;--border:#30363d;
    --text:#e6edf3;--muted:#8b949e;--accent:${meta.color};--accent-bg:${meta.bg};--radius:10px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.7;padding:2rem 1rem}
  .page{max-width:860px;margin:0 auto;display:grid;gap:1.25rem}
  .brief-header{background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:var(--radius);padding:1.75rem}
  .header-top{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.9rem}
  .badge-type{display:inline-flex;align-items:center;gap:.35rem;padding:.25rem .75rem;border-radius:20px;font-size:.72rem;font-weight:700;letter-spacing:.04em;background:var(--accent-bg);color:var(--accent)}
  .badge-version{padding:.25rem .65rem;border-radius:20px;font-size:.72rem;font-weight:700;background:var(--surface2);color:var(--muted);border:1px solid var(--border)}
  h1.brief-title{font-size:1.45rem;color:var(--text);font-weight:700;line-height:1.3}
  .header-meta{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.65rem}
  .badge-meta{font-size:.74rem;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:.2rem .55rem}
  .brief-summary{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);padding:1.25rem 1.5rem}
  .summary-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);font-weight:700;margin-bottom:.55rem}
  .brief-summary p{font-size:.97rem;color:var(--text);line-height:1.8;margin-bottom:.5rem}
  .brief-summary p:last-child{margin-bottom:0}
  .brief-section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem 1.5rem}
  .section-heading{font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:.85rem;padding-bottom:.45rem;border-bottom:1px solid var(--border)}
  .section-body p{color:var(--muted);font-size:.92rem;margin-bottom:.55rem;line-height:1.7}
  .section-body p:last-child{margin-bottom:0}
  .section-body ul,.section-body ol{padding-left:1.4rem;color:var(--muted);font-size:.92rem;display:grid;gap:.3rem;margin:.35rem 0}
  .section-body li{line-height:1.65}
  .section-body h4{font-size:.88rem;color:var(--text);margin:.8rem 0 .35rem;font-weight:600}
  .section-body strong{color:var(--text)}.section-body em{color:var(--text);font-style:italic}
  .section-body code{background:var(--surface2);padding:.1rem .35rem;border-radius:4px;font-family:"Cascadia Code","Fira Code",monospace;font-size:.82rem;color:#79c0ff}
  footer{text-align:center;color:var(--muted);font-size:.73rem;padding-top:.35rem}
</style>
</head>
<body>
<div class="page">
  <div class="brief-header">
    <div class="header-top">
      <span class="badge-type">${meta.icon} ${meta.label}</span>
      <span class="badge-version">${escapeHtml(p.versionLabel)}</span>
    </div>
    <h1 class="brief-title">${escapeHtml(p.title)}</h1>
    <div class="header-meta">
      ${metaBadges}
    </div>
  </div>
  <div class="brief-summary">
    <div class="summary-label">Summary</div>
    ${markdownToHtml(p.summary)}
  </div>
${sectionsHtml}
  <footer>pi-debrief · ${escapeHtml(p.filepath)}</footer>
</div>
</body>
</html>`;
}

// ── Example data ─────────────────────────────────────────────────────────────

const EXAMPLES = [
  // ── Implementation ──────────────────────────────────────────────────────────
  {
    slug: 'rate-limiting-api-gateway',
    taskType: 'implementation',
    title: 'Add Token-Bucket Rate Limiting to API Gateway',
    summary: 'Implemented per-client token-bucket rate limiting on the Express API gateway using `redis` for distributed state. Clients exceeding 100 req/min now receive a `429` response with a `Retry-After` header. Authenticated and unauthenticated tiers are handled separately with configurable limits per environment variable.',
    sections: [
      {
        heading: 'What was done',
        content: md(
          '- Added `redis`-backed token bucket in `src/middleware/rateLimiter.ts`',
          '- Registered middleware in `src/app.ts` before all route handlers',
          '- Authenticated clients identified by JWT `sub` claim; unauthenticated by IP',
          '- Limits configurable via `RATE_LIMIT_AUTH` (default 100/min) and `RATE_LIMIT_ANON` (default 20/min)',
          '- Returns `X-RateLimit-Remaining` and `Retry-After` headers on all requests',
          '- Added Redis connection health check to existing `/health` endpoint',
        ),
      },
      {
        heading: 'Files changed',
        content: md(
          '- `src/middleware/rateLimiter.ts` — new, token bucket implementation',
          '- `src/app.ts` — middleware registration',
          '- `src/config.ts` — new env vars `RATE_LIMIT_AUTH` and `RATE_LIMIT_ANON`',
          '- `src/routes/health.ts` — Redis health check',
          '- `tests/middleware/rateLimiter.test.ts` — new, 12 test cases',
          '- `docker-compose.yml` — Redis service added for local dev',
        ),
      },
      {
        heading: 'How to test',
        content: md(
          '1. Start Redis: `docker compose up redis -d`',
          '2. Run unit tests: `npm test -- rateLimiter`',
          '3. Manual: send 25+ unauthenticated requests quickly, confirm `429` after the 20th',
          '4. Verify `X-RateLimit-Remaining` decrements on each response',
        ),
      },
      {
        heading: "What's next",
        content: md(
          '- Sliding window may give better UX than token bucket for bursty traffic — worth evaluating under load',
          '- Rate limit config is currently global; per-endpoint limits are a requested follow-up',
          '- Expose current usage via `/health` for ops dashboards',
          '- Load test at 2× expected peak before the next release',
        ),
      },
    ],
    timestamp: new Date('2026-04-12T14:32:00'),
    versionLabel: 'v1',
    repoName: 'api-gateway',
    filepath: '/repo/.pi/reports/2026-04-12-1432-rate-limiting-api-gateway.html',
  },

  // ── Planning ─────────────────────────────────────────────────────────────────
  {
    slug: 'event-driven-migration',
    taskType: 'planning',
    title: 'Migrate Order Service to Event-Driven Architecture',
    summary: 'Evaluated options for decoupling the order service from three downstream consumers currently called synchronously over HTTP. Proposed an event-driven approach using a managed message broker with an 8-week phased migration that maintains backward compatibility throughout.',
    sections: [
      {
        heading: 'Context & Problem',
        content: md(
          'The order service makes synchronous HTTP calls to inventory, billing, and notifications on every order placement. This creates three problems:',
          '- **Latency**: order placement p99 is 2.3 s, driven almost entirely by the billing call',
          '- **Coupling**: a billing outage causes order failures even for COD orders that do not need billing',
          '- **Scaling**: all three consumers must scale in lockstep with the order service',
          '',
          'The team has agreed to decouple but has not aligned on the mechanism.',
        ),
      },
      {
        heading: 'Proposed approach',
        content: md(
          'Introduce a managed message broker (AWS EventBridge or Azure Service Bus — see Alternatives). Order service publishes an `order.placed` event on successful persistence. Each consumer subscribes independently.',
          '',
          '**Phase 1 (weeks 1–3)**: publish events alongside existing sync calls (dual-write). No consumer changes.',
          '**Phase 2 (weeks 4–6)**: migrate consumers to event subscription one by one. Remove sync calls as each is confirmed stable.',
          '**Phase 3 (weeks 7–8)**: remove dual-write, clean up, load test.',
        ),
      },
      {
        heading: 'Alternatives considered',
        content: md(
          '- **Outbox pattern + Kafka**: more operationally complex, better for high throughput (>50k/s). Overkill at current volume.',
          '- **GraphQL subscriptions**: solves notifications but not billing or inventory. Partial solution.',
          '- **Circuit breaker on existing sync calls**: addresses resilience but not latency or coupling root cause.',
          '- **gRPC async streaming**: requires significant client refactoring; limited managed hosting options.',
        ),
      },
      {
        heading: 'Pros & Cons',
        content: md(
          '**Pros**',
          '- Consumers become independently deployable and scalable',
          '- Order placement latency drops to under 100 ms (no blocking calls)',
          '- Phased migration is low-risk — rollback available at each phase boundary',
          '',
          '**Cons**',
          '- Eventual consistency: inventory and billing updates lag by seconds',
          '- New operational surface: broker monitoring, dead-letter queues, replay tooling',
          '- Developer mental model shift — debugging async flows is harder',
        ),
      },
      {
        heading: 'Recommendations',
        content: md(
          '1. Proceed with the phased approach — the dual-write phase de-risks the migration significantly',
          '2. Choose **Azure Service Bus** if the team is already on Azure; EventBridge if on AWS',
          '3. Define and enforce an event schema standard (CloudEvents spec) before Phase 1 — retrofitting schema governance is painful',
          '4. Instrument dead-letter queues with alerts from day one',
        ),
      },
      {
        heading: 'Open questions',
        content: md(
          '- What is the acceptable lag for inventory updates? Billing team needs to confirm the eventual consistency window.',
          '- Who owns the broker infrastructure? Platform team is not yet engaged.',
          '- Do we need event replay for audit purposes? If yes, retention policy must be agreed before broker selection.',
        ),
      },
    ],
    timestamp: new Date('2026-04-10T09:15:00'),
    versionLabel: 'v1',
    repoName: 'order-service',
    filepath: '/repo/.pi/reports/2026-04-10-0915-event-driven-migration.html',
  },

  // ── Research ─────────────────────────────────────────────────────────────────
  {
    slug: 'realtime-sync-options',
    taskType: 'research',
    title: 'Evaluate Real-Time Sync Strategies for Collaborative Editing',
    summary: 'Researched three approaches for real-time collaborative editing: Operational Transformation (OT), CRDTs, and last-write-wins (LWW). OT is battle-tested but complex to implement for tree-structured data. CRDTs (specifically Yjs) are the right long-term direction. LWW is viable short-term given current usage patterns.',
    sections: [
      {
        heading: 'Key findings',
        content: md(
          '- **Operational Transformation**: used by Google Docs and Notion. Requires a central server to order operations. Hard to implement correctly for tree-structured data (our document model is a tree).',
          '- **CRDTs (Yjs, Automerge)**: peer-to-peer safe, no central ordering required. Yjs has strong ecosystem support and handles rich text and tree structures. Memory overhead ~2–4× document size.',
          '- **Last-write-wins (server-authoritative)**: simplest implementation. Acceptable only if conflict rate is very low. At under 5 concurrent editors per document (our current max), conflict probability is statistically low.',
          '- WebSockets are the right transport layer regardless of conflict strategy.',
        ),
      },
      {
        heading: 'Details',
        content: md(
          '## Yjs (CRDT)',
          'Yjs is the most mature CRDT library for JavaScript. Supports rich text via Quill/ProseMirror bindings, nested maps, and arrays. Awareness protocol handles cursor sharing. **Concern**: awareness data structure leaks memory if clients disconnect without cleanup — requires heartbeat/TTL management.',
          '',
          '## Automerge 2.0',
          'Rewritten in Rust/WASM; significantly faster than v1. Stronger academic backing but less production ecosystem than Yjs. Worth watching but not production-ready for our timeline.',
          '',
          '## ShareDB (OT)',
          'The main open-source OT library (MongoDB-backed). The shared document model maps reasonably to our structure, but transformation functions for custom node types would need to be written from scratch. 3–5 weeks of implementation effort estimated.',
        ),
      },
      {
        heading: 'Recommendations',
        content: md(
          '- **Short term** (next quarter): implement last-write-wins with a conflict notification UX. Acceptable for current scale. 1–2 weeks of work.',
          '- **Medium term**: evaluate Yjs for a pilot feature. If the integration is clean, migrate incrementally.',
          '- **Do not** pursue OT from scratch — implementation risk is too high given team capacity.',
          '- Instrument actual conflict rate in production before committing to a CRDT migration.',
        ),
      },
    ],
    timestamp: new Date('2026-04-08T16:45:00'),
    versionLabel: 'v1',
    repoName: 'collab-editor',
    filepath: '/repo/.pi/reports/2026-04-08-1645-realtime-sync-options.html',
  },

  // ── Review ───────────────────────────────────────────────────────────────────
  {
    slug: 'payment-service-review',
    taskType: 'review',
    title: 'Code Review: Payment Service Refactor (PR #247)',
    summary: 'Reviewed the payment service refactor introducing a Strategy pattern for payment providers. The abstraction is sound and test coverage is strong at 94%. Three issues need addressing before merge: a missing idempotency key on retries, insufficient error classification, and a Stripe-specific assumption leaking into the abstract interface.',
    sections: [
      {
        heading: 'Issues found',
        content: md(
          '**Critical**',
          '- `PaymentProcessor.retry()` does not pass the original idempotency key. A network timeout followed by retry will create a duplicate charge. Stripe and Braintree both support idempotency keys — this must be threaded through.',
          '',
          '**Significant**',
          '- `PaymentError` is a single class with a `code` string. Downstream callers need to distinguish retriable errors (network timeout, rate limit) from terminal ones (card declined) without string matching. Add a `retriable: boolean` field or use subclasses.',
          '- `PaymentProvider` interface has a `getWebhookSecret()` method — this is Stripe-specific. Braintree uses a different verification mechanism.',
          '',
          '**Minor**',
          '- `src/providers/stripe.ts` line 142: `amount * 100` converts to cents but is undocumented and breaks for currencies without cent subdivision (JPY, KWD).',
        ),
      },
      {
        heading: "What's good",
        content: md(
          '- Strategy pattern is well-suited here and the abstraction boundary is clean',
          '- Test coverage is 94% on the new provider code — notably better than what it replaced',
          '- Error messages are human-readable and include correlation IDs',
          '- Provider factory with environment-based selection is the right approach',
          '- Dependency injection throughout makes testing straightforward',
        ),
      },
      {
        heading: 'Recommendations',
        content: md(
          '1. Fix the idempotency key issue before merge — this is a correctness bug in production',
          '2. Decide on error classification strategy (boolean flag vs subclasses) and apply consistently',
          '3. Move `getWebhookSecret()` out of the abstract interface — put it in a `StripeProvider`-specific interface',
          '4. Add a currency helper before the Braintree integration lands',
        ),
      },
      {
        heading: 'Priority fixes',
        content: md(
          '1. **[Blocker]** Idempotency key on retry — fix in `src/payment/processor.ts`',
          '2. **[Should fix]** Error classification — add `retriable` flag to `PaymentError`',
          '3. **[Should fix]** Remove `getWebhookSecret()` from `PaymentProvider` interface',
          '4. **[Nice to have]** Currency conversion helper with a comment',
        ),
      },
    ],
    timestamp: new Date('2026-04-11T11:00:00'),
    versionLabel: 'v1',
    repoName: 'payments',
    filepath: '/repo/.pi/reports/2026-04-11-1100-payment-service-review.html',
  },

  // ── Debug ────────────────────────────────────────────────────────────────────
  {
    slug: 'worker-pool-memory-leak',
    taskType: 'debug',
    title: 'Fix Memory Leak Causing OOM Crashes in Worker Pool',
    summary: 'Identified and fixed a memory leak in the async worker pool that caused RSS to grow ~40 MB/hour under normal load, leading to OOM kills after ~6 hours. Root cause was unclosed `EventEmitter` listeners accumulating on a shared `jobQueue` instance per worker restart. Fix reduces memory growth to baseline.',
    sections: [
      {
        heading: 'Root cause',
        content: md(
          'Each time a worker process crashed and restarted, `WorkerPool._bindWorkerEvents(worker)` attached new `message`, `error`, and `exit` listeners to the shared `this.jobQueue` EventEmitter without removing the old ones.',
          '',
          'After ~200 restarts (common under sustained load), the queue had 600+ active listeners all holding closures over stale worker instances. Node.js emitted `MaxListenersExceeded` warnings but these were suppressed by an overly broad `winston` filter.',
        ),
      },
      {
        heading: 'What was tried',
        content: md(
          '- Added heap snapshots at 1-hour intervals — confirmed growth in `EventEmitter` listener arrays',
          '- Bisected git history — leak introduced in commit `a3f92c1` ("refactor worker lifecycle") 3 weeks ago',
          '- Checked for promise leaks via `--track-heap-objects` — not the cause',
          '- Reviewed Redis connection pooling — correctly bounded, not the source',
        ),
      },
      {
        heading: 'Fix applied',
        content: md(
          'In `src/workers/pool.ts`, `_bindWorkerEvents()` now calls `_unbindWorkerEvents(worker)` before attaching new listeners. Added a `_listenerMap: Map<Worker, Function[]>` to track attached listeners per worker for clean removal.',
          '',
          'Also fixed the `winston` filter to pass through Node.js process warnings — these should have surfaced weeks ago.',
          '',
          '**Changed files:**',
          '- `src/workers/pool.ts` — unbind before rebind, listener tracking map',
          '- `src/logging/filters.ts` — remove overly broad warning suppression',
        ),
      },
      {
        heading: 'How to verify',
        content: md(
          '1. Run `npm run stress-test` (500 req/min for 2 hours, deliberate worker crashes every 5 min)',
          '2. Monitor RSS via `process.memoryUsage()` endpoint',
          '3. Pass: RSS stabilises below 180 MB, grows less than 5 MB/hour',
          '4. Previous behaviour: ~40 MB/hour growth, OOM at ~6 hours',
        ),
      },
      {
        heading: 'Recurrence risk',
        content: md(
          '**Medium** — the pattern (attaching listeners inside a restart handler without cleanup) is easy to reintroduce.',
          '',
          '- Added `setMaxListeners(10)` guard on `jobQueue` — will throw before listener count becomes problematic',
          '- Added a comment block above `_bindWorkerEvents` explaining the invariant',
          '- Consider a test that asserts listener count stays bounded during a restart cycle',
        ),
      },
    ],
    timestamp: new Date('2026-04-13T08:20:00'),
    versionLabel: 'v1',
    repoName: 'data-pipeline',
    filepath: '/repo/.pi/reports/2026-04-13-0820-worker-pool-memory-leak.html',
  },

  // ── Requirements ─────────────────────────────────────────────────────────────
  {
    slug: 'notifications-feature',
    taskType: 'requirements',
    title: 'User Notifications Feature — Requirements Scoping',
    summary: 'Scoped the user notifications feature for Q2. Functional requirements cover in-app, email, and push channels with per-user preference controls. The main non-functional risk is the in-app delivery latency SLA under peak load — the current WebSocket infrastructure will not scale to target volume and needs an architecture decision before sprint 1.',
    sections: [
      {
        heading: 'Functional requirements',
        content: md(
          '- Users receive notifications via three channels: **in-app** (bell icon), **email**, and **push** (mobile)',
          '- Users can enable/disable each channel independently per notification type',
          '- Notification types for v1: mention, comment reply, task assigned, task completed, system alert',
          '- In-app: real-time via WebSocket; unread badge count; mark-as-read individually or all-at-once',
          '- Email: digest mode (immediate, hourly, daily) configurable per type; HTML template with CAN-SPAM unsubscribe link',
          '- Push: requires FCM/APNs token registration flow in mobile clients; deep-link support',
          '- Admins can send system-wide announcements to all users or user segments',
        ),
      },
      {
        heading: 'Non-functional requirements',
        content: md(
          '- In-app delivery: **<2 s** p99 from event to client display',
          '- Email delivery: **<5 min** p99 for immediate mode; digest within 5 min of scheduled window',
          '- Push delivery: best-effort, no SLA (subject to FCM/APNs)',
          '- Preferences API: <200 ms p95',
          '- System must handle 10× current notification volume without degradation',
          '- Notification history retained for 90 days per data retention policy',
        ),
      },
      {
        heading: 'Assumptions',
        content: md(
          '- Mobile clients (iOS + Android) will implement the push token registration flow — out of scope for backend team',
          '- Current email service provider (SendGrid) has capacity for projected volume',
          '- In-app notifications are fire-and-forget for WebSocket — offline users do not receive missed notifications on reconnect',
          '- A single preference store is sufficient — no team-level overrides of individual preferences',
        ),
      },
      {
        heading: 'Out of scope',
        content: md(
          '- SMS notifications (requested but deferred to v2)',
          '- Notification analytics dashboard (open rates, click-through) — analytics team to own',
          '- A/B testing notification copy',
          '- Notification scheduling (send at specific time) — deferred',
          '- Read receipts for push notifications',
        ),
      },
      {
        heading: 'Risks',
        content: md(
          '- **Delivery latency under peak load**: the <2 s in-app SLA requires a dedicated WebSocket service or broker with guaranteed ordering. Current infrastructure reuses the API server for WebSocket and will not scale to 10×. Architecture decision needed before sprint 1.',
          '- **Email volume and cost**: immediate-mode email for all notification types could generate significant SendGrid cost. Volume modelling needed before broad rollout.',
          '- **Preference schema evolution**: adding notification types post-launch requires a migration strategy. Schema must account for this from the start.',
        ),
      },
    ],
    timestamp: new Date('2026-04-09T13:30:00'),
    versionLabel: 'v1',
    repoName: 'platform',
    filepath: '/repo/.pi/reports/2026-04-09-1330-notifications-feature.html',
  },
];

// ── Generate ──────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'examples');
fs.mkdirSync(outDir, { recursive: true });

for (const ex of EXAMPLES) {
  const html = renderHtml(ex);
  const filename = `example-${ex.taskType}.html`;
  fs.writeFileSync(path.join(outDir, filename), html, 'utf-8');
  console.log('  ✓', filename);
}
console.log(`\nGenerated ${EXAMPLES.length} examples → ${outDir}`);
