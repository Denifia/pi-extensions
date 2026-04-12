# TODO

## Publish packages to npm

- [ ] Decide on the final npm scope and confirm package names are available:
  - `@denifia/pi-copilot-multiplier`
  - `@denifia/pi-delegate`
  - `@denifia/pi-windows-bash-guard`
- [ ] Add package-level `README.md` files for each package.
- [ ] Optionally add gallery metadata (`image` or `video`) in each package's `package.json`.
- [ ] Add any missing metadata before publish (`homepage`, `bugs`, author info if desired).
- [ ] Run `npm login`.
- [ ] Publish each package from its package directory, e.g. `packages/pi-delegate/`, `packages/pi-copilot-multiplier/`, and `packages/pi-windows-bash-guard/`.
- [ ] Tag a release in git after the first publish.
- [ ] Update the root README once the npm packages are live.

## Local pi config cleanup

- [ ] Once npm packages exist, decide whether to keep local path entries in `~/.pi/agent/settings.json` for development or switch to npm package sources.
- [ ] If you add more local packages, add each package directory explicitly to `~/.pi/agent/settings.json` under `packages`.

## Future repo improvements

- [ ] Add more packages under `packages/` as new extensions are created.
- [ ] Consider an aggregate package later (for example `@denifia/pi-all`) if you want an install-everything option.
- [ ] Optionally add release automation for versioning and publish.
