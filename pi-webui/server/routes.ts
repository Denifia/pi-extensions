import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildSessionData } from "../core/session-data";
import { renderWebUiPage } from "../core/page";
import type { WebUiRuntime } from "../runtime/types";
import { broadcastRuntime, sendSnapshot } from "../runtime/broadcast";
import { json, makeClientId, readJson, sendSseHeaders, text } from "../utils/http";

interface PromptRequestBody {
	message?: string;
	deliverAs?: "steer" | "followUp";
}

interface TreeTargetRequestBody {
	entryId?: string;
}

function getContext(runtime: WebUiRuntime): ExtensionContext | ExtensionCommandContext | undefined {
	return runtime.currentContext;
}

function runtimeResponse(runtime: WebUiRuntime) {
	const sessionManager = runtime.currentSessionManager;
	return {
		isStreaming: runtime.isStreaming,
		sessionFile: sessionManager?.getSessionFile(),
		sessionId: sessionManager?.getSessionId(),
		sessionName: sessionManager?.getSessionName(),
		model: runtime.currentModel,
	};
}

function hasValidToken(url: URL, runtime: WebUiRuntime): boolean {
	return url.searchParams.get("token") === runtime.authToken;
}

export async function routeRequest(
	pi: ExtensionAPI,
	runtime: WebUiRuntime,
	request: IncomingMessage,
	response: ServerResponse,
	themeName?: string,
): Promise<void> {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const ctx = getContext(runtime);

	if (!ctx) {
		json(response, 503, { error: "webui is waiting for a live pi session context" });
		return;
	}

	if (request.method === "GET" && url.pathname === "/") {
		text(
			response,
			200,
			renderWebUiPage(buildSessionData(pi, ctx, runtime), themeName, runtime.authToken),
			"text/html; charset=utf-8",
		);
		return;
	}

	if (url.pathname.startsWith("/__webui/") && url.pathname !== "/__webui/health" && !hasValidToken(url, runtime)) {
		json(response, 403, { error: "forbidden" });
		return;
	}

	if (request.method === "GET" && url.pathname === "/__webui/api/session") {
		json(response, 200, {
			sessionData: buildSessionData(pi, ctx, runtime),
			runtime: runtimeResponse(runtime),
		});
		return;
	}

	if (request.method === "GET" && url.pathname === "/__webui/events") {
		const clientId = makeClientId();
		sendSseHeaders(response);
		response.write(": connected\n\n");
		runtime.clients.set(clientId, { id: clientId, response });
		sendSnapshot(pi, runtime, ctx, clientId);
		request.on("close", () => {
			runtime.clients.delete(clientId);
		});
		return;
	}

	if (request.method === "POST" && url.pathname === "/__webui/api/prompt") {
		const body = await readJson<PromptRequestBody>(request);
		const message = body.message?.trim();
		if (!message) {
			json(response, 400, { error: "message is required" });
			return;
		}

		const deliverAs = body.deliverAs ?? (runtime.isStreaming ? "followUp" : undefined);
		pi.sendUserMessage(message, deliverAs ? { deliverAs } : undefined);
		json(response, 200, { ok: true });
		return;
	}

	if (request.method === "POST" && url.pathname === "/__webui/api/abort") {
		runtime.abortCurrent?.();
		broadcastRuntime(runtime, ctx);
		json(response, 200, { ok: true });
		return;
	}

	if (request.method === "POST" && url.pathname === "/__webui/api/tree-target") {
		const body = await readJson<TreeTargetRequestBody>(request);
		const entryId = body.entryId?.trim();
		if (!entryId) {
			json(response, 400, { error: "entryId is required" });
			return;
		}

		const command = `/webui-tree ${entryId}`;
		const deliverAs = runtime.isStreaming ? "followUp" : undefined;
		pi.sendUserMessage(command, deliverAs ? { deliverAs } : undefined);
		json(response, 200, { ok: true, queued: Boolean(deliverAs) });
		return;
	}

	if (request.method === "GET" && url.pathname === "/__webui/health") {
		json(response, 200, { ok: true, runtime: runtimeResponse(runtime) });
		return;
	}

	json(response, 404, { error: "not_found" });
}
