/**
 * Delegate extension - summarize conversation and delegate to GitHub Copilot Coding Agent
 *
 * Creates a GitHub Issue assigned to @copilot with a structured summary of the
 * current conversation, letting GitHub's cloud coding agent handle the work
 * autonomously and open a pull request when done.
 *
 * Usage:
 *   /delegate
 *   /delegate fix the authentication bug we discussed
 *   /delegate implement phase 2 of the plan and add tests
 *
 * Requirements:
 *   - Working directory must be inside a GitHub repository
 *   - `gh` CLI must be authenticated (`gh auth login`)
 *   - The repository must have GitHub Copilot Coding Agent enabled
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Prompt for the LLM-generated issue content
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a context extraction assistant. Given a conversation history (and optionally a specific task focus), generate a GitHub Issue that delegates work to an autonomous coding agent.

Output ONLY valid JSON — no preamble, no markdown code fences, no extra text:
{
  "title": "Short, action-oriented issue title (max 80 chars)",
  "body": "Full markdown issue body"
}

The issue body MUST contain these sections in order:
## Context
Summarise what has been discussed: goals, key decisions, approaches tried, and important findings. Be concise but complete — the agent has no access to the original conversation.

## Files
List files that were modified, created, or are directly relevant (one per line as a bullet). Omit this section only if no files were mentioned.

## Task
A clear, precise description of exactly what the coding agent should do next. If the user provided a focus prompt, make this the centrepiece. Otherwise derive the logical next step from the conversation.

Keep the tone technical and direct. The agent reads this issue as its sole source of truth.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub remote URL into "owner/repo".
 * Handles SSH (git@github.com:owner/repo.git) and HTTPS variants.
 */
function parseGitHubRemote(url: string): string | null {
	const ssh = url.match(/git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/);
	if (ssh) return ssh[1];
	const https = url.match(/https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/);
	if (https) return https[1];
	return null;
}

/**
 * Extract an issue number from a GitHub issue URL.
 * e.g. "https://github.com/owner/repo/issues/42" → 42
 */
function extractIssueNumber(url: string): number | null {
	const m = url.match(/\/issues\/(\d+)\s*$/);
	return m ? parseInt(m[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerCommand("delegate", {
		description: "Summarize conversation and delegate work to GitHub Copilot Coding Agent",

		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("delegate requires interactive mode", "error");
				return;
			}

			// Wait for any in-progress agent turn to settle before reading the session.
			await ctx.waitForIdle();

			// ------------------------------------------------------------------
			// 1. Detect GitHub repository
			// ------------------------------------------------------------------
			const remoteResult = await pi.exec("git", ["remote", "get-url", "origin"]);
			if (remoteResult.code !== 0) {
				ctx.ui.notify(
					"Not in a git repository with a remote origin. Delegate requires a GitHub repo.",
					"error",
				);
				return;
			}

			const ownerRepo = parseGitHubRemote(remoteResult.stdout.trim());
			if (!ownerRepo) {
				ctx.ui.notify(
					`Remote does not look like a GitHub URL:\n${remoteResult.stdout.trim()}`,
					"error",
				);
				return;
			}

			// ------------------------------------------------------------------
			// 2. Verify gh authentication
			// ------------------------------------------------------------------
			const authResult = await pi.exec("gh", ["auth", "status"]);
			if (authResult.code !== 0) {
				ctx.ui.notify("gh CLI is not authenticated. Run: gh auth login", "error");
				return;
			}

			// ------------------------------------------------------------------
			// 3. Require a model to summarise with
			// ------------------------------------------------------------------
			if (!ctx.model) {
				ctx.ui.notify("No model selected. Pick one with /model first.", "error");
				return;
			}

			// ------------------------------------------------------------------
			// 4. Collect conversation history
			// ------------------------------------------------------------------
			const branch = ctx.sessionManager.getBranch();
			const messages = branch
				.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
				.map((entry) => entry.message);

			if (messages.length === 0) {
				ctx.ui.notify("No conversation history yet — nothing to delegate.", "warning");
				return;
			}

			// ------------------------------------------------------------------
			// 5. Generate issue title + body with the current model
			// ------------------------------------------------------------------
			const focusPrompt = args.trim();

			const generated = await ctx.ui.custom<{ title: string; body: string } | null>(
				(tui, theme, _kb, done) => {
					const loader = new BorderedLoader(
						tui,
						theme,
						`Generating GitHub issue via ${ctx.model!.provider}/${ctx.model!.id}...`,
					);
					loader.onAbort = () => done(null);

					const doGenerate = async (): Promise<{ title: string; body: string } | null> => {
						const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
						if (!auth.ok || !auth.apiKey) {
							throw new Error(
								auth.ok ? `No API key for ${ctx.model!.provider}` : (auth as any).error,
							);
						}

						const llmMessages = convertToLlm(messages);
						const conversationText = serializeConversation(llmMessages);

						const userContent = focusPrompt
							? `## Conversation History\n\n${conversationText}\n\n## Focus / Additional Task Instructions\n\n${focusPrompt}`
							: `## Conversation History\n\n${conversationText}`;

						const response = await complete(
							ctx.model!,
							{
								systemPrompt: SYSTEM_PROMPT,
								messages: [
									{
										role: "user",
										content: [{ type: "text", text: userContent }],
										timestamp: Date.now(),
									},
								],
							},
							{ apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
						);

						if (response.stopReason === "aborted") return null;

						const raw = response.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("\n");

						// Strip optional markdown code fences the LLM might add
						const stripped = raw
							.replace(/^```(?:json)?\s*/m, "")
							.replace(/\s*```\s*$/m, "")
							.trim();

						const jsonMatch = stripped.match(/\{[\s\S]*\}/);
						if (!jsonMatch) {
							throw new Error(
								`Could not parse LLM response as JSON. Got:\n${raw.slice(0, 300)}`,
							);
						}

						const parsed = JSON.parse(jsonMatch[0]) as {
							title?: string;
							body?: string;
						};

						if (!parsed.title || !parsed.body) {
							throw new Error("LLM response is missing 'title' or 'body' fields.");
						}

						return { title: parsed.title.trim(), body: parsed.body.trim() };
					};

					doGenerate()
						.then(done)
						.catch((err: Error) => {
							ctx.ui.notify(`Summary generation failed: ${err.message}`, "error");
							done(null);
						});

					return loader;
				},
			);

			if (generated === null) {
				ctx.ui.notify("Cancelled.", "info");
				return;
			}

			// ------------------------------------------------------------------
			// 6. Let the user review and edit the issue (first line = title)
			// ------------------------------------------------------------------
			const initialEditorContent = `${generated.title}\n\n${generated.body}`;
			const editedContent = await ctx.ui.editor(
				"Review GitHub Issue  (first line = title, rest = body)",
				initialEditorContent,
			);

			if (editedContent === undefined) {
				ctx.ui.notify("Cancelled.", "info");
				return;
			}

			const lines = editedContent.split("\n");
			const finalTitle = lines[0].replace(/^#+\s*/, "").trim() || generated.title;
			const finalBody = lines.slice(1).join("\n").trim();

			if (!finalTitle) {
				ctx.ui.notify("Issue title is empty — aborting.", "error");
				return;
			}

			// ------------------------------------------------------------------
			// 7. Confirm before creating the issue
			// ------------------------------------------------------------------
			const confirmed = await ctx.ui.confirm(
				"Delegate to GitHub Copilot?",
				[
					`Repo:  ${ownerRepo}`,
					`Title: ${finalTitle}`,
					``,
					`A GitHub Issue will be created and assigned to @copilot.`,
					`Copilot will analyse the issue and open a pull request.`,
				].join("\n"),
			);

			if (!confirmed) {
				ctx.ui.notify("Cancelled.", "info");
				return;
			}

			// ------------------------------------------------------------------
			// 8. Write body to a temp file to avoid shell-quoting problems
			// ------------------------------------------------------------------
			let tmpDir: string | null = null;
			let tmpBodyFile: string | null = null;

			try {
				tmpDir = await mkdtemp(join(tmpdir(), "pi-delegate-"));
				tmpBodyFile = join(tmpDir, "issue-body.md");
				await writeFile(tmpBodyFile, finalBody, "utf-8");

				ctx.ui.notify(`Creating issue in ${ownerRepo}…`, "info");

				const createResult = await pi.exec("gh", [
					"issue",
					"create",
					"--repo",
					ownerRepo,
					"--title",
					finalTitle,
					"--body-file",
					tmpBodyFile,
					"--assignee",
					"@copilot",
				]);

				if (createResult.code !== 0) {
					const errMsg = (createResult.stderr || createResult.stdout || "unknown error").trim();
					ctx.ui.notify(`Failed to create issue:\n${errMsg}`, "error");
					return;
				}

				// gh issue create outputs the URL as the last non-empty line
				const issueUrl = createResult.stdout
					.split("\n")
					.map((l) => l.trim())
					.filter(Boolean)
					.pop() ?? "";

				ctx.ui.notify(`✓ Delegated to Copilot Coding Agent!\n${issueUrl}`, "success");

				// ------------------------------------------------------------------
				// 9. Offer to open the issue in the browser
				// ------------------------------------------------------------------
				if (issueUrl) {
					const openBrowser = await ctx.ui.confirm("Open issue in browser?", issueUrl);
					if (openBrowser) {
						const issueNumber = extractIssueNumber(issueUrl);
						if (issueNumber !== null) {
							await pi.exec("gh", [
								"issue",
								"view",
								String(issueNumber),
								"--web",
								"--repo",
								ownerRepo,
							]);
						}
					}
				}
			} finally {
				if (tmpBodyFile) try { await rm(tmpBodyFile); } catch { /* ignore */ }
				if (tmpDir) try { await rm(tmpDir, { recursive: true }); } catch { /* ignore */ }
			}
		},
	});
}
