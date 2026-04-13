# pi-debrief

A pi extension that generates a single-page HTML briefing document summarising significant work — so you can orient, assess, and decide without reading walls of terminal output.

---

## What you get

A self-contained HTML page saved to `.pi/debriefs/` at the git root of your project (or `~/.pi/debriefs/` if you are not in a git repo). The page has:

- A **header** with task type badge, version label, repo name, slug, and timestamp
- A **summary** of 2–4 sentences — enough to orient you without reading further
- **Contextual sections** chosen by the model based on the type of work done

Six task types are supported:

| Type | Typical sections |
|---|---|
| 🔧 Implementation | What was done · Files changed · How to test · What's next |
| 🗺️ Planning | Context & Problem · Proposed approach · Alternatives · Pros & Cons · Recommendations · Open questions |
| 🔍 Research | Key findings · Details · Recommendations |
| 🔎 Review | Issues found · What's good · Recommendations · Priority fixes |
| 🐛 Debug | Root cause · What was tried · Fix applied · How to verify · Recurrence risk |
| 📋 Requirements | Functional reqs · Non-functional reqs · Assumptions · Out of scope · Risks |

---

## Examples

Open any of the `examples/` HTML files to see the full output for each type. Screenshots of two below.

**Implementation — rate limiting added to an API gateway:**

![Implementation brief](examples/screenshot-implementation.png)

**Debug — memory leak investigation:**

![Debug brief](examples/screenshot-debug.png)

---

## Usage

### Commands

| Command | What it does |
|---|---|
| `/debrief` | Ask the model to write a brief immediately for the current session |
| `/debriefs` | List and open briefs grouped by slug |

Use `/debrief` when you want a brief now. `/debriefs` opens a selector — pick a slug, then a version if more than one exists — and opens the chosen file in your browser.

### Versioning

Briefs are grouped by **slug** — a short kebab-case identifier the model generates from the topic (e.g. `rate-limiting-api-gateway`, `auth-refactor`).

If you do follow-up work on the same topic and reuse the same slug, the extension writes a new file (`v2`, `v3`, etc.) and `/debriefs` shows them grouped.

Files are always named `YYYY-MM-DD-HHmm-<slug>.html` and are never modified after writing. The version label is derived at write time by counting existing files matching the slug.

### File locations

| Situation | Where briefs are saved |
|---|---|
| Inside a git repo | `<git-root>/.pi/debriefs/` |
| Not in a git repo | `~/.pi/debriefs/` |

`/debriefs` shows both locations at once — project briefs first, then global.

---

## Architecture

### Two moving parts

**1. `write_debrief` tool**

Registered as a callable tool the LLM can invoke. Accepts:

```typescript
{
  slug:     string    // kebab-case topic identifier
  taskType: "implementation" | "planning" | "research" | "review" | "debug" | "requirements"
  title:    string    // max 80 chars
  summary:  string    // 2–4 sentences
  sections: Array<{ heading: string; content: string }>
}
```

The extension renders the content to HTML, counts existing files matching the slug to set the version label, writes the file, and opens it in the browser.

**2. Commands**

`/debriefs` reads both debrief directories, groups files by slug, and presents a two-level selector: pick a slug, then pick a version if more than one exists. The selected file opens in the browser. `/debrief` sends a user message to the model to trigger a tool call.

### File naming

Files are always named `YYYY-MM-DD-HHmm-<slug>.html`. Files are never renamed or modified after writing. The version relationship (`v1`, `v2`, `v3`) is derived at write time by counting existing files matching the slug, and is displayed in the HTML header and in `/debriefs`.

---

## Example files

The `examples/` directory contains one pre-generated HTML brief for each task type with realistic (fictional) content. The `generate-examples.js` script regenerates them using the same renderer as the extension.

```
examples/
  example-implementation.html
  example-planning.html
  example-research.html
  example-review.html
  example-debug.html
  example-requirements.html
  screenshot-implementation.png
  screenshot-debug.png
```
