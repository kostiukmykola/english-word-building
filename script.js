(() => {
  "use strict";

  const PARTS = {
    prefix: ["de", "in", "pre", "under", "dis", "inter", "re", "en", "mis", "trans", "fore", "over", "un"],
    root: ["act", "close", "heat", "open", "read", "turn", "believe", "cover", "light", "place", "see", "use", "change", "form", "lock", "play", "take", "wash", "charge", "grow", "move", "port", "time", "word"],
    suffix: ["en", "ing", "n", "able", "er", "less", "ness", "d", "es", "ly", "or", "ed", "ful", "ment", "s"]
  };

  const state = {
    selected: null,
    board: { prefix: null, root: null, suffix: null },
    history: [],
    score: 0,
    checking: false,
    lastResult: null
  };

  const $ = (id) => document.getElementById(id);
  const slots = [...document.querySelectorAll(".slot")];

  function renderTiles() {
    const configs = [
      ["prefix", "prefixTiles", "prefix-tile"],
      ["root", "rootTiles", "root-tile"],
      ["suffix", "suffixTiles", "suffix-tile"]
    ];
    configs.forEach(([type, target, className]) => {
      $(target).innerHTML = "";
      PARTS[type].forEach(part => {
        const tile = document.createElement("div");
        tile.className = `tile ${className}`;
        tile.textContent = part;
        tile.draggable = true;
        tile.dataset.type = type;
        tile.dataset.value = part;
        tile.tabIndex = 0;
        tile.setAttribute("role", "button");
        tile.setAttribute("aria-label", `${type}: ${part}`);
        tile.addEventListener("dragstart", e => {
          e.dataTransfer.setData("text/plain", JSON.stringify({ type, value: part }));
          e.dataTransfer.effectAllowed = "copy";
        });
        tile.addEventListener("click", () => placeTile(type, part));
        tile.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            placeTile(type, part);
          }
        });
        $(target).appendChild(tile);
      });
    });
  }


  function placeTile(type, value) {
    if (state.checking) return;

    // If the board is full, the previous attempt is complete.
    // The next tile always starts a fresh attempt, whatever the previous result.
    if (isBoardComplete()) {
      state.board = { prefix: null, root: null, suffix: null };
      state.lastResult = null;
    }

    if (state.board[type] === value) return;

    state.board[type] = value;
    state.lastResult = null;
    renderBoard();

    if (isBoardComplete()) {
      checkWord();
    } else {
      setFeedback("Tile placed. Add the remaining parts to complete the word.", "");
    }
  }

  function getNextCategory() {
    return ["prefix", "root", "suffix"].find(category => !state.board[category]) || "prefix";
  }

  function syncTileAccordions() {
    const boardComplete = isBoardComplete();
    document.querySelectorAll(".tile-group").forEach(group => {
      const category = group.dataset.group;
      // A full board opens every desktop accordion; otherwise only unfilled
      // categories stay expanded. On mobile all categories remain accessible
      // through their tabs, including categories that already have a tile.
      group.open = boardComplete || !state.board[category];
    });

    // On mobile, keep the tab for the next empty slot active, but do not hide
    // or disable any other category tab. Users can revisit a filled slot.
    if (window.matchMedia("(max-width: 900px)").matches) {
      activateTileCategory(getNextCategory());
    }
  }

  function renderBoard() {
    slots.forEach(slot => {
      const type = slot.dataset.slot;
      const value = state.board[type];
      slot.classList.remove("valid", "invalid");
      slot.innerHTML = "";
      if (!value) {
        const placeholder = document.createElement("span");
        placeholder.className = "placeholder";
        placeholder.textContent = `Drop ${type}`;
        slot.appendChild(placeholder);
      } else {
        const tile = document.createElement("span");
        tile.className = `tile ${type}-tile`;
        tile.textContent = value;
        tile.title = "Tap to remove";
        tile.addEventListener("click", () => {
          state.board[type] = null;
          state.lastResult = null;
          renderBoard();
          updatePreview();
        });
        slot.appendChild(tile);
      }
    });
    updatePreview();
    syncTileAccordions();
  }

  function isBoardComplete() {
    return Object.values(state.board).every(Boolean);
  }

  function buildWord() {
    const { prefix, root, suffix } = state.board;
    if (!prefix || !root || !suffix) return "";
    return applySpellingRules(prefix, root, suffix).toLowerCase();
  }

  // A few common English suffix spelling rules before dictionary lookup.
  function applySpellingRules(prefix, root, suffix) {
    let stem = root;
    const vowelSuffix = /^[aeiou]/i.test(suffix);
    if (vowelSuffix && /e$/i.test(stem) && !/(ee|ye|oe)$/i.test(stem)) stem = stem.slice(0, -1);
    if (/y$/i.test(stem) && /^[a-z]+$/i.test(suffix) && !/^(ing|s)$/i.test(suffix)) {
      stem = stem.slice(0, -1) + "i";
    }
    // Preserve the e in roots where it is normally retained before -ing.
    if (suffix === "ing" && /^(see|agree|free)$/i.test(root)) stem = root;
    return prefix + stem + suffix;
  }

  function updatePreview() {
    $("wordPreview").textContent = buildWord() || "—";
  }

  function setFeedback(message, kind) {
    const el = $("feedback");
    el.textContent = message;
    el.className = `feedback ${kind || ""}`;
  }

  const dictionaryCache = new Map();

  const wait = (ms) => new Promise(resolve => window.setTimeout(resolve, ms));

  async function lookupWord(word) {
    if (dictionaryCache.has(word)) return dictionaryCache.get(word);

    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    let lastError;

    // The public dictionary endpoint can occasionally return 502/503 or transient
    // network errors. Retry those, but do not retry a genuine 404 (not a word).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 10000);
        let response;
        try {
          response = await fetch(url, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: controller.signal,
            cache: "no-store"
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        if (response.status === 404) {
          dictionaryCache.set(word, false);
          return false;
        }

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Dictionary service returned ${response.status}`);
          if (attempt < 2) {
            await wait(500 * (2 ** attempt));
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          throw new Error(`Dictionary service returned ${response.status}`);
        }

        const data = await response.json();
        const found = Array.isArray(data) && data.length > 0 &&
          data.some(entry => entry && entry.word);
        dictionaryCache.set(word, found);
        return found;
      } catch (error) {
        lastError = error;
        // Abort, fetch/network and transient server errors get another attempt.
        if (attempt < 2) {
          await wait(500 * (2 ** attempt));
          continue;
        }
      }
    }

    throw lastError || new Error("Dictionary service is unavailable");
  }

  async function checkWord() {
    if (!isBoardComplete() || state.checking) return;
    const word = buildWord();

    // Any word already present in the session history cannot be repeated,
    // regardless of whether its previous attempt was correct or incorrect.
    if (state.history.some(item => item.word.toLowerCase() === word.toLowerCase())) {
      markBoard("invalid");
      setFeedback(`“${word}” has already appeared in your history. Try a different word.`, "error");
      return;
    }

    state.checking = true;
    setFeedback(`Checking “${word}” in the English dictionary…`, "loading");

    try {
      const found = await lookupWord(word);
      if (!found) {
        state.history.unshift({ word, points: -2, result: "incorrect", time: new Date() });
        state.score -= 2;
        markBoard("invalid");
        renderStats();
        renderHistory();
        setFeedback(`Not quite! “${word}” was not found. −2 points.`, "error");
        return;
      }

      state.history.unshift({ word, points: 10, result: "correct", time: new Date() });
      state.score += 10;
      markBoard("valid");
      renderStats();
      renderHistory();
      setFeedback(`Correct! “${word}” is a valid English word. +10 points. Choose any tile to start the next word.`, "success");
    } catch (error) {
      console.error("Dictionary lookup failed:", error);
      // API/network failures are not wrong answers and never affect score/history.
      setFeedback("The dictionary service is temporarily unavailable. No points were changed. Please try again.", "error");
    } finally {
      state.checking = false;
    }
  }

  function markBoard(result) {
    slots.forEach(slot => slot.classList.add(result));
  }

  function renderStats() {
    const scoreElement = $("score");
    scoreElement.textContent = state.score;
    scoreElement.classList.toggle("negative", state.score < 0);
    $("wordsFound").textContent = state.history.filter(item => item.result === "correct").length;
    $("historyCount").textContent = state.history.length;
  }

  function renderHistory() {
    const list = $("historyList");
    if (!state.history.length) {
      list.innerHTML = `<div class="empty-state"><span class="empty-icon">Aa</span><strong>No words yet</strong><p>Words you build successfully will appear here.</p></div>`;
      return;
    }
    list.innerHTML = "";
    state.history.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = `history-item ${item.result === "correct" ? "history-correct" : "history-incorrect"}`;
      const word = document.createElement("span");
      word.className = "history-word";
      word.textContent = item.word;
      const meta = document.createElement("span");
      meta.className = "history-meta";
      meta.textContent = `${item.result === "correct" ? "Correct" : "Incorrect"} · ${item.points > 0 ? "+" : ""}${item.points} pts · #${state.history.length - index}`;
      row.append(word, meta);
      list.appendChild(row);
    });
  }

  function clearBoard() {
    state.board = { prefix: null, root: null, suffix: null };
    state.selected = null;
    state.lastResult = null;
    document.querySelectorAll(".tile.selected").forEach(t => t.classList.remove("selected"));
    renderBoard();
    setFeedback("Board cleared. Build another word!", "");
  }

  function newSession() {
    if ((state.history.length || state.score) && !window.confirm("Start a new session? Your current word history and score will be cleared.")) return;
    state.score = 0;
    state.history = [];
    clearBoard();
    renderStats();
    renderHistory();
    setFeedback("New session started. Good luck!", "");
    showToast("New session started");
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.setTimeout(() => toast.classList.remove("show"), 1800);
  }

  slots.forEach(slot => {
    slot.addEventListener("dragover", e => {
      e.preventDefault();
      slot.classList.add("drag-over");
    });
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", e => {
      e.preventDefault();
      slot.classList.remove("drag-over");
      try {
        const item = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (item.type === slot.dataset.slot) placeTile(item.type, item.value);
        else setFeedback(`That is a ${item.type}; drop it in the ${item.type} slot.`, "error");
      } catch (_) {}
    });
    slot.addEventListener("click", () => {
      if (state.selected && state.selected.type === slot.dataset.slot) {
        placeTile(state.selected.type, state.selected.value);
        document.querySelectorAll(".tile.selected").forEach(t => t.classList.remove("selected"));
        state.selected = null;
      } else if (state.selected) {
        setFeedback(`Choose the ${state.selected.type} slot for “${state.selected.value}”.`, "error");
      }
    });
    slot.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); slot.click(); }
    });
  });

  $("clearBoardBtn").addEventListener("click", clearBoard);
  $("newSessionBtn").addEventListener("click", newSession);

  // Mobile tile tray category tabs.
  const tileTabs = [...document.querySelectorAll(".tile-tab")];
  const tileGroups = [...document.querySelectorAll(".tile-group")];
  function activateTileCategory(category) {
    tileTabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tab === category));
    tileGroups.forEach(group => {
      const isSelected = group.dataset.group === category;
      group.classList.toggle("active", isSelected);
      // Native <details> accordions are only interactive on desktop.
      if (window.matchMedia("(min-width: 901px)").matches && isSelected) {
        group.open = true;
      }
    });
  }
  tileTabs.forEach(tab => {
    tab.addEventListener("click", () => activateTileCategory(tab.dataset.tab));
  });
  activateTileCategory(getNextCategory());

  const boardPanel = document.querySelector(".board-panel");
  const tilesSection = document.querySelector(".tiles-section");

  function syncDesktopPanelHeight() {
    if (!boardPanel || !tilesSection) return;
    if (window.matchMedia("(min-width: 901px)").matches) {
      const height = boardPanel.getBoundingClientRect().height;
      tilesSection.style.setProperty("--board-panel-height", `${height}px`);
    } else {
      tilesSection.style.removeProperty("--board-panel-height");
    }
  }

  if ("ResizeObserver" in window && boardPanel) {
    const boardResizeObserver = new ResizeObserver(syncDesktopPanelHeight);
    boardResizeObserver.observe(boardPanel);
  }
  window.addEventListener("resize", syncDesktopPanelHeight);
  syncDesktopPanelHeight();

  renderTiles();
  renderBoard();
  renderStats();
  renderHistory();
})();