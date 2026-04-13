/**
 * Hashtag Snippets Extension
 *
 * Enables #tag style substitution/expansion in prompts. Type #tagname anywhere
 * in a prompt — it's replaced with the configured expansion text at submit time.
 *
 * LIVE AUTOCOMPLETE: Type #word in the editor and see matching snippets listed
 * above the input (just like the / command picker). Press Tab to complete the
 * tag name to the first match.
 *
 * CONFIG FILES (loaded in order — project overrides global for same keys):
 *   ~/.pi/agent/hashtag-snippets.yaml      (global / profile-level)
 *   .pi/hashtag-snippets.yaml              (repo / project-level)
 *
 * YAML FORMAT:
 *   brief: "at the conclusion of your changes make me a brief with the write_debrief tool"
 *   plan: "before starting, create a detailed step-by-step plan and wait for my approval"
 *   todoc: |
 *     After completing changes, add/update JSDoc for all modified functions.
 *     Cover: parameters, return values, example usage, and edge cases.
 *
 * USAGE:
 *   "Do the next task #brief"
 *   → "Do the next task at the conclusion of your changes make me a brief with the write_debrief tool"
 *
 *   /hashtags              - browse all snippets; select one to insert it
 *   /hashtags brief        - directly insert #brief into the editor
 *
 * NOTE: Requires js-yaml. Run `npm install` in pi-hashtag-snippets/ once.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CustomEditor, getAgentDir } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";
import yaml from "js-yaml";

type Snippets = Record<string, string>;

// ─── Config loading ─────────────────────────────────────────────────────────

/**
 * Load snippets from YAML config files.
 * Files are processed in order; later files override earlier ones for the same key.
 */
function loadSnippets(cwd: string): Snippets {
	const configPaths = [
		join(getAgentDir(), "hashtag-snippets.yaml"),
		join(cwd, ".pi", "hashtag-snippets.yaml"),
	];

	let snippets: Snippets = {};

	for (const filePath of configPaths) {
		if (!existsSync(filePath)) continue;

		try {
			const content = readFileSync(filePath, "utf-8");
			const parsed = yaml.load(content);

			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				console.warn(`hashtag-snippets: ${filePath} must be a YAML object (key: value pairs)`);
				continue;
			}

			for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof value === "string") {
					snippets[key] = value;
				} else {
					console.warn(`hashtag-snippets: Skipping key "${key}" in ${filePath} — value must be a string`);
				}
			}
		} catch (err) {
			console.error(`hashtag-snippets: Failed to load ${filePath}:`, err);
		}
	}

	return snippets;
}

// ─── Autocomplete helpers ────────────────────────────────────────────────────

/** Returns tag names that start with `partial`, sorted alphabetically. */
function getMatches(snippets: Snippets, partial: string): string[] {
	return Object.keys(snippets)
		.filter((k) => k.startsWith(partial))
		.sort();
}

/**
 * Build the widget lines shown above the editor while a #word pattern is active.
 * Returns undefined if there are no matches (hides the widget).
 */
function buildWidgetLines(snippets: Snippets, partial: string, matches: string[]): string[] {
	const header =
		matches.length === 1
			? `  #${partial || "…"} → press Tab to complete:`
			: `  #${partial || "…"} — ${matches.length} matches, Tab to complete first:`;

	const lines: string[] = [header];

	for (const tag of matches.slice(0, 6)) {
		const raw = snippets[tag].replace(/\n/g, " ");
		const preview = raw.length > 55 ? raw.slice(0, 52) + "…" : raw;
		lines.push(`  #${tag}  →  ${preview}`);
	}

	if (matches.length > 6) {
		lines.push(`  … and ${matches.length - 6} more (type more chars to narrow down)`);
	}

	return lines;
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function hashtagSnippets(pi: ExtensionAPI) {
	let snippets: Snippets = {};

	// ── 1. Expansion at submit time ──────────────────────────────────────────

	pi.on("input", async (event) => {
		// Skip extension-injected messages to avoid infinite loops
		if (event.source === "extension") return { action: "continue" };

		const text = event.text;
		if (!text.includes("#")) return { action: "continue" };

		// Single-pass replacement: #tag → expansion (unknown tags left as-is)
		const transformed = text.replace(/#(\w+)/g, (_match, tag: string) =>
			snippets[tag] !== undefined ? snippets[tag] : _match,
		);

		if (transformed !== text) {
			return { action: "transform", text: transformed, images: event.images };
		}

		return { action: "continue" };
	});

	// ── 2. Live autocomplete via CustomEditor ────────────────────────────────

	function installEditor(ctx: ExtensionContext) {
		ctx.ui.setEditorComponent((tui, _theme, kb) => {
			// Anonymous class closes over `tui`, `ctx`, and `snippets`
			return new (class extends CustomEditor {
				handleInput(data: string): void {
					// ── Tab: complete the current #partial ──────────────────
					if (matchesKey(data, Key.tab)) {
						const text = ctx.ui.getEditorText();
						const hashMatch = text.match(/#(\w*)$/);

						if (hashMatch) {
							const partial = hashMatch[1];
							const matches = getMatches(snippets, partial);

							if (matches.length > 0) {
								const tagToInsert = matches[0]; // first alphabetical match
								const prefix = text.slice(0, text.length - hashMatch[0].length);

								// Defer to avoid re-entrancy within handleInput processing
								setTimeout(() => {
									ctx.ui.setEditorText(prefix + "#" + tagToInsert);
									ctx.ui.setWidget("hashtag-ac", undefined);
									tui.requestRender();
								}, 0);

								return; // consume Tab — don't pass to base editor
							}
						}
					}

					// ── All other keys: pass through, then update widget ─────
					super.handleInput(data);

					if (Object.keys(snippets).length > 0) {
						const text = ctx.ui.getEditorText();
						const hashMatch = text.match(/#(\w*)$/);

						if (hashMatch) {
							const partial = hashMatch[1];
							const matches = getMatches(snippets, partial);
							if (matches.length > 0) {
								ctx.ui.setWidget("hashtag-ac", buildWidgetLines(snippets, partial, matches));
							} else {
								ctx.ui.setWidget("hashtag-ac", undefined);
							}
						} else {
							ctx.ui.setWidget("hashtag-ac", undefined);
						}
					}
				}
			})(tui, _theme, kb);
		});
	}

	// ── 3. /hashtags command ─────────────────────────────────────────────────

	pi.registerCommand("hashtags", {
		description: "Browse and insert hashtag snippets",

		// Argument completions: /hashtags <partial-tag-name>
		getArgumentCompletions: (prefix: string) => {
			const names = Object.keys(snippets)
				.filter((n) => n.startsWith(prefix))
				.sort();
			if (names.length === 0) return null;
			return names.map((n) => ({
				value: n,
				label: `#${n}`,
				description: snippets[n].slice(0, 60).replace(/\n/g, " "),
			}));
		},

		handler: async (args, ctx) => {
			// Direct insert: /hashtags brief → appends #brief to editor
			if (args?.trim()) {
				const tag = args.trim();
				if (snippets[tag] !== undefined) {
					const current = ctx.ui.getEditorText();
					const sep = current && !current.endsWith(" ") ? " " : "";
					ctx.ui.setEditorText(current + sep + "#" + tag);
					ctx.ui.notify(`Inserted #${tag}`, "info");
				} else {
					const available = Object.keys(snippets).sort().join(", ") || "(none)";
					ctx.ui.notify(`Unknown snippet "#${tag}"\n\nAvailable: ${available}`, "error");
				}
				return;
			}

			// No args: show browser
			const names = Object.keys(snippets).sort();
			if (names.length === 0) {
				ctx.ui.notify(
					"No snippets defined.\n\nCreate one of:\n  ~/.pi/agent/hashtag-snippets.yaml  (global)\n  .pi/hashtag-snippets.yaml           (project)",
					"warning",
				);
				return;
			}

			const items = names.map((n) => {
				const preview = snippets[n].replace(/\n/g, " ");
				const truncated = preview.length > 65 ? preview.slice(0, 62) + "…" : preview;
				return `#${n}: ${truncated}`;
			});

			const selected = await ctx.ui.select("Hashtag Snippets — select to insert", items);
			if (selected) {
				const tag = selected.match(/^#(\w+):/)?.[1];
				if (tag) {
					const current = ctx.ui.getEditorText();
					const sep = current && !current.endsWith(" ") ? " " : "";
					ctx.ui.setEditorText(current + sep + "#" + tag);
					ctx.ui.notify(`Inserted #${tag}`, "info");
				}
			}
		},
	});

	// ── 4. Session lifecycle ─────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		snippets = loadSnippets(ctx.cwd);
		const count = Object.keys(snippets).length;

		if (ctx.hasUI) {
			installEditor(ctx);
			ctx.ui.setStatus("hashtag-snippets", count > 0 ? `#${count}` : undefined);
		}

		if (count === 0) {
			// Silent — no snippets is normal for new users, don't spam
		}
	});
}
