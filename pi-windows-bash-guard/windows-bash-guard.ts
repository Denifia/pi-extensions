import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

const IS_WINDOWS = process.platform === "win32";

const CMD_BUILTIN_SUGGESTIONS: Array<{ name: string; replacement: string }> = [
  { name: "dir", replacement: "use `ls`, `find`, or `rg`" },
  { name: "copy", replacement: "use `cp`" },
  { name: "del", replacement: "use `rm`" },
  { name: "move", replacement: "use `mv`" },
  { name: "ren", replacement: "use `mv`" },
  { name: "md", replacement: "use `mkdir -p`" },
  { name: "rd", replacement: "use `rmdir` or `rm -r`" },
];

export default function windowsBashGuard(pi: ExtensionAPI) {
  if (!IS_WINDOWS) return;

  let pythonVerified = false;

  pi.on("session_start", async (_event, _ctx) => {
    pythonVerified = false;
  });

  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const originalCommand = event.input.command;
    const rewrittenCommand = rewriteWindowsNullDevice(originalCommand);
    if (rewrittenCommand !== originalCommand) {
      event.input.command = rewrittenCommand;
    }

    const cmdBuiltin = findWindowsBuiltin(event.input.command);
    if (cmdBuiltin) {
      return {
        block: true,
        reason: `Windows host detected, but the bash tool runs bash. Do not use \`${cmdBuiltin.name}\` here; ${cmdBuiltin.replacement} instead.`,
      };
    }

    if (looksLikeFileTypeCommand(event.input.command)) {
      return {
        block: true,
        reason:
          "The bash tool is running bash, not cmd.exe. `type <file>` is a Windows/cmd habit here. Use the `read` tool for files, or use `cat <file>` if bash output is specifically needed.",
      };
    }

    if (!pythonVerified && invokesPython(event.input.command)) {
      return {
        block: true,
        reason:
          "Python has not been verified in this Windows environment. Prefer a quick `node` script, or first verify Python with `command -v python || command -v py || command -v python3` and then retry if it exists.",
      };
    }
  });

  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "bash" || event.isError) return;
    const command = getBashCommand(event.input);
    if (!command) return;
    if (verifiesPythonAvailability(command)) {
      pythonVerified = true;
    }
  });
}

function rewriteWindowsNullDevice(command: string): string {
  return command
    .replace(/(^|[^\w/])2>nul(?=\s|$)/gi, (_match, prefix: string) => `${prefix}2>/dev/null`)
    .replace(/(^|[^\w/])1>nul(?=\s|$)/gi, (_match, prefix: string) => `${prefix}1>/dev/null`)
    .replace(/(^|[^\w/])>nul(?=\s|$)/gi, (_match, prefix: string) => `${prefix}>/dev/null`)
    .replace(/(^|[^\w/])<nul(?=\s|$)/gi, (_match, prefix: string) => `${prefix}</dev/null`);
}

function findWindowsBuiltin(command: string): { name: string; replacement: string } | undefined {
  for (const entry of CMD_BUILTIN_SUGGESTIONS) {
    const pattern = new RegExp(`(^|[;&|()\\n]\\s*)${entry.name}(?=\\s|$)`, "i");
    if (pattern.test(command)) return entry;
  }
  return undefined;
}

function looksLikeFileTypeCommand(command: string): boolean {
  const match = command.match(/(^|[;&|()\n]\s*)type\s+([^\s;&|()]+)/i);
  if (!match) return false;
  const target = stripQuotes(match[2]);
  if (!target) return false;
  if (target.startsWith("-")) return false;
  return /[./\\]/.test(target) || /\.[a-z0-9_-]+$/i.test(target);
}

function invokesPython(command: string): boolean {
  return /(^|[;&|()\n]\s*)(python|python3|py)(?=\s|$)/i.test(command);
}

function verifiesPythonAvailability(command: string): boolean {
  return /(command\s+-v|which)\s+(python|python3|py)\b/i.test(command);
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function getBashCommand(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}
