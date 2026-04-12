# pi-extensions

A small npm-workspace monorepo for Denifia's pi extensions.

Today the packages are consumed locally from disk by pi. Later, each package can be published to npm so users can install just the extension they want without knowing this is a monorepo.

## Local development

This repo is currently wired into local pi via `~/.pi/agent/settings.json`, pointing directly at package directories under `packages/`.

## Current packages

| Package | What it does | Quick install |
|---|---|---|
| `@denifia/pi-copilot-multiplier` | Adds `/copilot-mult` commands to show GitHub Copilot premium request multipliers for the current model. | `pi install npm:@denifia/pi-copilot-multiplier` |
| `@denifia/pi-delegate` | Adds a `/delegate` command that summarizes the current pi conversation and creates a GitHub issue for GitHub Copilot Coding Agent. | `pi install npm:@denifia/pi-delegate` |
| `@denifia/pi-windows-bash-guard` | Prevents Windows-specific cmd.exe habits from leaking into pi's bash tool and rewrites common `nul` usages safely. | `pi install npm:@denifia/pi-windows-bash-guard` |

## Repo layout

```text
packages/
  pi-copilot-multiplier/
    extensions/
      copilot-multiplier.ts
  pi-delegate/
    extensions/
      delegate.ts
  pi-windows-bash-guard/
    extensions/
      windows-bash-guard.ts
```

## Notes

- Each package is intended to become its own installable pi package.
- The repo root is an npm workspace, not itself a pi package.
- Until npm publish happens, local pi loads packages from the filesystem.
