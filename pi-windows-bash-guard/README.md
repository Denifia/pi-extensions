# pi-windows-bash-guard

A Pi extension that prevents Windows `cmd.exe` habits from leaking into Pi's bash tool on Windows hosts.

## What it does

On Windows, Pi's bash tool runs **bash** (Git Bash / WSL), not `cmd.exe`. This extension intercepts `bash` tool calls and:

- **Blocks Windows builtins** — `dir`, `copy`, `del`, `move`, `ren`, `md`, `rd` are blocked with a helpful suggestion for the correct bash equivalent.
- **Blocks `type <file>`** — redirects the agent to use the `read` tool or `cat` instead.
- **Rewrites `nul` → `/dev/null`** — silently fixes `>nul`, `2>nul`, `<nul`, and `1>nul` redirections in-place so the command succeeds rather than failing.
- **Guards unverified Python** — blocks `python`/`python3`/`py` calls until the agent has explicitly verified Python is available via `command -v` or `which`.

The extension is a no-op on non-Windows platforms.

## Install

**Pi package manager (recommended)**

```bash
pi install git:github.com/Denifia/pi-extensions
```

To enable only this extension, replace the package entry in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/Denifia/pi-extensions",
      "extensions": ["pi-windows-bash-guard/windows-bash-guard.ts"]
    }
  ]
}
```

**Local clone**

If you keep a local clone, add the extension to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/pi-windows-bash-guard/windows-bash-guard.ts"
  ]
}
```

## Requirements

- Windows host (the extension self-disables on Linux/macOS).
