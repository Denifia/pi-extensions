# pi-copilot-multiplier

A Pi extension that fetches and displays [GitHub Copilot premium request multipliers](https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers) for every model.

## What it does

- **Status bar badge** — shows the active model's multiplier (e.g. `×5`, `FREE`) in the Pi status bar whenever you switch models.
- **`/model` & `/scoped-models` menus** — annotates every model row with its multiplier so you can compare cost at a glance before switching.
- **`/copilot-mult` command** — prints the multiplier and cache age for the currently active model.
  - `/copilot-mult refresh` — bypasses the 7-day cache and re-fetches from GitHub Docs immediately.
  - `/copilot-mult debug` — dumps the full parsed docs cache to a temp JSON file.
- **7-day disk cache** — stores parsed data at `~/.pi/agent/cache/copilot-multipliers.json` so the Docs page is not hit on every start.

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
      "extensions": ["pi-copilot-multiplier/copilot-multiplier.ts"]
    }
  ]
}
```

**Local clone**

If you keep a local clone, add the extension to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/pi-copilot-multiplier/copilot-multiplier.ts"
  ]
}
```

## Requirements

- Pi coding agent with a GitHub Copilot provider configured.
