# pi-webui

A Pi extension that launches a browser UI for the current session.

## What it does

- **`/webui`** — starts a local HTTP server on `127.0.0.1`, opens your default browser, and renders the current Pi session with Pi's core export-html UI.
- **Live refresh** — listens for session, message, tool, and agent lifecycle updates over SSE and reloads the page as the session changes.
- **Browser controls** — lets you send prompts back into Pi and abort the current run from the browser.
- **Theme reuse** — reuses Pi's export-html assets and applies your active Pi theme.

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

1. Start a local server on a random localhost port.
2. Open the browser UI.
3. Keep the page updated while the session changes.

## Implementation notes

This extension intentionally does not vendor Pi's `export-html` frontend. Instead, it resolves the installed `@mariozechner/pi-coding-agent` package at runtime and serves the core assets from there, then layers a thin browser control shell on top.

That keeps the extension close to upstream Pi behavior and lets it automatically benefit from future core export-html improvements. The browser control endpoints are also guarded with a per-session token so other local browser tabs cannot blindly post prompts into Pi.

## Attribution

This extension is adapted from the original [`webui` extension](https://github.com/abhishekbhakat/my-pi/tree/dev/.pi/agent/extensions/webui) by **Abhishek Bhakat** (GitHub: [@abhishekbhakat](https://github.com/abhishekbhakat)).

This repo repackages it to match the `pi-extensions` package layout and includes a small path fix so project-local themes resolve from `.pi/themes`, which matches current Pi theme discovery.
