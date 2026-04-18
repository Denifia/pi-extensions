(function () {
  "use strict";

  var STORAGE_FILTER = "pi-webui:filter";
  var STORAGE_SEARCH = "pi-webui:tree-search";
  var RELOAD_QUIET_MS = 400;

  var appState = {
    initialized: false,
    eventSource: null,
    pendingReload: null,
    reloadTimer: null
  };

  // entryId of a toolResult tree click waiting for ID-patching to complete
  var pendingScrollTarget = null;
  // lazily-built Set of toolResult entry IDs for O(1) lookup
  var toolResultIdSet = null;

  function ensureToolResultIdSet() {
    if (toolResultIdSet) return toolResultIdSet;
    toolResultIdSet = new Set();
    var sd = parseSessionData();
    if (!sd || !sd.entries) return toolResultIdSet;
    for (var i = 0; i < sd.entries.length; i++) {
      var e = sd.entries[i];
      if (e.type === "message" && e.message && e.message.role === "toolResult") {
        toolResultIdSet.add(e.id);
      }
    }
    return toolResultIdSet;
  }

  var WEBUI_TOKEN = window.__PI_WEBUI_TOKEN__ || "";

  function withToken(path) {
    var sep = path.indexOf("?") === -1 ? "?" : "&";
    return path + sep + "token=" + encodeURIComponent(WEBUI_TOKEN);
  }

  // --- State persistence ---

  function saveFilter() {
    var active = document.querySelector(".filter-btn.active");
    if (active) {
      try { localStorage.setItem(STORAGE_FILTER, active.dataset.filter || "default"); } catch (e) {}
    }
  }

  function saveSearch() {
    var input = document.getElementById("tree-search");
    if (input) {
      try { localStorage.setItem(STORAGE_SEARCH, input.value || ""); } catch (e) {}
    }
  }

  function restoreFilter() {
    try {
      var saved = localStorage.getItem(STORAGE_FILTER);
      if (!saved) return;
      setTimeout(function () {
        var btns = document.querySelectorAll(".filter-btn");
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].dataset.filter === saved) {
            btns[i].click();
            break;
          }
        }
      }, 50);
    } catch (e) {}
  }

  function restoreSearch() {
    try {
      var saved = localStorage.getItem(STORAGE_SEARCH);
      if (!saved) return;
      setTimeout(function () {
        var input = document.getElementById("tree-search");
        if (input) {
          input.value = saved;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, 50);
    } catch (e) {}
  }

  function trackFilterChanges() {
    var btns = document.querySelectorAll(".filter-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        setTimeout(saveFilter, 50);
      });
    }
  }

  function trackSearchChanges() {
    var input = document.getElementById("tree-search");
    if (input) {
      input.addEventListener("input", function () {
        setTimeout(saveSearch, 100);
      });
    }
  }

  function saveAllState() {
    saveFilter();
    saveSearch();
  }

  // --- UI injection ---

  function injectControlBar() {
    if (document.getElementById("webui-control-bar")) return;
    var content = document.getElementById("content");
    if (!content) return;

    var bar = document.createElement("div");
    bar.id = "webui-control-bar";
    bar.innerHTML = [
      '<div class="webui-status">',
      '  <span id="webui-connection">connecting...</span>',
      '  <span id="webui-streaming"></span>',
      '  <span id="webui-shortcuts">Ctrl/Cmd+Enter to send</span>',
      "</div>",
      '<form id="webui-prompt-form" class="webui-prompt-form">',
      '  <textarea id="webui-prompt-input" rows="3" placeholder="Send a prompt to pi..."></textarea>',
      '  <div class="webui-prompt-actions">',
      '    <button type="button" id="webui-abort">Abort</button>',
      '    <button type="submit">Send</button>',
      "  </div>",
      "</form>"
    ].join("");

    content.appendChild(bar);

    var goBottomBtn = document.createElement("button");
    goBottomBtn.type = "button";
    goBottomBtn.id = "webui-go-bottom";
    goBottomBtn.className = "webui-go-bottom";
    goBottomBtn.title = "Scroll to bottom";
    goBottomBtn.textContent = "↓ Bottom";
    document.body.appendChild(goBottomBtn);

    goBottomBtn.addEventListener("click", function () {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    });

    function updateGoBottomVisibility() {
      var scrollPos = window.scrollY + window.innerHeight;
      var pageHeight = document.documentElement.scrollHeight;
      var threshold = 140;
      if (scrollPos < pageHeight - threshold) {
        goBottomBtn.classList.add("visible");
      } else {
        goBottomBtn.classList.remove("visible");
      }
    }

    window.addEventListener("scroll", updateGoBottomVisibility);
    window.addEventListener("resize", updateGoBottomVisibility);
    setTimeout(updateGoBottomVisibility, 100);

    document.getElementById("webui-abort").addEventListener("click", function () {
      fetch(withToken("/__webui/api/abort"), { method: "POST" });
    });

    var promptForm = document.getElementById("webui-prompt-form");
    var promptInput = document.getElementById("webui-prompt-input");

    async function submitPrompt() {
      var message = promptInput.value.trim();
      if (!message) return;
      promptInput.value = "";
      autoResize(promptInput);
      await fetch(withToken("/__webui/api/prompt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: message })
      });
    }

    promptForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      await submitPrompt();
    });

    function autoResize(el) {
      el.style.height = "auto";
      var newHeight = Math.min(Math.max(el.scrollHeight, 48), 200);
      el.style.height = newHeight + "px";
    }

    promptInput.addEventListener("input", function () {
      autoResize(this);
    });

    promptInput.addEventListener("keydown", async function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        await submitPrompt();
      }
    });
  }

  function extractMarkdown(messageEl) {
    var parts = [];
    var children = messageEl.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.classList.contains("copy-link-btn") || child.classList.contains("copy-md-btn")) continue;
      if (child.classList.contains("message-timestamp")) continue;
      if (child.classList.contains("markdown-content") || child.classList.contains("assistant-text")) {
        parts.push(child.innerText);
      } else if (child.classList.contains("thinking-block")) {
        var thinkingText = child.querySelector(".thinking-text");
        if (thinkingText) parts.push("[thinking]\n" + thinkingText.innerText + "\n[/thinking]");
      } else if (child.classList.contains("tool-execution") || child.classList.contains("expandable-container")) {
        var commandEl = child.querySelector(".tool-command");
        var outputEl = child.querySelector(".tool-output") || child.querySelector(".output-full");
        if (commandEl) parts.push(commandEl.innerText);
        if (outputEl) parts.push(outputEl.innerText);
      } else if (child.classList.contains("message-images")) {
        // skip images
      } else if (child.innerText && child.innerText.trim()) {
        parts.push(child.innerText.trim());
      }
    }
    return parts.join("\n\n");
  }

  function copyToClipboard(text, button) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showCopied(button);
      }).catch(function () {
        fallbackCopy(text, button);
      });
      return;
    }
    fallbackCopy(text, button);
  }

  function fallbackCopy(text, button) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showCopied(button);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }

  function showCopied(button) {
    var orig = button.innerHTML;
    button.innerHTML = "\u2713";
    button.classList.add("copied");
    setTimeout(function () {
      button.innerHTML = orig;
      button.classList.remove("copied");
    }, 1500);
  }

  function injectCopyMarkdownButtons() {
    var messages = document.querySelectorAll(".user-message, .assistant-message");
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.querySelector(".copy-md-btn")) continue;
      var btn = document.createElement("button");
      btn.className = "copy-md-btn";
      btn.title = "Copy as markdown";
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
      btn.addEventListener("click", (function (el) {
        return function (e) {
          e.preventDefault();
          e.stopPropagation();
          var md = extractMarkdown(el);
          copyToClipboard(md, btn);
        };
      })(msg));
      msg.insertBefore(btn, msg.firstChild.nextSibling);
    }
  }

  function injectStyles() {
    if (document.getElementById("webui-style")) return;
    var style = document.createElement("style");
    style.id = "webui-style";
    style.textContent = [
      ":root { --line-height: 22px; --sidebar-width: 480px; --sidebar-max-width: 1040px; }",
      "body { font-size: 14px; }",
      "#content { padding-left: 28px; padding-right: 28px; }",
      "#content > * { max-width: min(1400px, calc(100vw - 96px)); }",
      "#messages, .assistant-text, .thinking-text, .tool-output, .tool-command, .markdown-content, .hook-message, .branch-summary, .compaction, .system-prompt, .tools-list { font-size: 14px; }",
      ".header h1 { font-size: 16px; }",
      ".header-info, .tool-item, .tool-param, .model-change { font-size: 13px; }",
      ".message-timestamp, .tree-status, .system-prompt-note { font-size: 11px; }",
      "#webui-control-bar { padding: 16px; border-top: 1px solid var(--dim); background: var(--exportCardBg); position: sticky; bottom: 0; z-index: 20; margin-top: auto; }",
      ".webui-status { display: flex; flex-direction: column; gap: 0; color: var(--muted); font-size: 12px; margin-bottom: 8px; }",
      "#webui-shortcuts { opacity: 0.85; }",
      ".webui-prompt-form { display: flex; flex-direction: column; gap: 8px; }",
      "#webui-prompt-input { width: 100%; resize: none; border: 1px solid var(--dim); border-radius: 4px; background: var(--body-bg); color: var(--text); font: inherit; font-size: 14px; padding: 10px 12px; line-height: 1.45; min-height: 52px; max-height: 220px; overflow-y: auto; box-sizing: border-box; }",
      ".webui-prompt-actions { display: flex; gap: 8px; justify-content: flex-end; }",
      ".webui-prompt-actions button { background: var(--accent); color: var(--body-bg); border: none; border-radius: 4px; padding: 8px 18px; cursor: pointer; font: inherit; font-size: 13px; }",
      ".webui-prompt-actions button:hover { opacity: 0.92; }",

      ".copy-md-btn { position: absolute; top: 8px; right: 40px; width: 28px; height: 28px; padding: 6px; background: var(--container-bg); border: 1px solid var(--dim); border-radius: 4px; color: var(--muted); cursor: pointer; opacity: 0; transition: opacity 0.15s, background 0.15s, color 0.15s; display: flex; align-items: center; justify-content: center; z-index: 10; }",
      ".user-message:hover .copy-md-btn, .assistant-message:hover .copy-md-btn { opacity: 1; }",
      ".copy-md-btn:hover { background: var(--accent); color: var(--body-bg); border-color: var(--accent); }",
      ".copy-md-btn.copied { background: var(--success, #22c55e); color: white; border-color: var(--success, #22c55e); }",
      ".webui-go-bottom { position: fixed; right: 24px; bottom: 24px; z-index: 2000; background: var(--accent); color: var(--body-bg); border: 1px solid color-mix(in oklab, var(--accent) 70%, black); border-radius: 999px; padding: 8px 12px; cursor: pointer; font: inherit; font-size: 12px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); opacity: 0; pointer-events: none; transform: translateY(6px); transition: opacity 0.2s, transform 0.2s; }",
      ".webui-go-bottom.visible { opacity: 0.95; pointer-events: all; transform: translateY(0); }",
      ".webui-go-bottom:hover { opacity: 1; }",
      ".skill-item { font-size: 11px; }",
      ".skill-item.has-details { cursor: pointer; }",
      ".skill-item-name { font-weight: bold; color: var(--text); }",
      ".skill-item-desc { color: var(--dim); }",
      ".skill-details-hint { color: var(--muted); font-style: italic; }",
      ".skill-details-hint::after { content: '[click to show location]'; }",
      ".skill-item.details-expanded .skill-details-hint::after { content: '[hide location]'; }",
      ".skill-details { display: none; margin-top: 4px; margin-left: 12px; padding-left: 8px; border-left: 1px solid var(--dim); }",
      ".skill-item.details-expanded .skill-details { display: block; }",
      ".skill-field { margin-bottom: 4px; font-size: 11px; }",
      ".skill-field-name { font-weight: bold; color: var(--text); }",
      ".skill-field-value { color: var(--dim); word-break: break-all; }",
      ".tool-execution.clicked-highlight { box-shadow: 0 0 0 2px var(--accent, #2196f3); transition: box-shadow 0.7s ease-out; }",
      ".tool-execution.clicked-highlight-fade { box-shadow: 0 0 0 0 transparent; transition: box-shadow 0.7s ease-out; }"
    ].join("\n");
    document.head.appendChild(style);
  }

  // --- Tool result ID patching ---
  // The core template renders toolResult entries as empty strings.
  // Tool output is rendered as .tool-execution inside the assistant message via renderToolCall.
  // Tree nodes for toolResult entries point at entry-<toolResultId> which doesn't exist in DOM.
  // Fix: after each render, assign the correct id to .tool-execution blocks so the core
  // highlight/scroll logic finds them.

  // --- Helpers for shell-side rendering (can't access template.js IIFE scope) ---

  function shellEscapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shellFormatTimestamp(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) { return ""; }
  }

  function parseSessionData() {
    try {
      var encoded = document.getElementById("session-data");
      if (!encoded) return null;
      var binary = atob(encoded.textContent || "");
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return JSON.parse(new TextDecoder("utf-8").decode(bytes));
    } catch (e) {
      return null;
    }
  }

  function decodeXmlEntities(text) {
    return String(text || "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  function extractXmlTagText(xml, tagName) {
    var pattern = new RegExp("<" + tagName + ">([\\s\\S]*?)<\\/" + tagName + ">", "i");
    var match = pattern.exec(xml || "");
    return match ? decodeXmlEntities(match[1].trim()) : "";
  }

  function parseAvailableSkillsFromSystemPrompt(systemPrompt) {
    if (!systemPrompt) return [];

    var outer = /<available_skills>([\s\S]*?)<\/available_skills>/i.exec(systemPrompt);
    if (!outer) return [];

    var block = outer[1];
    var skillPattern = /<skill>([\s\S]*?)<\/skill>/gi;
    var skills = [];
    var match;

    while ((match = skillPattern.exec(block)) !== null) {
      var rawSkill = match[1] || "";
      var name = extractXmlTagText(rawSkill, "name");
      var description = extractXmlTagText(rawSkill, "description");
      var location = extractXmlTagText(rawSkill, "location");
      if (!name) continue;
      skills.push({ name: name, description: description, location: location });
    }

    return skills;
  }

  function injectAvailableSkillsPanel() {
    var headerContainer = document.getElementById("header-container");
    if (!headerContainer) return;

    var existing = document.getElementById("webui-skills-list");
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    var sessionData = parseSessionData();
    var promptForSkills = sessionData && (sessionData.fullSystemPrompt || sessionData.systemPrompt);
    if (!promptForSkills) return;

    var skills = parseAvailableSkillsFromSystemPrompt(promptForSkills);
    if (!skills.length) return;

    var panel = document.createElement("div");
    panel.id = "webui-skills-list";
    panel.className = "tools-list skills-list";

    var html = '<div class="tools-header skills-header">Available Skills</div><div class="skills-content">';
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i];
      var hasDetails = !!skill.location;
      html += '<div class="skill-item' + (hasDetails ? ' has-details' : '') + '">';
      html += '<span class="skill-item-name">' + shellEscapeHtml(skill.name) + '</span>';
      if (skill.description) {
        html += ' - <span class="skill-item-desc">' + shellEscapeHtml(skill.description) + '</span>';
      }
      if (hasDetails) {
        html += ' <span class="skill-details-hint"></span>';
        html += '<div class="skill-details">';
        html += '<div class="skill-field"><span class="skill-field-name">location</span> - <span class="skill-field-value">' + shellEscapeHtml(skill.location) + '</span></div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    panel.innerHTML = html;

    var toolPanel = headerContainer.querySelector(".tools-list");
    if (toolPanel && toolPanel.parentNode === headerContainer) {
      if (toolPanel.nextSibling) headerContainer.insertBefore(panel, toolPanel.nextSibling);
      else headerContainer.appendChild(panel);
    } else {
      headerContainer.appendChild(panel);
    }

    var detailItems = panel.querySelectorAll(".skill-item.has-details");
    for (var j = 0; j < detailItems.length; j++) {
      detailItems[j].addEventListener("click", function () {
        if (window.getSelection().toString()) return;
        this.classList.toggle("details-expanded");
      });
    }
  }

  /**
   * Render a DOM string for entry types the core template.js skips (returns '' for).
   * Currently handles: thinking_level_change, session_info.
   * Returns empty string if there is nothing meaningful to show.
   */
  function renderUnrenderedEntry(entry) {
    var id = "entry-" + entry.id;
    var ts = shellFormatTimestamp(entry.timestamp);
    var tsHtml = ts ? '<div class="message-timestamp">' + shellEscapeHtml(ts) + "</div>" : "";
    switch (entry.type) {
      case "thinking_level_change":
        return '<div class="model-change" id="' + id + '">' + tsHtml +
          'Thinking level: <span class="model-name">' + shellEscapeHtml(entry.thinkingLevel) + "</span></div>";
      case "session_info":
        return entry.name
          ? '<div class="model-change" id="' + id + '">' + tsHtml +
            'Session: <span class="model-name">' + shellEscapeHtml(entry.name) + "</span></div>"
          : "";
      default:
        return "";
    }
  }

  /**
   * After each navigation, scan for session entries that are on the rendered path but
   * were silently skipped by the core's renderEntry (it returns '' for several types).
   * Inject minimal DOM elements for them so they appear on the right-hand side.
   *
   * Strategy: find all entry-* elements currently in #messages, then walk parentId
   * chains to discover gaps — entries that sit between rendered ones in the session
   * tree but have no DOM element.
   */
  function injectUnrenderedEntries() {
    var messagesEl = document.getElementById("messages");
    if (!messagesEl) return;

    var sd = parseSessionData();
    if (!sd || !sd.entries) return;

    // Build id → entry map
    var byId = {};
    for (var i = 0; i < sd.entries.length; i++) byId[sd.entries[i].id] = sd.entries[i];

    // Collect rendered entry elements in DOM order
    var renderedEls = Array.prototype.slice.call(messagesEl.querySelectorAll("[id^='entry-']"));
    if (renderedEls.length === 0) return;

    var renderedIdList = renderedEls.map(function (el) { return el.id.replace(/^entry-/, ""); });
    var renderedIdSet = new Set(renderedIdList);

    function injectBefore(entry, referenceEl) {
      if (renderedIdSet.has(entry.id)) return;
      var html = renderUnrenderedEntry(entry);
      if (!html) { renderedIdSet.add(entry.id); return; } // mark as handled even if nothing to show
      var tmpl = document.createElement("template");
      tmpl.innerHTML = html.trim();
      var node = tmpl.content.firstElementChild;
      if (!node) return;
      if (referenceEl) messagesEl.insertBefore(node, referenceEl);
      else messagesEl.appendChild(node);
      renderedIdSet.add(entry.id);
    }

    // ── Ancestors of the first rendered entry (walk toward the root) ──────────
    var firstEntry = byId[renderedIdList[0]];
    if (firstEntry) {
      var ancestors = [];
      var cur = firstEntry;
      while (cur) {
        var pid = cur.parentId;
        if (!pid || pid === cur.id || !byId[pid] || renderedIdSet.has(pid)) break;
        ancestors.unshift(byId[pid]);
        cur = byId[pid];
      }
      for (var ai = 0; ai < ancestors.length; ai++) injectBefore(ancestors[ai], renderedEls[0]);
    }

    // ── Gaps between consecutive rendered entries ─────────────────────────────
    for (var ri = 0; ri < renderedIdList.length - 1; ri++) {
      var curId = renderedIdList[ri];
      var nextId = renderedIdList[ri + 1];
      var nextEl = renderedEls[ri + 1];
      // Walk up from nextId until we hit curId or a rendered entry
      var between = [];
      var cur2 = byId[nextId];
      while (cur2) {
        var pid2 = cur2.parentId;
        if (!pid2 || pid2 === cur2.id || pid2 === curId) break;
        if (!byId[pid2] || renderedIdSet.has(pid2)) break;
        between.unshift(byId[pid2]);
        cur2 = byId[pid2];
      }
      for (var bi = 0; bi < between.length; bi++) injectBefore(between[bi], nextEl);
    }
  }

  function patchToolExecutionIds() {
    var sessionData = parseSessionData();
    if (!sessionData || !sessionData.entries) return;

    var entries = sessionData.entries;
    // Build toolCallId -> toolResult entry id map
    var toolResultIdByCallId = {};
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.type === "message" && entry.message && entry.message.role === "toolResult" && entry.message.toolCallId) {
        toolResultIdByCallId[entry.message.toolCallId] = entry.id;
      }
    }

    // For each assistant message, find its toolCall blocks and match to .tool-execution elements
    var assistantEls = document.querySelectorAll("#messages .assistant-message");
    for (var a = 0; a < assistantEls.length; a++) {
      var assistantEl = assistantEls[a];
      var assistantId = (assistantEl.id || "").replace(/^entry-/, "");
      if (!assistantId) continue;

      // Find the assistant entry
      var assistantEntry = null;
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].id === assistantId) { assistantEntry = entries[j]; break; }
      }
      if (!assistantEntry || !assistantEntry.message || assistantEntry.message.role !== "assistant") continue;

      var content = Array.isArray(assistantEntry.message.content) ? assistantEntry.message.content : [];
      var toolCalls = [];
      for (var c = 0; c < content.length; c++) {
        if (content[c] && content[c].type === "toolCall") toolCalls.push(content[c]);
      }

      var toolEls = assistantEl.querySelectorAll(".tool-execution");
      for (var t = 0; t < toolCalls.length && t < toolEls.length; t++) {
        var resultId = toolResultIdByCallId[toolCalls[t].id];
        if (resultId && !toolEls[t].id) {
          toolEls[t].id = "entry-" + resultId;
        }
      }
    }

    // IDs are now patched — resolve any pending scroll from a tree click
    flushPendingScrollTarget();
  }

  // After patchToolExecutionIds assigns IDs, scroll to + highlight any pending toolResult tree click
  // (defined before observeAndPatchToolIds so it can be referenced in the debounce callback)
  function flushPendingScrollTarget() {
    if (!pendingScrollTarget) return;
    var targetId = pendingScrollTarget;
    pendingScrollTarget = null;
    var el = document.getElementById("entry-" + targetId);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("clicked-highlight-fade");
    el.classList.add("clicked-highlight");
    setTimeout(function () {
      el.classList.remove("clicked-highlight");
      el.classList.add("clicked-highlight-fade");
    }, 50);
    setTimeout(function () {
      el.classList.remove("clicked-highlight-fade");
    }, 800);
  }

  // Patch after every DOM change in #messages (covers navigateTo re-renders)
  function observeAndPatchToolIds() {
    var messages = document.getElementById("messages");
    if (!messages) return;
    var timer = null;
    var observer = new MutationObserver(function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        patchToolExecutionIds();
        injectUnrenderedEntries();
        injectAvailableSkillsPanel();
      }, 10);
    });
    observer.observe(messages, { childList: true, subtree: true });
    // Also run immediately on first load
    patchToolExecutionIds();
    injectUnrenderedEntries();
    injectAvailableSkillsPanel();
  }

  // Intercept tree-node clicks (capture phase, before core handler) to detect toolResult clicks
  function installToolResultTreeInterceptor() {
    document.addEventListener("click", function (event) {
      if (window.getSelection().toString()) return;
      var el = event.target;
      var container = document.getElementById("tree-container");
      if (!container) return;
      // Walk up to find the .tree-node ancestor
      while (el && el !== container) {
        if (el.classList && el.classList.contains("tree-node")) break;
        el = el.parentNode;
      }
      if (!el || el === container || !el.dataset || !el.dataset.id) return;
      var entryId = el.dataset.id;
      if (ensureToolResultIdSet().has(entryId)) {
        pendingScrollTarget = entryId;
      }
    }, true /* capture phase — runs before the core tree-node click handler */);
  }

  function installToolBlockFade() {
    var container = document.getElementById("messages");
    if (!container) return;
    container.addEventListener("click", function (event) {
      var el = event.target;
      while (el && el !== container) {
        if (el.classList && el.classList.contains("tool-execution")) {
          el.classList.remove("clicked-highlight-fade");
          el.classList.add("clicked-highlight");
          setTimeout(function () {
            el.classList.remove("clicked-highlight");
            el.classList.add("clicked-highlight-fade");
          }, 50);
          setTimeout(function () {
            el.classList.remove("clicked-highlight-fade");
          }, 800);
          break;
        }
        el = el.parentNode;
      }
    }, true);
  }

  function syncStatus(runtime) {
    var connection = document.getElementById("webui-connection");
    var streaming = document.getElementById("webui-streaming");
    if (connection) {
      var sessionLabel = runtime.sessionName || runtime.sessionFile || runtime.sessionId || "live session";
      connection.textContent = "connected - " + sessionLabel;
    }
    if (streaming) {
      streaming.textContent = runtime.isStreaming ? "streaming..." : "idle";
      streaming.style.color = runtime.isStreaming ? "var(--warning)" : "var(--success)";
    }
  }

  // --- Reload with state preservation ---

  function scheduleReload() {
    saveAllState();
    if (appState.reloadTimer) return;
    appState.reloadTimer = setTimeout(function () {
      appState.reloadTimer = null;
      window.location.reload();
    }, RELOAD_QUIET_MS);
  }

  function connectEvents() {
    if (appState.eventSource) appState.eventSource.close();
    var source = new EventSource(withToken("/__webui/events"));
    appState.eventSource = source;

    source.addEventListener("open", function () {
      var connection = document.getElementById("webui-connection");
      if (connection) connection.textContent = "connected";
    });

    source.addEventListener("snapshot", function (event) {
      var payload = JSON.parse(event.data);
      syncStatus(payload.runtime);
    });

    source.addEventListener("runtime", function (event) {
      var payload = JSON.parse(event.data);
      syncStatus(payload);
    });

    source.addEventListener("session", function () {
      scheduleReload();
    });

    source.addEventListener("agent", function (event) {
      try {
        var payload = JSON.parse(event.data || "{}");
        if (payload && payload.state === "end") scheduleReload();
      } catch (e) {}
    });

    source.onerror = function () {
      var connection = document.getElementById("webui-connection");
      if (connection) connection.textContent = "reconnecting...";
    };
  }

  function boot() {
    if (appState.initialized) return;
    appState.initialized = true;
    injectStyles();
    injectControlBar();
    injectCopyMarkdownButtons();
    installToolBlockFade();
    installToolResultTreeInterceptor();
    observeAndPatchToolIds();
    connectEvents();

    // Delay state restore so template.js init finishes first
    setTimeout(function () {
      restoreFilter();
      restoreSearch();
    }, 50);
    trackFilterChanges();
    trackSearchChanges();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { boot(); }, { once: true });
  } else {
    boot();
  }
})();
