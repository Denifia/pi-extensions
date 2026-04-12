# pi-delegate

A Pi extension that summarises your current conversation with an LLM and creates a GitHub Issue assigned to `@copilot`, handing the work off to [GitHub Copilot Coding Agent](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-coding-agent) to resolve autonomously and open a pull request.

## What it does

- **`/delegate`** — generates a structured GitHub Issue (Context / Files / Task sections) from the current Pi conversation using your active model, lets you review and edit it, confirms before posting, and optionally opens the issue in your browser.
- **Optional focus prompt** — `/delegate fix the auth bug we discussed` steers the generated Task section toward a specific goal while still including full conversation context.

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
      "extensions": ["pi-delegate/delegate.ts"]
    }
  ]
}
```

**Local clone**

If you keep a local clone, add the extension to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/pi-delegate/delegate.ts"
  ]
}
```

## Requirements

- Working directory must be inside a GitHub repository.
- [`gh` CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`).
- The repository must have [GitHub Copilot Coding Agent enabled](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-coding-agent).
- A model must be selected in Pi (`/model`).
