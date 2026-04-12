/**
 * GitHub Copilot Premium Request Multiplier
 *
 * Source of truth: GitHub Docs page
 *   https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers
 *
 * Approach
 * - Fetch the rendered GitHub Docs HTML page (the markdown API currently exposes an
 *   empty multiplier table even though the website shows the real rows)
 * - Extract the "Model multipliers" table from the HTML
 * - Map docs model names to pi's github-copilot model IDs
 * - Cache the parsed result on disk for 7 days
 *
 * Commands
 * - /copilot-mult           Show the active model multiplier
 * - /copilot-mult refresh   Bypass cache and refresh from GitHub Docs now
 * - /copilot-mult debug     Write parsed table/cache JSON to a temp file
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { ModelSelectorComponent } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const DOCS_URL = "https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers";
const CACHE_PATH = join(homedir(), ".pi", "agent", "cache", "copilot-multipliers.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

type DocsMultiplierCache = {
  fetchedAt: number;
  sourceUrl: string;
  byId: Record<string, number | null>;
  rows: Array<{
    model: string;
    paid: number | null;
    free: number | null;
    ids: string[];
  }>;
};

function parseMultiplierCell(text: string): number | null {
  const value = text.trim();
  if (!value || /^not applicable$/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

/**
 * Map docs-visible model names to pi github-copilot model IDs.
 * Keep this explicit so the extension tracks only what the website actually lists.
 */
function docsModelNameToIds(model: string): string[] {
  const exact: Record<string, string[]> = {
    "Claude Haiku 4.5": ["claude-haiku-4.5"],
    "Claude Opus 4.5": ["claude-opus-4.5"],
    "Claude Opus 4.6": ["claude-opus-4.6"],
    "Claude Opus 4.6 (fast mode) (preview)": [],
    "Claude Sonnet 4": ["claude-sonnet-4"],
    "Claude Sonnet 4.5": ["claude-sonnet-4.5"],
    "Claude Sonnet 4.6": ["claude-sonnet-4.6"],
    "Gemini 2.5 Pro": ["gemini-2.5-pro"],
    "Gemini 3 Flash": ["gemini-3-flash-preview"],
    "Gemini 3.1 Pro": ["gemini-3.1-pro-preview"],
    "GPT-4.1": ["gpt-4.1"],
    "GPT-4o": ["gpt-4o"],
    "GPT-5 mini": ["gpt-5-mini"],
    "GPT-5.1": ["gpt-5.1"],
    "GPT-5.2": ["gpt-5.2"],
    "GPT-5.2-Codex": ["gpt-5.2-codex"],
    "GPT-5.3-Codex": ["gpt-5.3-codex"],
    "GPT-5.4": ["gpt-5.4"],
    "GPT-5.4 mini": ["gpt-5.4-mini"],
    "Grok Code Fast 1": ["grok-code-fast-1"],
    "Raptor mini": [],
    "Goldeneye": [],
  };
  return exact[model] ?? [];
}

function formatMultiplierLabel(mult: number | null): string {
  if (mult === null) return "?×";
  if (mult === 0) return "FREE";
  const n = Number.isInteger(mult) ? String(mult) : String(mult);
  return `×${n}`;
}

function humanAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

async function readCacheFile(): Promise<DocsMultiplierCache | null> {
  try {
    const raw = await readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as DocsMultiplierCache;
    if (!parsed || typeof parsed !== "object" || typeof parsed.fetchedAt !== "number" || !parsed.byId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeCacheFile(cache: DocsMultiplierCache): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function parseDocsHtmlTable(html: string): DocsMultiplierCache {
  const tableStart = html.indexOf('<table><thead><tr><th scope="col">Model</th><th scope="col">Multiplier for <strong>paid plans</strong></th>');
  if (tableStart < 0) {
    throw new Error("Could not find multiplier table in GitHub Docs HTML");
  }

  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd < 0) {
    throw new Error("Could not find end of multiplier table in GitHub Docs HTML");
  }

  const tableHtml = html.slice(tableStart, tableEnd + "</table>".length);
  const rowRegex = /<tr><th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g;

  const byId: Record<string, number | null> = {};
  const rows: DocsMultiplierCache["rows"] = [];

  for (const match of tableHtml.matchAll(rowRegex)) {
    const model = decodeHtml(match[1].replace(/<[^>]+>/g, "").trim());
    const paid = parseMultiplierCell(decodeHtml(match[2].replace(/<[^>]+>/g, "").trim()));
    const free = parseMultiplierCell(decodeHtml(match[3].replace(/<[^>]+>/g, "").trim()));
    const ids = docsModelNameToIds(model);

    rows.push({ model, paid, free, ids });
    for (const id of ids) byId[id] = paid;
  }

  return {
    fetchedAt: Date.now(),
    sourceUrl: DOCS_URL,
    byId,
    rows,
  };
}

async function fetchDocsMultipliers(): Promise<DocsMultiplierCache> {
  const res = await fetch(DOCS_URL, {
    headers: {
      "User-Agent": "pi-copilot-multiplier-extension",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub Docs fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return parseDocsHtmlTable(html);
}

export default function (pi: ExtensionAPI) {
  let memCache: DocsMultiplierCache | null = null;

  function decorateModelIdForMenu(modelId: string, mult: number | null): string {
    return `${modelId} · ${formatMultiplierLabel(mult)}`;
  }

  async function getDocsCache(forceRefresh = false): Promise<{ cache: DocsMultiplierCache | null; source: "memory" | "disk" | "docs" | "stale-disk" | "none" }> {
    const now = Date.now();

    if (!forceRefresh && memCache && now - memCache.fetchedAt <= CACHE_TTL_MS) {
      return { cache: memCache, source: "memory" };
    }

    const diskCache = await readCacheFile();
    if (!forceRefresh && diskCache && now - diskCache.fetchedAt <= CACHE_TTL_MS) {
      memCache = diskCache;
      return { cache: diskCache, source: "disk" };
    }

    try {
      const fresh = await fetchDocsMultipliers();
      memCache = fresh;
      await writeCacheFile(fresh);
      return { cache: fresh, source: "docs" };
    } catch {
      if (diskCache) {
        memCache = diskCache;
        return { cache: diskCache, source: "stale-disk" };
      }
      return { cache: null, source: "none" };
    }
  }

  async function resolveMultiplier(modelId: string, forceRefresh = false): Promise<{
    mult: number | null;
    source: "memory" | "disk" | "docs" | "stale-disk" | "none";
    fetchedAt?: number;
  }> {
    const { cache, source } = await getDocsCache(forceRefresh);
    if (!cache) return { mult: null, source };
    return {
      mult: Object.prototype.hasOwnProperty.call(cache.byId, modelId) ? cache.byId[modelId] : null,
      source,
      fetchedAt: cache.fetchedAt,
    };
  }

  async function updateStatusBar(ctx: ExtensionContext, modelId: string): Promise<void> {
    if (!ctx.hasUI) return;

    const { mult } = await resolveMultiplier(modelId);
    const theme = ctx.ui.theme;
    const label = formatMultiplierLabel(mult);

    let colored: string;
    if (mult === null) {
      colored = theme.fg("warning", label);
    } else if (mult === 0) {
      colored = theme.fg("success", label);
    } else if (mult <= 1) {
      colored = theme.fg("accent", label);
    } else {
      colored = theme.fg("error", label);
    }

    const suffix = mult === null || mult === 0 ? "" : ` ${theme.fg("dim", "PR")}`;
    ctx.ui.setStatus("copilot-mult", `${colored}${suffix}`);
  }

  // Patch the built-in /model selector rows to append the multiplier badge.
  // This is not part of the official extension API, so it is intentionally small
  // and only decorates the display id used by the selector UI.
  const selectorProto = ModelSelectorComponent.prototype as any;
  if (!selectorProto.__copilotMultiplierPatched) {
    selectorProto.__copilotMultiplierPatched = true;
    const originalLoadModels = selectorProto.loadModels;
    selectorProto.loadModels = async function patchedLoadModels(this: any, ...args: any[]) {
      await originalLoadModels.apply(this, args);
      const { cache } = await getDocsCache(false);
      const byId = cache?.byId ?? {};
      const seen = new Set<any>();
      for (const collection of [this.allModels, this.scopedModelItems, this.activeModels, this.filteredModels]) {
        if (!Array.isArray(collection)) continue;
        for (const item of collection) {
          if (!item || seen.has(item) || !item.model?.id) continue;
          seen.add(item);
          const rawId = item.model.id;
          const mult = Object.prototype.hasOwnProperty.call(byId, rawId) ? byId[rawId] : null;
          item.id = decorateModelIdForMenu(rawId, mult);
        }
      }
    };
  }

  // Patch the built-in /scoped-models selector to show the same multiplier badge.
  // This component is not publicly exported by pi, so load it defensively from
  // the installed pi package. If that internal path changes, /scoped-models will
  // simply fall back to the default display instead of breaking extension load.
  const scopedSelectorModulePath = "C:/Users/mrlwa/AppData/Roaming/npm/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/scoped-models-selector.js";
  void import(scopedSelectorModulePath)
    .then((mod: any) => {
      const ScopedModelsSelectorComponent = mod?.ScopedModelsSelectorComponent;
      if (!ScopedModelsSelectorComponent?.prototype) return;
      const scopedProto = ScopedModelsSelectorComponent.prototype as any;
      if (scopedProto.__copilotMultiplierPatched) return;
      scopedProto.__copilotMultiplierPatched = true;
      const originalBuildItems = scopedProto.buildItems;
      scopedProto.buildItems = function patchedBuildItems(this: any, ...args: any[]) {
        const items = originalBuildItems.apply(this, args);
        const byId = memCache?.byId ?? {};
        return items.map((item: any) => {
          const rawId = item?.model?.id;
          if (!rawId) return item;
          const mult = Object.prototype.hasOwnProperty.call(byId, rawId) ? byId[rawId] : null;
          return {
            ...item,
            model: {
              ...item.model,
              id: decorateModelIdForMenu(rawId, mult),
            },
          };
        });
      };
    })
    .catch(() => {
      // Ignore internal import failures; /scoped-models just won't be decorated.
    });

  pi.on("session_start", async () => {
    // Warm the cache in the background so the /model menu usually has badges on
    // its first render without needing a synchronous docs fetch.
    void getDocsCache(false);
  });

  pi.on("model_select", async (event, ctx) => {
    const { model, source } = event;

    if (model.provider !== "github-copilot") {
      ctx.ui.setStatus("copilot-mult", undefined);
      return;
    }

    await updateStatusBar(ctx, model.id);

    if (!ctx.hasUI || source === "restore") return;

    const { mult, source: cacheSource, fetchedAt } = await resolveMultiplier(model.id);
    const age = fetchedAt ? humanAge(Date.now() - fetchedAt) : undefined;

    let message: string;
    let notifType: "info" | "warning" = "info";

    if (mult === null) {
      message = `${model.id} — multiplier not listed on GitHub Docs`;
      notifType = "warning";
    } else if (mult === 0) {
      message = `${model.id} — FREE ✓`;
    } else {
      const prWord = mult === 1 ? "premium request" : "premium requests";
      message = `${model.id} — ${formatMultiplierLabel(mult)} = ${mult} ${prWord} per prompt`;
      if (mult > 3) notifType = "warning";
    }

    if (cacheSource === "docs") message += `  [fetched from docs now]`;
    else if (cacheSource === "stale-disk") message += `  [using stale docs cache${age ? `, ${age} old` : ""}]`;
    else if (cacheSource === "disk" || cacheSource === "memory") message += age ? `  [docs cache, ${age} old]` : "  [docs cache]";
    else message += "  [docs unavailable]";

    ctx.ui.notify(message, notifType);
  });

  pi.registerCommand("copilot-mult", {
    description: "Show GitHub Copilot premium request multiplier for the active model. Use 'refresh' to refetch from GitHub Docs, or 'debug' to dump the parsed docs cache.",
    handler: async (args, ctx) => {
      const model = ctx.model;
      if (!model || model.provider !== "github-copilot") {
        ctx.ui.notify("No GitHub Copilot model is active. Switch to one with /model or Ctrl+P first.", "warning");
        return;
      }

      const command = args?.trim().toLowerCase() || "";
      const forceRefresh = command === "refresh";
      const debug = command === "debug";

      const { cache, source } = await getDocsCache(forceRefresh);
      if (!cache) {
        ctx.ui.notify("Could not fetch the GitHub Docs multiplier table and no cache is available.", "error");
        return;
      }

      if (debug) {
        const debugPath = join(tmpdir(), "copilot-multipliers-debug.json");
        await writeFile(debugPath, JSON.stringify(cache, null, 2), "utf8");
        ctx.ui.notify(`Parsed docs cache written to: ${debugPath}`, "info");
        return;
      }

      const mult = Object.prototype.hasOwnProperty.call(cache.byId, model.id) ? cache.byId[model.id] : null;
      const label = formatMultiplierLabel(mult);
      const age = humanAge(Date.now() - cache.fetchedAt);

      let msg = `${model.id}: ${label}`;
      if (mult !== null && mult > 0) {
        msg += mult === 1 ? " (1 premium request per prompt)" : ` (${mult} premium requests per prompt)`;
      }
      if (source === "docs") msg += " [fetched from GitHub Docs now]";
      else if (source === "stale-disk") msg += ` [stale GitHub Docs cache, ${age} old]`;
      else msg += ` [GitHub Docs cache, ${age} old]`;

      ctx.ui.notify(msg, mult !== null && mult > 3 ? "warning" : "info");
      await updateStatusBar(ctx, model.id);
    },
  });
}
