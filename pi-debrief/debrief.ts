/**
 * pi-debrief — HTML briefing documents for pi tasks
 *
 * Call write_debrief to save a styled HTML brief to:
 *   - <git-root>/.pi/debriefs/  (when inside a git repo)
 *   - ~/.pi/debriefs/           (otherwise)
 *
 * Files are named YYYY-MM-DD-HHmm-<slug>.html. Multiple files sharing a
 * slug are displayed as versions when browsing with /debriefs.
 *
 * Commands:
 *   /debriefs        List and open briefs
 *   /debrief         Ask the model to write a brief right now
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_TYPES = [
	"implementation",
	"planning",
	"research",
	"review",
	"debug",
	"requirements",
] as const;

type TaskType = (typeof TASK_TYPES)[number];

const TASK_META: Record<TaskType, { label: string; bg: string; color: string; icon: string }> = {
	implementation: { label: "Implementation", bg: "#1f3a5f", color: "#58a6ff", icon: "🔧" },
	planning:       { label: "Planning",       bg: "#2d1f4e", color: "#bc8cff", icon: "🗺️" },
	research:       { label: "Research",       bg: "#1a3628", color: "#3fb950", icon: "🔍" },
	review:         { label: "Review",         bg: "#3a2d0f", color: "#d29922", icon: "🔎" },
	debug:          { label: "Debug",          bg: "#2d1a1a", color: "#f85149", icon: "🐛" },
	requirements:   { label: "Requirements",   bg: "#1a2d3a", color: "#39c5cf", icon: "📋" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportFile {
	filepath: string;
	slug: string;
	timestamp: Date;
	location: "project" | "global";
}

interface RenderParams {
	slug: string;
	taskType: TaskType;
	title: string;
	summary: string;
	sections: Array<{ heading: string; content: string }>;
	timestamp: Date;
	versionLabel: string;
	repoName: string | null;
	filepath: string;
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let debriefDir: string | null = null;

	// ── Helpers ──────────────────────────────────────────────────────────────

	async function resolveDebriefDir(cwd: string): Promise<string> {
		if (debriefDir) return debriefDir;

		const gitResult = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
		const dir = gitResult.code === 0
			? join(gitResult.stdout.trim(), ".pi", "debriefs")
			: join(homedir(), ".pi", "debriefs");

		await mkdir(dir, { recursive: true });
		debriefDir = dir;
		return dir;
	}

	async function listDebriefs(cwd: string): Promise<ReportFile[]> {
		const results: ReportFile[] = [];

		const globalDir = join(homedir(), ".pi", "debriefs");
		const gitResult = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
		const projectDir =
			gitResult.code === 0 ? join(gitResult.stdout.trim(), ".pi", "debriefs") : null;

		const sources: Array<{ dir: string; location: "project" | "global" }> = [];
		if (projectDir && existsSync(projectDir)) {
			sources.push({ dir: projectDir, location: "project" });
		}
		if (existsSync(globalDir) && globalDir !== projectDir) {
			sources.push({ dir: globalDir, location: "global" });
		}

		for (const { dir, location } of sources) {
			try {
				const entries = await readdir(dir);
				for (const entry of entries) {
					if (!entry.endsWith(".html")) continue;
					const match = entry.match(/^(\d{4}-\d{2}-\d{2}-\d{4})-(.+)\.html$/);
					if (!match) continue;
					const [, tsStr, slug] = match;
					results.push({
						filepath: join(dir, entry),
						slug,
						timestamp: parseTimestamp(tsStr),
						location,
					});
				}
			} catch {
				// Directory may not exist yet
			}
		}

		return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
	}

	async function openInBrowser(filepath: string): Promise<void> {
		try {
			if (process.platform === "win32") {
				await pi.exec("cmd", ["/c", "start", "", filepath.replace(/\//g, "\\")]);
			} else if (process.platform === "darwin") {
				await pi.exec("open", [filepath]);
			} else {
				await pi.exec("xdg-open", [filepath]);
			}
		} catch {
			// Non-fatal
		}
	}

	async function listBriefsHandler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
		const briefs = await listDebriefs(ctx.cwd);

		if (briefs.length === 0) {
			ctx.ui.notify("No briefs found yet. Use /debrief to write one.", "info");
			return;
		}

		// Group by location+slug, preserving newest-first order within each group
		const groups = new Map<string, ReportFile[]>();
		for (const r of briefs) {
			const key = `${r.location}::${r.slug}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(r);
		}

		// Sort groups by the most-recent file in each group
		const sortedGroups = [...groups.entries()].sort(
			(a, b) => b[1][0].timestamp.getTime() - a[1][0].timestamp.getTime(),
		);

		// Build display strings — one line per slug group
		const slugOptions = sortedGroups.map(([key, files]) => {
			const loc = key.startsWith("project") ? "project" : "global ";
			const slug = files[0].slug;
			const n = files.length;
			const dateStr = formatRelativeDate(files[0].timestamp);
			const versionNote = n > 1 ? `(${n} versions)` : "            ";
			return `[${loc}]  ${slug.padEnd(40)} ${versionNote}  ${dateStr}`;
		});

		const chosen = await ctx.ui.select("Open a brief:", slugOptions);
		if (!chosen) return;

		const idx = slugOptions.indexOf(chosen);
		const [, files] = sortedGroups[idx];

		// Single version → open directly
		if (files.length === 1) {
			await openInBrowser(files[0].filepath);
			return;
		}

		// Multiple versions → let user pick
		const versionOptions = files.map((f, i) => {
			const dateStr = f.timestamp.toLocaleString("en-AU", {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
			return `v${files.length - i}  ·  ${dateStr}${i === 0 ? "  ← latest" : ""}`;
		});

		const chosenVersion = await ctx.ui.select(
			`${files[0].slug} — pick a version:`,
			versionOptions,
		);
		if (!chosenVersion) return;

		const vIdx = versionOptions.indexOf(chosenVersion);
		await openInBrowser(files[vIdx].filepath);
	}

	// ── Tool ──────────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "write_debrief",
		label: "Write Brief",
		description: `Writes a styled, self-contained HTML briefing document summarising completed work. Saves to the project or global debriefs directory and opens in the browser.

slug: kebab-case topic identifier (e.g. "rate-limiting", "auth-refactor"). Reuse the same slug for follow-up work on the same topic in this session — this groups the files as versions.

taskType → recommended sections:
  implementation → What was done · Files changed · How to test · What's next
  planning       → Context & Problem · Proposed approach · Alternatives · Pros & Cons · Recommendations · Open questions
  research       → Key findings · Details · Recommendations
  review         → Issues found · What's good · Recommendations · Priority fixes
  debug          → Root cause · What was tried · Fix applied · How to verify · Recurrence risk
  requirements   → Functional requirements · Non-functional requirements · Assumptions · Out of scope · Risks`,

		parameters: Type.Object({
			slug: Type.String({
				description: "kebab-case topic identifier, e.g. rate-limiting or auth-refactor",
			}),
			taskType: StringEnum(TASK_TYPES),
			title: Type.String({ description: "Short action-oriented title (max 80 chars)" }),
			summary: Type.String({ description: "2–4 sentence summary of what was done and the outcome" }),
			sections: Type.Array(
				Type.Object({
					heading: Type.String({ description: "Section heading" }),
					content: Type.String({
						description: "Section body — plain prose or markdown-style (bullets, bold, code spans)",
					}),
				}),
				{ description: "Ordered sections chosen based on taskType — see tool description for the recommended set" },
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const dir = await resolveDebriefDir(ctx.cwd);

			const now = new Date();
			const ts = formatTimestamp(now);
			const filename = `${ts}-${params.slug}.html`;
			const filepath = join(dir, filename);

			// Count existing files for this slug to set the version label
			let existingCount = 0;
			try {
				const files = await readdir(dir);
				existingCount = files.filter(
					(f) => f.endsWith(".html") && f.includes(`-${params.slug}.html`),
				).length;
			} catch {
				// Fine — defaults to 0
			}
			const versionLabel = `v${existingCount + 1}`;

			// Resolve repo name for the brief header
			let repoName: string | null = null;
			const gitResult = await pi.exec("git", ["-C", ctx.cwd, "rev-parse", "--show-toplevel"]);
			if (gitResult.code === 0) {
				repoName = basename(gitResult.stdout.trim());
			}

			const html = renderHtml({
				...params,
				taskType: params.taskType as TaskType,
				timestamp: now,
				versionLabel,
				repoName,
				filepath,
			});

			await writeFile(filepath, html, "utf-8");
			await openInBrowser(filepath);

			return {
				content: [{ type: "text", text: `Brief written (${versionLabel}): ${filepath}` }],
				details: { filepath, slug: params.slug, version: versionLabel },
			};
		},
	});

	// ── Commands ──────────────────────────────────────────────────────────────

	pi.registerCommand("debriefs", {
		description: "List and open briefing documents",
		handler: async (args, ctx) => {
			await listBriefsHandler(args, ctx);
		},
	});

	pi.registerCommand("debrief", {
		description: "Ask the model to write a brief for the current session right now",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			pi.sendUserMessage(
				"Please write a briefing document now using the write_debrief tool, summarising all significant work done in this session.",
			);
		},
	});
}

// ─── Utility functions ────────────────────────────────────────────────────────

function formatTimestamp(d: Date): string {
	const Y = d.getFullYear();
	const M = String(d.getMonth() + 1).padStart(2, "0");
	const D = String(d.getDate()).padStart(2, "0");
	const H = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	return `${Y}-${M}-${D}-${H}${m}`;
}

function parseTimestamp(s: string): Date {
	// Format: YYYY-MM-DD-HHmm  e.g. 2026-04-12-1430
	const parts = s.split("-");
	if (parts.length !== 4) return new Date(0);
	const [year, month, day, time] = parts;
	return new Date(+year, +month - 1, +day, +time.slice(0, 2), +time.slice(2, 4));
}

function formatRelativeDate(d: Date): string {
	const now = new Date();
	const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
	const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	if (diffDays === 0) return `today ${hhmm}`;
	if (diffDays === 1) return `yesterday ${hhmm}`;
	if (diffDays < 7) return `${diffDays} days ago`;
	return d.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Convert markdown-ish content from the LLM into safe HTML. */
function markdownToHtml(text: string): string {
	const lines = text.split("\n");
	let html = "";
	let inUl = false;
	let inOl = false;

	const closeList = () => {
		if (inUl) {
			html += "</ul>";
			inUl = false;
		}
		if (inOl) {
			html += "</ol>";
			inOl = false;
		}
	};

	const inline = (s: string) =>
		escapeHtml(s)
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/`(.+?)`/g, "<code>$1</code>")
			.replace(/\*(.+?)\*/g, "<em>$1</em>");

	for (const raw of lines) {
		const line = raw.trimEnd();
		if (line.trim() === "") {
			closeList();
			continue;
		}
		const ulMatch = line.match(/^[-•*]\s+(.+)/);
		const olMatch = line.match(/^\d+\.\s+(.+)/);
		const h3Match = line.match(/^#{2,3}\s+(.*)/);

		if (ulMatch) {
			if (inOl) closeList();
			if (!inUl) {
				html += "<ul>";
				inUl = true;
			}
			html += `<li>${inline(ulMatch[1])}</li>`;
		} else if (olMatch) {
			if (inUl) closeList();
			if (!inOl) {
				html += "<ol>";
				inOl = true;
			}
			html += `<li>${inline(olMatch[1])}</li>`;
		} else if (h3Match) {
			closeList();
			html += `<h4>${inline(h3Match[1])}</h4>`;
		} else {
			closeList();
			html += `<p>${inline(line)}</p>`;
		}
	}
	closeList();
	return html;
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(p: RenderParams): string {
	const meta = TASK_META[p.taskType] ?? TASK_META.implementation;

	const dateStr = p.timestamp.toLocaleString("en-AU", {
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

	const metaBadges = [
		p.repoName ? `<span class="badge-meta">📁 ${escapeHtml(p.repoName)}</span>` : "",
		`<span class="badge-meta">🏷 ${escapeHtml(p.slug)}</span>`,
		`<span class="badge-meta">📅 ${dateStr}</span>`,
		`<span class="badge-meta">${escapeHtml(basename(p.filepath))}</span>`,
	]
		.filter(Boolean)
		.join("\n      ");

	const sectionsHtml = p.sections
		.map(
			(s) => `    <section class="brief-section">
      <h2 class="section-heading">${escapeHtml(s.heading)}</h2>
      <div class="section-body">${markdownToHtml(s.content)}</div>
    </section>`,
		)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(p.title)} — pi debrief</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --surface2: #21262d;
    --border: #30363d; --text: #e6edf3; --muted: #8b949e;
    --accent: ${meta.color}; --accent-bg: ${meta.bg}; --radius: 10px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.7; padding: 2rem 1rem;
  }
  .page { max-width: 860px; margin: 0 auto; display: grid; gap: 1.25rem; }

  .brief-header {
    background: var(--surface); border: 1px solid var(--border);
    border-top: 3px solid var(--accent); border-radius: var(--radius);
    padding: 1.75rem;
  }
  .header-top { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin-bottom: .9rem; }
  .badge-type {
    display: inline-flex; align-items: center; gap: .35rem;
    padding: .25rem .75rem; border-radius: 20px;
    font-size: .72rem; font-weight: 700; letter-spacing: .04em;
    background: var(--accent-bg); color: var(--accent);
  }
  .badge-version {
    padding: .25rem .65rem; border-radius: 20px; font-size: .72rem; font-weight: 700;
    background: var(--surface2); color: var(--muted); border: 1px solid var(--border);
  }
  h1.brief-title { font-size: 1.45rem; color: var(--text); font-weight: 700; line-height: 1.3; }
  .header-meta { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: .65rem; }
  .badge-meta {
    font-size: .74rem; color: var(--muted); background: var(--surface2);
    border: 1px solid var(--border); border-radius: 6px; padding: .2rem .55rem;
  }

  .brief-summary {
    background: var(--surface); border: 1px solid var(--border);
    border-left: 3px solid var(--accent); border-radius: var(--radius);
    padding: 1.25rem 1.5rem;
  }
  .summary-label {
    font-size: .68rem; text-transform: uppercase; letter-spacing: .1em;
    color: var(--accent); font-weight: 700; margin-bottom: .55rem;
  }
  .brief-summary p { font-size: .97rem; color: var(--text); line-height: 1.8; margin-bottom: .5rem; }
  .brief-summary p:last-child { margin-bottom: 0; }

  .brief-section {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 1.25rem 1.5rem;
  }
  .section-heading {
    font-size: .72rem; text-transform: uppercase; letter-spacing: .09em;
    color: var(--muted); margin-bottom: .85rem;
    padding-bottom: .45rem; border-bottom: 1px solid var(--border);
  }
  .section-body p { color: var(--muted); font-size: .92rem; margin-bottom: .55rem; line-height: 1.7; }
  .section-body p:last-child { margin-bottom: 0; }
  .section-body ul, .section-body ol {
    padding-left: 1.4rem; color: var(--muted); font-size: .92rem;
    display: grid; gap: .3rem; margin: .35rem 0;
  }
  .section-body li { line-height: 1.65; }
  .section-body h4 { font-size: .88rem; color: var(--text); margin: .8rem 0 .35rem; font-weight: 600; }
  .section-body strong { color: var(--text); }
  .section-body em { color: var(--text); font-style: italic; }
  .section-body code {
    background: var(--surface2); padding: .1rem .35rem; border-radius: 4px;
    font-family: "Cascadia Code", "Fira Code", monospace; font-size: .82rem; color: #79c0ff;
  }

  footer { text-align: center; color: var(--muted); font-size: .73rem; padding-top: .35rem; }
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
