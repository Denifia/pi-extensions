import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const WEBUI_SHELL_JS: string = readFileSync(join(__dirname, "shell-browser.js"), "utf8");
