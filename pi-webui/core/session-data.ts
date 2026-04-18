import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { WebUiRuntime } from "../runtime/types";

function serializeTools(pi: ExtensionAPI) {
	return pi.getAllTools().map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}

function stripAvailableSkillsXml(systemPrompt?: string): string | undefined {
	if (!systemPrompt) return systemPrompt;

	const stripped = systemPrompt
		.replace(/\n?<available_skills>[\s\S]*?<\/available_skills>\n?/i, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd();

	return stripped;
}

export function buildSessionData(pi: ExtensionAPI, ctx: ExtensionContext, runtime: WebUiRuntime) {
	const fullSystemPrompt = ctx.getSystemPrompt?.() ?? runtime.currentSystemPrompt;
	const systemPrompt = stripAvailableSkillsXml(fullSystemPrompt);

	return {
		header: ctx.sessionManager.getHeader(),
		entries: ctx.sessionManager.getEntries(),
		leafId: ctx.sessionManager.getLeafId(),
		systemPrompt,
		fullSystemPrompt,
		tools: serializeTools(pi),
		renderedTools: undefined,
	};
}
