# pi-webui

A Pi extension that opens a browser view for the active session using Pi's built-in `export-html` UI, then adds a lightweight control layer on top.

## What it does

- **`/webui`** — starts a local HTTP server on `127.0.0.1` using a random port, then opens your default browser.
- **Core Pi transcript view** — renders the current session with Pi's own `export-html` template instead of shipping a separate frontend.
- **Theme-aware rendering** — applies your active Pi theme, including project-local `.pi/themes/<name>.json`, global `~/.pi/agent/themes/<name>.json`, and Pi's built-in themes.
- **Browser controls** — lets you send prompts, queue follow-up prompts while Pi is already streaming, and abort the current run from the browser.
- **Live session status** — keeps connection and streaming state updated over SSE, then reloads the transcript when Pi emits a session refresh or the current agent run ends.
- **Extra browser polish** — adds copy-as-Markdown buttons, preserves tree filter/search state across reloads, shows available skills from the full system prompt, fixes tool-result tree navigation, and renders a few entry types that Pi's stock export template skips.

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
      "extensions": ["pi-webui/index.ts"]
    }
  ]
}
```

**Local clone**

If you keep a local clone, add the extension to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/pi-webui/index.ts"
  ]
}
```

## Usage

Run:

```text
/webui
```

Pi will:

1. Start a localhost server on a random port.
2. Open the browser UI.
3. Keep the page connected to the active session until Pi shuts the session down.

If the server is already running for the current Pi process, `/webui` reuses it and opens the existing page again.

## Notes on behaviour

- The browser view reuses Pi's export page, so most transcript rendering stays aligned with upstream Pi.
- Runtime status updates live while Pi is working, but the transcript itself is refreshed by page reload after a session update or when a run finishes. It is not doing token-by-token DOM patching in the browser.
- Browser control endpoints and SSE use a per-runtime token embedded into the served page. The root HTML page itself is still served on localhost without authentication.

## Implementation notes

This extension intentionally does not vendor Pi's `export-html` frontend. Instead, it resolves the installed `@mariozechner/pi-coding-agent` package at runtime, reads the core export assets from there, and layers a small browser shell on top.

That keeps the transcript view close to upstream Pi behavior and lets the extension inherit future `export-html` improvements more easily. The shell is where the extra controls and compatibility fixes live, including theme resolution for project-local themes and DOM patches for skipped entry types and tool-result navigation.

## Attribution

This extension is adapted from the original [`webui` extension](https://github.com/abhishekbhakat/my-pi/tree/dev/.pi/agent/extensions/webui) by **Abhishek Bhakat** (GitHub: [@abhishekbhakat](https://github.com/abhishekbhakat)).

This repo repackages it for the `pi-extensions` package layout and extends it with current Pi theme resolution, browser controls, and compatibility fixes around the upstream export UI.
