/* Flip 7 user interface: screens, rendering, animations and the game loop. */
(function (root) {
  "use strict";
  const E = root.Flip7Engine;
  const AI = root.Flip7AI;
  const SFX = root.Flip7Audio;
  const FX = root.Flip7FX;

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // ---------- Constants ----------
  const PLAYER_COLORS = ["#ff3d7f", "#3de0ff", "#9cf04a", "#ffc93c", "#a78bfa", "#ff9f1c", "#2ee6a8", "#ff6b6b"];
  const NUMBER_COLORS = {
    0: ["#8d99ae", "#3d4656"],
    1: ["#9b7bff", "#3f2591"],
    2: ["#14c8b8", "#06574f"],
    3: ["#ff3b4f", "#7d0011"],
    4: ["#ff9f1c", "#8a4200"],
    5: ["#3a86ff", "#0b3a8a"],
    6: ["#7ccd1f", "#2f5c00"],
    7: ["#ffb800", "#8a3d00"],
    8: ["#ff5b14", "#7a1f00"],
    9: ["#b14ce6", "#4e0f73"],
    10: ["#1fa2e0", "#064a70"],
    11: ["#e5175b", "#6b0026"],
    12: ["#10c97a", "#04593a"],
  };
  const AI_NAMES = ["Robin", "Ada", "Nova", "Pixel", "Turing", "Zoé", "Hal", "Lulu", "Max", "Iris"];
  const LEVEL_ORDER = ["easy", "normal", "hard", "expert"];
  const ACTION_LABEL = { freeze: "Stop", flip3: "Trois à la suite", second: "Seconde Chance" };
  const STATUS_LABEL = { stayed: "Stop", busted: "Sauté", frozen: "Stoppé", flip7: "Flip 7" };
  const MOD_KEYS = ["+2", "+4", "+6", "+8", "+10", "x2"];

  const DEFAULT_SETTINGS = {
    sound: true,
    vibrate: true,
    showOdds: true,
    showHint: false,
    handoff: false,
    autoNext: false,
    speed: 1,
    aiDelay: 800,
    theme: "night",
  };
  function officialRules() {
    return {
      targetScore: 200,
      flip7Count: 7,
      flip7Bonus: 15,
      flip3Draws: 3,
      actions: { freeze: 3, flip3: 3, second: 3 },
      modifiers: { "+2": 1, "+4": 1, "+6": 1, "+8": 1, "+10": 1, x2: 1 },
      reshuffleEachRound: false,
      tieExtra: true,
      initialDeal: false,
    };
  }
  function defaultSetup() {
    return {
      players: [
        { name: "Toi", type: "human", color: PLAYER_COLORS[0] },
        { name: "Robin", type: "ai", level: "normal", color: PLAYER_COLORS[1] },
        { name: "Ada", type: "ai", level: "hard", color: PLAYER_COLORS[2] },
      ],
      rules: officialRules(),
    };
  }

  // ---------- Storage (best effort) ----------
  function load(key, fallback) {
    try {
      const raw = root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function store(key, value) {
    try {
      if (value === null) root.localStorage.removeItem(key);
      else root.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable */
    }
  }

  const settings = Object.assign({}, DEFAULT_SETTINGS, load("flip7.settings", {}));
  let setup = load("flip7.setup", null) || defaultSetup();
  setup.rules = Object.assign(officialRules(), setup.rules || {});

  // ---------- Small helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms / settings.speed));
  }
  function vibrate(pattern) {
    if (settings.vibrate && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        /* ignore */
      }
    }
  }
  function sound(name, arg) {
    SFX.play(name, arg);
  }
  let toastTimer = null;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function icon(id) {
    return '<svg><use href="#i-' + id + '"/></svg>';
  }
  function initial(name) {
    return esc((String(name).trim()[0] || "?").toUpperCase());
  }
  function avatarHTML(p) {
    return '<span class="avatar" style="--pc:' + p.color + '">' + initial(p.name) + "</span>";
  }

  // Card faces come from the official artwork (img/cards/*.webp).
  function artName(card) {
    if (card.kind === "number") return "n" + card.value;
    if (card.kind === "mod") return card.op === "mul" ? "x2" : "p" + card.value;
    return { freeze: "stop", flip3: "flip3", second: "second" }[card.value];
  }
  function cardLabel(card) {
    if (card.kind === "number") return String(card.value);
    if (card.kind === "mod") return card.op === "mul" ? "Bonus ×2" : "Bonus +" + card.value;
    return ACTION_LABEL[card.value];
  }
  function cardHTML(card, opts) {
    const o = opts || {};
    const cls = ["card", "art", card.kind];
    if (o.mini) cls.push("mini");
    if (card.kind === "number") cls.push("v" + card.value);
    else if (card.kind === "action") cls.push(card.value);
    return (
      '<div class="' + cls.join(" ") + '" data-cid="' + card.id + '"' + (card.kind === "number" ? ' data-v="' + card.value + '"' : "") +
      (o.style ? ' style="' + o.style + '"' : "") + ' role="img" aria-label="' + esc(cardLabel(card)) + '">' +
      '<img src="img/cards/' + artName(card) + '.webp" alt="" draggable="false"></div>'
    );
  }
  function preloadArt() {
    const names = ["stop", "flip3", "second", "x2", "p2", "p4", "p6", "p8", "p10"];
    for (let n = 0; n <= 12; n++) names.push("n" + n);
    names.forEach((n) => {
      const img = new Image();
      img.src = "img/cards/" + n + ".webp";
    });
  }
  function backHTML(style) {
    return '<div class="card back"' + (style ? ' style="' + style + '"' : "") + '><div class="back-art"></div></div>';
  }

  // ---------- Navigation ----------
  const navStack = [];
  let currentScreen = "home";
  function show(name, push) {
    if (push !== false && currentScreen !== name) navStack.push(currentScreen);
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $("#screen-" + name).classList.add("active");
    currentScreen = name;
    if (name === "home") refreshHome();
    if (name === "setup") renderSetup();
    if (name === "settings") renderSettings();
    if (name === "game") {
      paused = false;
      renderGame();
      resumeWaiters();
    } else if (game) {
      paused = true;
    }
  }
  function back() {
    const prev = navStack.pop() || "home";
    show(prev, false);
  }
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (!nav) return;
    SFX.unlock();
    sound("tap");
    const target = nav.getAttribute("data-nav");
    if (target === "back") back();
    else show(target);
  });
  document.addEventListener("pointerdown", () => SFX.unlock(), { once: true });

  function refreshHome() {
    const saved = load("flip7.save", null);
    $("#btn-continue").hidden = !(saved && saved.phase !== "gameOver");
  }
  $("#btn-continue").addEventListener("click", () => {
    const saved = load("flip7.save", null);
    if (!saved) return;
    sound("tap");
    startLoop(saved);
  });

  // ---------- Settings screen ----------
  function applySettings() {
    document.documentElement.style.setProperty("--speed", settings.speed);
    document.body.className = "theme-" + settings.theme;
    SFX.setEnabled(settings.sound);
    store("flip7.settings", settings);
  }
  function renderSettings() {
    $$("[data-setting]").forEach((el) => {
      const key = el.getAttribute("data-setting");
      if (el.classList.contains("segmented")) {
        $$("button", el).forEach((b) => b.classList.toggle("on", String(settings[key]) === b.getAttribute("data-value")));
      } else {
        el.checked = !!settings[key];
      }
    });
  }
  $$("[data-setting]").forEach((el) => {
    const key = el.getAttribute("data-setting");
    if (el.classList.contains("segmented")) {
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const v = b.getAttribute("data-value");
        settings[key] = isNaN(Number(v)) ? v : Number(v);
        sound("tap");
        applySettings();
        renderSettings();
      });
    } else {
      el.addEventListener("change", () => {
        settings[key] = el.checked;
        applySettings();
        if (key === "sound" && el.checked) sound("tap");
        if (game) renderGame();
      });
    }
  });

  // ---------- Setup screen ----------
  function saveSetup() {
    store("flip7.setup", setup);
  }
  function getKey(obj, path) {
    return path.split(".").reduce((o, k) => o[k], obj);
  }
  function setKey(obj, path, v) {
    const parts = path.split(".");
    const last = parts.pop();
    parts.reduce((o, k) => o[k], obj)[last] = v;
  }
  function nextColor() {
    const used = setup.players.map((p) => p.color);
    return PLAYER_COLORS.find((c) => used.indexOf(c) < 0) || PLAYER_COLORS[setup.players.length % PLAYER_COLORS.length];
  }
  function renderSetup() {
    const list = $("#player-list");
    list.innerHTML = setup.players
      .map((p, i) => {
        const kind =
          '<button class="pill' + (p.type === "human" ? " on" : "") + '" data-act="type" data-i="' + i + '">' +
          icon(p.type === "human" ? "user" : "robot") + (p.type === "human" ? "Humain" : "IA") + "</button>" +
          (p.type === "ai"
            ? '<button class="pill level" data-act="level" data-i="' + i + '">' + AI.LEVELS[p.level || "normal"].label + "</button>"
            : "");
        return (
          '<div class="player-row">' +
          '<button class="avatar" style="--pc:' + p.color + '" data-act="color" data-i="' + i + '">' + initial(p.name) + "</button>" +
          '<input class="name-input" maxlength="14" data-i="' + i + '" value="' + esc(p.name) + '" aria-label="Nom du joueur ' + (i + 1) + '"/>' +
          '<div class="kind">' + kind + "</div>" +
          '<button class="remove" data-act="remove" data-i="' + i + '" aria-label="Retirer"' + (setup.players.length <= 2 ? " disabled" : "") + ">" +
          icon("x") + "</button></div>"
        );
      })
      .join("");
    const humans = setup.players.filter((p) => p.type === "human").length;
    $("#player-count").textContent =
      setup.players.length + " joueurs · " + humans + " humain" + (humans > 1 ? "s" : "") + " · " + (setup.players.length - humans) + " IA";
    $("#add-human").disabled = $("#add-ai").disabled = setup.players.length >= 8;

    $$(".stepper").forEach((st) => {
      const key = st.getAttribute("data-key");
      st.innerHTML = '<button data-d="-1" aria-label="Moins">−</button><output>' + getKey(setup.rules, key) + '</output><button data-d="1" aria-label="Plus">+</button>';
    });
    $("#mod-chips").innerHTML = MOD_KEYS.map(
      (k) => '<button class="chip' + (setup.rules.modifiers[k] ? " on" : "") + '" data-mod="' + k + '">' + (k === "x2" ? "×2" : k) + "</button>"
    ).join("");
    $("#opt-reshuffle").checked = !!setup.rules.reshuffleEachRound;
    $("#opt-tie").checked = !!setup.rules.tieExtra;
    $("#opt-deal").checked = !!setup.rules.initialDeal;
    const r = setup.rules;
    const mods = MOD_KEYS.reduce((n, k) => n + (r.modifiers[k] | 0), 0);
    const acts = r.actions.freeze + r.actions.flip3 + r.actions.second;
    $("#deck-summary").textContent = "Paquet : " + (79 + mods + acts) + " cartes (79 Numéro, " + mods + " Bonus, " + acts + " Spéciales).";
  }
  $("#player-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const i = Number(b.getAttribute("data-i"));
    const p = setup.players[i];
    const act = b.getAttribute("data-act");
    sound("tap");
    if (act === "type") {
      p.type = p.type === "human" ? "ai" : "human";
      if (p.type === "ai" && !p.level) p.level = "normal";
    } else if (act === "level") {
      p.level = LEVEL_ORDER[(LEVEL_ORDER.indexOf(p.level || "normal") + 1) % LEVEL_ORDER.length];
      toast(AI.LEVELS[p.level].label + " : " + levelHelp(p.level));
    } else if (act === "color") {
      p.color = PLAYER_COLORS[(PLAYER_COLORS.indexOf(p.color) + 1) % PLAYER_COLORS.length];
    } else if (act === "remove" && setup.players.length > 2) {
      setup.players.splice(i, 1);
    }
    saveSetup();
    renderSetup();
  });
  function levelHelp(level) {
    return {
      easy: "s'arrête un peu au hasard",
      normal: "évite les gros risques",
      hard: "compte les cartes",
      expert: "compte les cartes et anticipe",
    }[level];
  }
  $("#player-list").addEventListener("input", (e) => {
    const i = Number(e.target.getAttribute("data-i"));
    setup.players[i].name = e.target.value;
    const av = e.target.parentElement.querySelector(".avatar");
    if (av) av.innerHTML = initial(e.target.value || "?");
    saveSetup();
  });
  function addPlayer(type) {
    if (setup.players.length >= 8) return;
    sound("tap");
    const usedNames = setup.players.map((p) => p.name);
    const name =
      type === "ai"
        ? AI_NAMES.find((n) => usedNames.indexOf(n) < 0) || "IA " + (setup.players.length + 1)
        : "Joueur " + (setup.players.filter((p) => p.type === "human").length + 1);
    setup.players.push({ name: name, type: type, level: "normal", color: nextColor() });
    saveSetup();
    renderSetup();
  }
  $("#add-human").addEventListener("click", () => addPlayer("human"));
  $("#add-ai").addEventListener("click", () => addPlayer("ai"));
  $("#screen-setup").addEventListener("click", (e) => {
    const b = e.target.closest(".stepper button");
    if (b) {
      const st = b.parentElement;
      const key = st.getAttribute("data-key");
      const min = Number(st.getAttribute("data-min"));
      const max = Number(st.getAttribute("data-max"));
      const step = Number(st.getAttribute("data-step"));
      const v = Math.min(max, Math.max(min, getKey(setup.rules, key) + step * Number(b.getAttribute("data-d"))));
      setKey(setup.rules, key, v);
      sound("tap");
      saveSetup();
      renderSetup();
      return;
    }
    const chip = e.target.closest("[data-mod]");
    if (chip) {
      const k = chip.getAttribute("data-mod");
      setup.rules.modifiers[k] = setup.rules.modifiers[k] ? 0 : 1;
      sound("tap");
      saveSetup();
      renderSetup();
    }
  });
  $("#opt-reshuffle").addEventListener("change", (e) => {
    setup.rules.reshuffleEachRound = e.target.checked;
    saveSetup();
  });
  $("#opt-tie").addEventListener("change", (e) => {
    setup.rules.tieExtra = e.target.checked;
    saveSetup();
  });
  $("#opt-deal").addEventListener("change", (e) => {
    setup.rules.initialDeal = e.target.checked;
    saveSetup();
  });
  $("#reset-rules").addEventListener("click", () => {
    setup.rules = officialRules();
    sound("tap");
    saveSetup();
    renderSetup();
    toast("Règles officielles rétablies");
  });
  $("#start-game").addEventListener("click", () => {
    SFX.unlock();
    sound("stay");
    newGameFromSetup();
  });

  function newGameFromSetup() {
    setup.players.forEach((p, i) => {
      if (!String(p.name).trim()) p.name = p.type === "ai" ? AI_NAMES[i % AI_NAMES.length] : "Joueur " + (i + 1);
    });
    saveSetup();
    const r = setup.rules;
    const config = {
      players: setup.players.map((p) => ({ name: String(p.name).trim(), type: p.type, level: p.level, color: p.color })),
      targetScore: r.targetScore,
      flip7Count: r.flip7Count,
      flip7Bonus: r.flip7Bonus,
      flip3Draws: r.flip3Draws,
      actions: Object.assign({}, r.actions),
      modifiers: Object.assign({}, r.modifiers),
      reshuffleEachRound: r.reshuffleEachRound,
      tieRule: r.tieExtra ? "extra" : "shared",
      initialDeal: !!r.initialDeal,
    };
    startLoop(E.createGame(config));
  }

  // ---------- Game state & rendering ----------
  let game = null;
  let focusIndex = 0;
  let paused = false;
  let runToken = 0;
  let decisionResolver = null;
  let lastHumanTurn = -1;
  const pauseWaiters = [];

  function waitUnpaused() {
    if (!paused) return Promise.resolve();
    return new Promise((r) => pauseWaiters.push(r));
  }
  function resumeWaiters() {
    while (pauseWaiters.length) pauseWaiters.shift()();
  }

  function humansCount() {
    return game.players.filter((p) => p.type === "human").length;
  }

  function renderGame(opts) {
    if (!game) return;
    const o = opts || {};
    const hide = o.hide || new Set();
    const statusOf = (p) => (o.status && o.status[p.index] !== undefined ? o.status[p.index] : p.round.status);
    $("#round-label").textContent = "Manche " + Math.max(1, game.roundNumber);
    $("#target-label").textContent = "Objectif " + game.config.targetScore;
    $("#deck-count").textContent = game.deck.length;
    $("#discard-count").textContent = game.discard.length;
    renderDiscard();

    const currentIdx = game.pending ? game.pending.player : -1;
    $("#seats").innerHTML = game.players
      .map((p) => {
        const st = statusOf(p);
        const cards = p.round.numbers.concat(p.round.mods, p.round.second ? [p.round.second] : []);
        const mini = cards
          .map((c) => cardHTML(c, { mini: true, style: hide.has(c.id) ? "visibility:hidden" : "" }))
          .join("");
        const score = st === "busted" ? 0 : E.roundScore(game, p);
        const cls = ["seat"];
        if (p.index === currentIdx) cls.push("current");
        if (p.index === game.dealer) cls.push("dealer");
        if (st !== "active") cls.push("out", st);
        const tag = st !== "active" ? '<span class="status-tag tag-' + st + '">' + STATUS_LABEL[st] + "</span>" : "";
        return (
          '<div class="' + cls.join(" ") + '" data-seat="' + p.index + '">' + avatarHTML(p) +
          '<div class="s-name">' + (p.type === "ai" ? icon("robot") : "") + "<span>" + esc(p.name) + "</span>" + tag + "</div>" +
          '<div class="s-total">' + p.total + "</div>" +
          '<div class="s-cards' + (cards.length > 5 ? " many" : "") + '">' + mini + '<span class="s-round">' + (game.phase === "playing" ? "+" + score : "") + "</span></div></div>"
        );
      })
      .join("");

    renderFocus(hide, statusOf);
    renderControls();
  }

  function renderDiscard() {
    const pile = $("#discard-pile");
    $$(".card", pile).forEach((c) => c.remove());
    const top = game.discard.slice(-2);
    top.forEach((c, i) => {
      const rot = ((c.id * 37) % 21) - 10;
      pile.insertAdjacentHTML("beforeend", cardHTML(c, { style: "--rot:" + rot + "deg;z-index:" + (i + 1) }));
    });
  }

  function renderFocus(hide, statusOf) {
    const p = game.players[focusIndex];
    const el = $("#focus");
    if (!p) {
      el.innerHTML = "";
      return;
    }
    const st = statusOf(p);
    const r = p.round;
    const score = st === "busted" ? 0 : E.roundScore(game, p);
    const nums = r.numbers.map((c) => cardHTML(c, { style: hide.has(c.id) ? "visibility:hidden" : "" })).join("");
    const extras = r.mods.concat(r.second ? [r.second] : []);
    const extraHTML = extras.map((c) => cardHTML(c, { style: hide.has(c.id) ? "visibility:hidden" : "" })).join("");
    const unique = r.numbers.length - (st === "busted" ? 1 : 0);
    let pips = "";
    for (let i = 0; i < game.config.flip7Count; i++) pips += "<i" + (i < unique ? ' class="on"' : "") + "></i>";
    const tag = st !== "active" ? ' <span class="status-tag tag-' + st + '" style="position:static">' + STATUS_LABEL[st] + "</span>" : "";
    let meter = "";
    if (st === "active" && game.phase === "playing" && r.numbers.length && settings.showOdds) {
      const pb = E.bustProbability(game, p.index);
      const pct = Math.round(pb * 100);
      let hint = "";
      if (settings.showHint && p.type === "human" && game.pending && game.pending.type === "turn" && game.pending.player === p.index) {
        hint = ' · conseil : <span class="hint">' + (hintFor(p.index).hit ? "encore" : "stop") + "</span>";
      }
      meter =
        '<div class="meter"><span>Risque de doublon</span><span class="bar"><b style="width:' + Math.max(3, pct) +
        "%;background-position:" + pct + '% 0"></b></span><span class="hint">' + (r.second ? "protégé" : pct + " %") + "</span>" + hint + "</div>";
    }
    el.className = "focus" + (p.type === "human" && game.pending && game.pending.player === p.index ? " mine" : "") + (st === "frozen" ? " frozen" : "");
    el.style.setProperty("--pc", p.color);
    el.innerHTML =
      '<div class="f-head">' + avatarHTML(p) +
      '<div style="min-width:0"><div class="f-name">' + esc(p.name) + tag + "</div>" +
      '<div class="f-sub">' + (p.type === "ai" ? "IA · " + AI.LEVELS[p.level].label : "Humain") + (p.index === game.dealer ? " · donneur" : "") + "</div></div>" +
      '<div class="f-score"><div class="f-round">' + score + '</div><div class="f-total">total ' + p.total + " → " + (p.total + score) + "</div></div></div>" +
      '<div class="f-cards">' + nums + (extras.length ? '<span class="sep-mods"></span>' + extraHTML : "") + "</div>" +
      '<div class="f-progress">' + pips + "</div>" + meter;
  }

  function hintFor(playerIndex) {
    const clone = JSON.parse(JSON.stringify(game));
    clone.players[playerIndex].level = "expert";
    return AI.decide(clone) || {};
  }

  function renderControls() {
    const c = $("#controls");
    const myTurn = game.pending && game.pending.type === "turn" && game.players[game.pending.player].type === "human" && game.phase === "playing";
    c.classList.toggle("waiting", !myTurn);
    $("#deck-pile").classList.toggle("pulse", !!myTurn);
    const p = myTurn ? game.players[game.pending.player] : null;
    $("#btn-stay").disabled = !myTurn;
    $("#btn-hit").disabled = !myTurn;
    if (p) $("#btn-stay span").textContent = "Stop (" + E.roundScore(game, p) + ")";
    else $("#btn-stay span").textContent = "Stop";
  }

  function setBanner(html, cls) {
    const b = $("#banner");
    b.innerHTML = '<div class="b-in ' + (cls || "") + '">' + html + "</div>";
  }

  // ---------- Animations ----------
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function cardSizePx() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) || 64;
  }
  function centerRect(scale) {
    const w = cardSizePx() * (scale || 1.8);
    const h = w * 1.4;
    return { x: root.innerWidth / 2 - w / 2, y: root.innerHeight * 0.42 - h / 2, w: w, h: h };
  }

  function fly(card, from, to, opts) {
    const o = opts || {};
    const layer = $("#flyer-layer");
    const el = document.createElement("div");
    el.className = "flyer";
    el.style.width = to.w + "px";
    el.style.height = to.h + "px";
    const style = "--w:" + to.w + "px;width:" + to.w + "px;height:" + to.h + "px";
    el.innerHTML = '<div class="rear">' + backHTML(style) + '</div><div class="face">' + cardHTML(card, { style: style }) + "</div>";
    layer.appendChild(el);
    const s0 = from.w / to.w;
    const startRot = o.faceUp ? 180 : 0;
    const midX = (from.x + to.x) / 2;
    const midY = Math.min(from.y, to.y) - 40;
    const dur = (o.duration || 520) / settings.speed;
    const anim = el.animate(
      [
        { transform: "translate(" + from.x + "px," + from.y + "px) scale(" + s0 + ") rotateY(" + startRot + "deg)" },
        { transform: "translate(" + midX + "px," + midY + "px) scale(" + (o.faceUp ? 1.05 : 1.25) + ") rotateY(" + (o.faceUp ? 180 : 100) + "deg) rotateZ(-6deg)", offset: 0.5 },
        { transform: "translate(" + to.x + "px," + to.y + "px) scale(1) rotateY(180deg)" },
      ],
      { duration: dur, easing: "cubic-bezier(.25,.8,.25,1)", fill: "forwards" }
    );
    return new Promise((resolve) => {
      anim.onfinish = () => {
        if (!o.keep) el.remove();
        resolve(el);
      };
    });
  }

  function splash(main, sub, cls, duration) {
    $("#banner").innerHTML = "";
    const el = document.createElement("div");
    el.className = "splash " + (cls || "");
    el.innerHTML = '<span class="s-main">' + main + "</span>" + (sub ? '<span class="s-sub">' + sub + "</span>" : "");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), (duration || 1500) / settings.speed);
  }
  function flash(color) {
    const el = document.createElement("div");
    el.className = "flash";
    el.style.background = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700 / settings.speed);
  }
  function shake(el) {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }
  function cardEls(id) {
    return $$('[data-cid="' + id + '"]');
  }
  function targetElFor(card, playerIndex) {
    const inFocus = playerIndex === focusIndex ? $('#focus [data-cid="' + card.id + '"]') : null;
    return inFocus || $('#seats [data-seat="' + playerIndex + '"] [data-cid="' + card.id + '"]');
  }
  function seatEl(i) {
    return $('#seats [data-seat="' + i + '"]');
  }
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  function playerName(i) {
    return esc(game.players[i].name);
  }

  async function animateDraw(ev, before) {
    const card = ev.card;
    if (ev.src !== "deal") focusIndex = ev.player;
    renderGame({ hide: new Set([card.id]), status: before });
    const deck = $("#deck-pile .stack.s1");
    const from = rectOf(deck);
    const targetEl = targetElFor(card, ev.player);
    sound("flip");
    if (targetEl) {
      await fly(card, from, rectOf(targetEl), { duration: ev.src === "deal" ? 420 : 560 });
      cardEls(card.id).forEach((c) => (c.style.visibility = ""));
      sound("land", card.kind === "number" ? card.value : 6);
      if (card.kind === "mod") {
        const [x, y] = centerOf(targetEl);
        FX.burst(x, y, ["#c6ff7a", "#ffe27a", "#fff"], 18, { speed: 6 });
        sound("modifier");
      }
    } else {
      // The card does not stay in front of the player (action to play, saved duplicate…).
      const to = centerRect(1.8);
      const flyer = await fly(card, from, to, { duration: 600, keep: true });
      await wait(card.kind === "action" ? 650 : 450);
      const stillLimbo = game.discard.every((c) => c.id !== card.id);
      if (stillLimbo) {
        flyer.animate([{ opacity: 1 }, { opacity: 0, transform: flyer.style.transform }], { duration: 200 / settings.speed });
        await wait(180);
        flyer.remove();
      } else {
        flyer.remove();
        await fly(card, to, rectOf($("#discard-pile .pile-empty")), { faceUp: true, duration: 420 });
      }
    }
    renderGame({ status: before });
    await wait(ev.src === "deal" ? 120 : 220);
  }

  async function playEvents(events, before) {
    for (const ev of events) {
      if (!game) return;
      switch (ev.type) {
        case "roundStart":
          focusIndex = (ev.dealer + 1) % game.players.length;
          renderGame();
          setBanner("Manche " + ev.round + "<small>" + playerName(ev.dealer) + " distribue</small>");
          sound("shuffle");
          await wait(900);
          break;
        case "reshuffle":
          sound("shuffle");
          toast("La défausse est remélangée pour former une nouvelle pioche");
          renderGame({ status: before });
          await wait(500);
          break;
        case "turn": {
          focusIndex = ev.player;
          const p = game.players[ev.player];
          if (p.type === "human" && settings.handoff && humansCount() > 1 && lastHumanTurn !== ev.player && lastHumanTurn !== -1) {
            renderGame();
            await handoff(p);
          }
          if (p.type === "human") lastHumanTurn = ev.player;
          renderGame();
          setBanner(p.type === "human" ? "À toi, " + esc(p.name) + "&nbsp;!" : '<span class="thinking">' + esc(p.name) + " réfléchit</span>");
          break;
        }
        case "hit":
          break;
        case "draw":
          await animateDraw(ev, before);
          break;
        case "modifier":
          break;
        case "bust": {
          renderGame();
          const dups = $$('#focus .card.number[data-v="' + ev.card.value + '"]');
          dups.forEach((c) => c.classList.add("dup"));
          shake($("#focus"));
          flash("rgba(255,40,60,.5)");
          sound("bust");
          vibrate([90, 50, 140]);
          splash("DOUBLON&nbsp;!", playerName(ev.player) + " saute · 0 point", "bust");
          setBanner(playerName(ev.player) + " saute&nbsp;!<small>deux " + ev.card.value + " = manche perdue</small>");
          await wait(1500);
          break;
        }
        case "secondChanceUsed":
          renderGame();
          sound("saved");
          vibrate(40);
          splash("SAUVÉ&nbsp;!", "Seconde Chance utilisée par " + playerName(ev.player), "second");
          await wait(1200);
          break;
        case "secondChanceKept": {
          sound("second");
          const el = targetElFor(ev.card, ev.player);
          if (el) {
            const [x, y] = centerOf(el);
            FX.burst(x, y, ["#ff7aa8", "#ffd1e3", "#fff"], 22, { speed: 6 });
          }
          setBanner(playerName(ev.player) + " garde une<br>Seconde Chance");
          await wait(600);
          break;
        }
        case "secondChanceDiscarded":
          toast("Personne ne peut recevoir cette Seconde Chance : elle est défaussée");
          renderGame();
          await wait(500);
          break;
        case "secondChanceGiven": {
          renderGame();
          sound("second");
          const s = seatEl(ev.target);
          if (s) {
            const [x, y] = centerOf(s);
            FX.burst(x, y, ["#ff7aa8", "#ffd1e3", "#fff"], 22, { speed: 6 });
          }
          splash("CADEAU", playerName(ev.player) + " donne la Seconde Chance à " + playerName(ev.target), "second", 1300);
          await wait(1100);
          break;
        }
        case "freeze": {
          renderGame();
          sound("freeze");
          vibrate(60);
          const s = seatEl(ev.target);
          if (s) {
            const [x, y] = centerOf(s);
            FX.ice(x, y);
          }
          flash("rgba(150,235,255,.45)");
          const self = ev.target === ev.player;
          splash("STOP&nbsp;!", playerName(ev.target) + (self ? " se stoppe" : " est stoppé·e") + " avec " + ev.score + " pts", "freeze");
          await wait(1400);
          break;
        }
        case "flip3":
          focusIndex = ev.target;
          renderGame();
          sound("flip3");
          splash("TROIS À<br>LA SUITE&nbsp;!", playerName(ev.target) + " reçoit les " + game.config.flip3Draws + " prochaines cartes", "flip3");
          await wait(1300);
          break;
        case "actionDeferred":
          toast(ACTION_LABEL[ev.card.value] + " mise de côté : elle s'appliquera après les " + game.config.flip3Draws + " cartes");
          await wait(400);
          break;
        case "actionWasted":
          toast(ACTION_LABEL[ev.card.value] + " : plus aucun joueur ciblable, carte défaussée");
          renderGame();
          await wait(400);
          break;
        case "flip7": {
          focusIndex = ev.player;
          renderGame();
          sound("flip7");
          vibrate([60, 40, 60, 40, 200]);
          FX.confetti(180);
          flash("rgba(255,210,80,.45)");
          splash("FLIP 7&nbsp;!", playerName(ev.player) + " gagne +" + game.config.flip7Bonus + " bonus", "flip7", 2200);
          await wait(2200);
          break;
        }
        case "stay": {
          renderGame();
          sound("stay");
          setBanner(playerName(ev.player) + " dit stop<small>" + ev.score + " points mis de côté</small>");
          await wait(700);
          break;
        }
        case "deckEmpty":
          toast("Plus aucune carte disponible : " + game.players[ev.player].name + " s'arrête");
          await wait(400);
          break;
        case "roundEnd":
          renderGame();
          sound("roundEnd");
          await wait(500);
          if (!ev.gameOver) await showRoundSummary();
          break;
        default:
          break;
      }
    }
  }

  // ---------- Sheets ----------
  function openSheet(html, centered) {
    const ov = $("#overlay");
    $("#sheet").innerHTML = html;
    ov.classList.toggle("center", !!centered);
    ov.hidden = false;
  }
  function closeSheet() {
    $("#overlay").hidden = true;
    $("#sheet").innerHTML = "";
  }

  function handoff(p) {
    return new Promise((resolve) => {
      openSheet(
        '<div class="handoff">' + avatarHTML(p) + "<h2>Au tour de " + esc(p.name) + '</h2><p class="lead">Passe le téléphone à ' + esc(p.name) +
          '.</p><button class="btn btn-primary btn-xl" id="handoff-ok">C\'est moi&nbsp;!</button></div>',
        true
      );
      $("#handoff-ok").addEventListener("click", () => {
        sound("tap");
        closeSheet();
        resolve();
      });
    });
  }

  function scoreboardHTML(results) {
    const target = game.config.targetScore;
    const rows = game.players
      .slice()
      .sort((a, b) => b.total - a.total)
      .map((p) => {
        const res = results ? results.find((r) => r.player === p.index) : null;
        let detail = "";
        let roundTxt = "";
        if (res) {
          const b = res.breakdown;
          if (res.status === "busted") detail = "Doublon : 0 point";
          else {
            const parts = [b.numbers + (b.multiplier > 1 ? " ×" + b.multiplier : "")];
            if (b.bonus) parts.push("+" + b.bonus);
            if (b.flip7) parts.push("+" + b.flip7 + " Flip 7");
            detail = (STATUS_LABEL[res.status] || "") + " · " + parts.join(" ");
          }
          roundTxt = '<td class="sb-round" style="color:' + (res.score ? "var(--lime)" : "var(--red)") + '">+' + res.score + "</td>";
        } else {
          detail = p.history.length ? "manches : " + p.history.join(" · ") : "";
        }
        const pct = Math.min(100, Math.round((p.total / target) * 100));
        return (
          '<tr><td><div class="sb-name">' + avatarHTML(p) + "<div><div>" + esc(p.name) + '</div><div class="sb-detail">' + detail +
          '</div></div></div><div class="bar" style="--pc:' + p.color + '"><b style="width:' + pct + '%"></b></div></td>' + roundTxt +
          '<td class="sb-total">' + p.total + "</td></tr>"
        );
      })
      .join("");
    return '<table class="scoreboard">' + rows + "</table>";
  }

  function showRoundSummary() {
    return new Promise((resolve) => {
      const lr = game.lastRound;
      const humans = humansCount();
      openSheet(
        "<h2>Fin de la manche " + lr.round + '</h2><p class="lead">Objectif : ' + game.config.targetScore + " points</p>" +
          scoreboardHTML(lr.results) +
          '<button class="btn btn-primary btn-xl" id="next-round">Manche suivante</button>'
      );
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        sound("tap");
        closeSheet();
        resolve();
      };
      $("#next-round").addEventListener("click", go);
      if (settings.autoNext || humans === 0) setTimeout(go, 4000 / settings.speed);
    });
  }

  function showGameOver() {
    return new Promise(() => {
      store("flip7.save", null);
      const ranking = game.players.slice().sort((a, b) => b.total - a.total);
      const winners = game.winners.map((i) => game.players[i]);
      sound("win");
      vibrate([100, 60, 100, 60, 300]);
      FX.confetti(260);
      setTimeout(() => FX.confetti(160), 1200);
      const order = [ranking[1], ranking[0], ranking[2]].filter(Boolean);
      const podium = order
        .map((p) => {
          const rank = ranking.indexOf(p) + 1;
          return (
            '<div class="p p' + rank + '">' + (rank === 1 ? '<div class="crown">' + icon("crown") + "</div>" : "") + avatarHTML(p) +
            '<div class="p-name">' + esc(p.name) + '</div><div class="block">' + p.total + "</div></div>"
          );
        })
        .join("");
      const title = winners.length > 1 ? "Égalité&nbsp;!" : esc(winners[0].name) + " gagne&nbsp;!";
      openSheet(
        "<h2>" + title + '</h2><p class="lead">Partie terminée en ' + game.roundNumber + " manches</p>" +
          '<div class="podium">' + podium + "</div>" + scoreboardHTML(null) +
          '<button class="btn btn-primary btn-xl" id="go-rematch">Revanche</button>' +
          '<button class="btn" id="go-setup">Modifier la partie</button>' +
          '<button class="btn btn-ghost" id="go-home">Menu principal</button>',
        true
      );
      $("#go-rematch").addEventListener("click", () => {
        closeSheet();
        newGameFromSetup();
      });
      $("#go-setup").addEventListener("click", () => {
        closeSheet();
        stopLoop();
        show("setup");
      });
      $("#go-home").addEventListener("click", () => {
        closeSheet();
        stopLoop();
        show("home");
      });
    });
  }

  function chooseTarget(pending) {
    return new Promise((resolve) => {
      const me = game.players[pending.player];
      const titles = {
        freeze: ["Stop&nbsp;!", "quel joueur sort de la manche&nbsp;?"],
        flip3: ["Trois à la suite&nbsp;!", "quel joueur reçoit les " + game.config.flip3Draws + " prochaines cartes&nbsp;?"],
        second: ["Seconde Chance", "à quel joueur donner cette Seconde Chance&nbsp;?"],
      };
      const suggestion = settings.showHint ? hintFor(pending.player).target : -1;
      const list = pending.options
        .map((i) => {
          const p = game.players[i];
          const risk = Math.round(E.bustProbability(game, i) * 100);
          return (
            '<button class="target' + (i === suggestion ? " suggested" : "") + '" data-target="' + i + '">' + avatarHTML(p) +
            '<div><div class="t-name">' + esc(p.name) + (i === me.index ? " (toi)" : "") + (i === suggestion ? " · conseillé" : "") + "</div>" +
            '<div class="t-sub">' + p.round.numbers.length + " nombre(s) · risque " + risk + " % · total " + p.total + "</div></div>" +
            '<div class="t-score">' + E.roundScore(game, p) + "</div></button>"
          );
        })
        .join("");
      openSheet(
        "<h2>" + titles[pending.action][0] + '</h2><p class="lead">' + esc(me.name) + ", " + titles[pending.action][1] + "</p>" +
          '<div class="sheet-card">' + cardHTML(pending.card, { style: "--w:" + cardSizePx() * 1.3 + "px" }) + "</div>" +
          '<div class="target-list">' + list + "</div>"
      );
      $$("#sheet [data-target]").forEach((b) =>
        b.addEventListener("click", () => {
          sound("tap");
          closeSheet();
          resolve({ target: Number(b.getAttribute("data-target")) });
        })
      );
    });
  }

  // ---------- Human input ----------
  $("#btn-hit").addEventListener("click", () => {
    if (!decisionResolver) return;
    const r = decisionResolver;
    decisionResolver = null;
    vibrate(15);
    r({ hit: true });
  });
  $("#btn-stay").addEventListener("click", () => {
    if (!decisionResolver) return;
    const r = decisionResolver;
    decisionResolver = null;
    vibrate(15);
    r({ stay: true });
  });
  $("#deck-pile").addEventListener("click", () => $("#btn-hit").click());
  function waitHumanTurn() {
    return new Promise((resolve) => {
      decisionResolver = resolve;
      renderGame();
    });
  }

  // ---------- Pause menu / scores ----------
  $("#btn-pause").addEventListener("click", openPause);
  $("#btn-scores").addEventListener("click", () => {
    sound("tap");
    openSheet(
      "<h2>Scores</h2><p class=\"lead\">Manche " + game.roundNumber + " · objectif " + game.config.targetScore + "</p>" +
        scoreboardHTML(null) + '<button class="btn btn-primary" id="close-scores">Fermer</button>'
    );
    $("#close-scores").addEventListener("click", closeSheet);
  });
  function openPause() {
    if (!game) return;
    sound("tap");
    paused = true;
    openSheet(
      '<h2>Pause</h2><p class="lead">La partie est sauvegardée automatiquement.</p>' +
        '<button class="btn btn-primary btn-xl" id="p-resume">Reprendre</button>' +
        '<button class="btn" id="p-rules">Règles du jeu</button>' +
        '<button class="btn" id="p-settings">Réglages</button>' +
        '<button class="btn" id="p-restart">Recommencer la partie</button>' +
        '<button class="btn btn-ghost" id="p-quit">Quitter vers le menu</button>',
      true
    );
    $("#p-resume").addEventListener("click", resumeFromPause);
    $("#p-rules").addEventListener("click", () => {
      closeSheet();
      show("rules");
    });
    $("#p-settings").addEventListener("click", () => {
      closeSheet();
      show("settings");
    });
    $("#p-restart").addEventListener("click", () => {
      closeSheet();
      newGameFromSetup();
    });
    $("#p-quit").addEventListener("click", () => {
      closeSheet();
      stopLoop();
      show("home");
    });
  }
  function resumeFromPause() {
    sound("tap");
    closeSheet();
    paused = false;
    resumeWaiters();
  }

  // ---------- Game loop ----------
  function save() {
    if (game && game.phase !== "gameOver") store("flip7.save", game);
  }
  function stopLoop() {
    runToken++;
    decisionResolver = null;
    paused = false;
    resumeWaiters();
    game = null;
  }
  function snapshotStatus() {
    const s = {};
    for (const p of game.players) s[p.index] = p.round.status;
    return s;
  }

  async function startLoop(state) {
    stopLoop();
    closeSheet();
    game = state;
    lastHumanTurn = -1;
    focusIndex = game.pending ? game.pending.player : (game.dealer + 1) % game.players.length;
    navStack.length = 0;
    navStack.push("home");
    show("game", false);
    setBanner("");
    const token = runToken;
    const alive = () => token === runToken && game === state;
    try {
      while (alive()) {
        await waitUnpaused();
        if (!alive()) return;
        if (game.phase === "gameOver") {
          await showGameOver();
          return;
        }
        if (game.pending) {
          const pending = game.pending;
          const player = game.players[pending.player];
          let decision;
          if (player.type === "ai") {
            if (pending.type === "target") {
              setBanner('<span class="thinking">' + esc(player.name) + " choisit une cible</span>");
            }
            renderGame();
            await new Promise((r) => setTimeout(r, settings.aiDelay));
            await waitUnpaused();
            if (!alive()) return;
            decision = AI.decide(game);
          } else if (pending.type === "turn") {
            setBanner("À toi, " + esc(player.name) + "&nbsp;!");
            decision = await waitHumanTurn();
          } else {
            decision = await chooseTarget(pending);
          }
          if (!alive()) return;
          const before = snapshotStatus();
          const events = E.act(game, decision);
          renderGame({ status: before });
          await playEvents(events, before);
        } else {
          const before = snapshotStatus();
          const events = E.advance(game);
          await playEvents(events, before);
        }
        if (!alive()) return;
        save();
      }
    } catch (err) {
      console.error(err);
      toast("Erreur : " + err.message);
    }
  }

  // ---------- Android back button ----------
  root.Flip7Back = function () {
    if (!$("#overlay").hidden) {
      if ($("#p-resume")) resumeFromPause();
      else if ($("#close-scores")) closeSheet();
      return true;
    }
    if (currentScreen === "game") {
      openPause();
      return true;
    }
    if (currentScreen !== "home") {
      back();
      return true;
    }
    return false;
  };

  applySettings();
  preloadArt();
  show("home", false);
})(this);
