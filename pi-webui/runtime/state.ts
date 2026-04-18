import { randomUUID } from "node:crypto";
import type { WebUiRuntime } from "./types";

export function createWebUiRuntime(): WebUiRuntime {
	return {
		clients: new Map(),
		authToken: randomUUID(),
		isStreaming: false,
	};
}
