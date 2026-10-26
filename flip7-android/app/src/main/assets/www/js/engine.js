/*
 * Flip 7 game engine.
 * Pure, serialisable state + functions. No DOM access, so it runs in Node for tests.
 * The engine works as a task queue: advance() processes one task and returns the
 * events it produced, until a decision (pending) is needed from a player.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Flip7Engine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_CONFIG = {
    players: [],
    targetScore: 200,
    flip7Bonus: 15,
    flip7Count: 7,
    maxNumber: 12,
    actions: { freeze: 3, flip3: 3, second: 3 },
    modifiers: { "+2": 1, "+4": 1, "+6": 1, "+8": 1, "+10": 1, x2: 1 },
    reshuffleEachRound: false,
    tieRule: "extra", // "extra": play another round, "shared": tied players all win
    flip3Draws: 3,
    initialDeal: false, // variant: deal one card to everyone before the first choice
  };

  // ---------- RNG (serialisable) ----------
  function nextRandom(state) {
    let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(state, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom(state) * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // ---------- Deck ----------
  function buildDeck(config) {
    const cards = [];
    let id = 0;
    cards.push({ id: id++, kind: "number", value: 0 });
    for (let n = 1; n <= config.maxNumber; n++) {
      for (let k = 0; k < n; k++) cards.push({ id: id++, kind: "number", value: n });
    }
    for (const key of Object.keys(config.modifiers)) {
      const count = config.modifiers[key] | 0;
      for (let k = 0; k < count; k++) {
        if (key === "x2") cards.push({ id: id++, kind: "mod", op: "mul", value: 2, label: "x2" });
        else cards.push({ id: id++, kind: "mod", op: "add", value: parseInt(key, 10), label: key });
      }
    }
    for (const action of ["freeze", "flip3", "second"]) {
      const count = config.actions[action] | 0;
      for (let k = 0; k < count; k++) cards.push({ id: id++, kind: "action", value: action });
    }
    return cards;
  }

  function cardKey(card) {
    if (card.kind === "number") return "n" + card.value;
    if (card.kind === "mod") return "m" + card.label;
    return "a" + card.value;
  }

  // ---------- Game creation ----------
  function mergeConfig(config) {
    const merged = Object.assign({}, DEFAULT_CONFIG, config || {});
    merged.actions = Object.assign({}, DEFAULT_CONFIG.actions, (config && config.actions) || {});
    merged.modifiers = Object.assign({}, DEFAULT_CONFIG.modifiers, (config && config.modifiers) || {});
    return merged;
  }

  function emptyRound() {
    return { numbers: [], mods: [], actions: [], second: null, status: "active", flip7: false };
  }

  function createGame(config, seed) {
    const cfg = mergeConfig(config);
    if (!cfg.players || cfg.players.length < 1) throw new Error("At least one player is required");
    const state = {
      version: 1,
      config: cfg,
      rng: (seed === undefined ? Math.floor(Math.random() * 4294967296) : seed) >>> 0,
      players: cfg.players.map(function (p, i) {
        return {
          index: i,
          name: p.name || "Joueur " + (i + 1),
          type: p.type === "ai" ? "ai" : "human",
          level: p.level || "normal",
          color: p.color || null,
          total: 0,
          history: [],
          round: emptyRound(),
        };
      }),
      deck: [],
      discard: [],
      dealer: 0,
      roundNumber: 0,
      queue: [],
      pending: null,
      phase: "idle", // idle | playing | roundEnd | gameOver
      lastRound: null,
      winners: [],
    };
    state.deck = shuffle(state, buildDeck(cfg));
    state.dealer = Math.floor(nextRandom(state) * state.players.length);
    return state;
  }

  // ---------- Helpers ----------
  function isActive(player) {
    return player.round.status === "active";
  }

  function activePlayers(state) {
    return state.players.filter(isActive);
  }

  function hasNumber(player, value) {
    return player.round.numbers.some(function (c) {
      return c.value === value;
    });
  }

  function roundScore(state, player) {
    const r = player.round;
    if (r.status === "busted") return 0;
    let sum = 0;
    for (const c of r.numbers) sum += c.value;
    let mul = 1;
    let add = 0;
    for (const m of r.mods) {
      if (m.op === "mul") mul *= m.value;
      else add += m.value;
    }
    return sum * mul + add + (r.flip7 ? state.config.flip7Bonus : 0);
  }

  function scoreBreakdown(state, player) {
    const r = player.round;
    let sum = 0;
    for (const c of r.numbers) sum += c.value;
    let mul = 1;
    let add = 0;
    for (const m of r.mods) {
      if (m.op === "mul") mul *= m.value;
      else add += m.value;
    }
    return {
      numbers: sum,
      multiplier: mul,
      bonus: add,
      flip7: r.flip7 ? state.config.flip7Bonus : 0,
      busted: r.status === "busted",
      total: roundScore(state, player),
    };
  }

  function nextIndex(state, from) {
    return (from + 1) % state.players.length;
  }

  function findNextActive(state, from) {
    const n = state.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (isActive(state.players[i])) return i;
    }
    return -1;
  }

  function drawCard(state, events) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) return null;
      state.deck = shuffle(state, state.discard);
      state.discard = [];
      events.push({ type: "reshuffle", count: state.deck.length });
    }
    return state.deck.pop();
  }

  function pushFront(state, tasks) {
    state.queue = tasks.concat(state.queue);
  }

  // ---------- Round flow ----------
  function startRound(state) {
    const events = [];
    state.roundNumber += 1;
    state.phase = "playing";
    state.pending = null;
    state.lastRound = null;
    for (const p of state.players) p.round = emptyRound();
    if (state.config.reshuffleEachRound && state.discard.length) {
      state.deck = shuffle(state, state.deck.concat(state.discard));
      state.discard = [];
      events.push({ type: "reshuffle", count: state.deck.length });
    }
    const tasks = [];
    if (state.config.initialDeal) {
      for (let k = 1; k <= state.players.length; k++) {
        tasks.push({ t: "deal", p: (state.dealer + k) % state.players.length });
      }
    }
    tasks.push({ t: "turn", p: nextIndex(state, state.dealer) });
    state.queue = tasks;
    events.unshift({ type: "roundStart", round: state.roundNumber, dealer: state.dealer });
    return events;
  }

  function endRoundNow(state, events) {
    state.queue = [{ t: "roundEnd" }];
    state.pending = null;
    return events;
  }

  function resolveDraw(state, p, src, events) {
    const player = state.players[p];
    if (!isActive(player)) return;
    const card = drawCard(state, events);
    if (!card) {
      // Every card is on the table: nothing left to draw, the player banks.
      player.round.status = "stayed";
      events.push({ type: "deckEmpty", player: p });
      return;
    }
    events.push({ type: "draw", player: p, card: card, src: src });

    if (card.kind === "number") {
      if (hasNumber(player, card.value)) {
        if (player.round.second) {
          const sc = player.round.second;
          player.round.second = null;
          state.discard.push(card, sc);
          events.push({ type: "secondChanceUsed", player: p, card: card, second: sc });
          return;
        }
        player.round.numbers.push(card);
        player.round.status = "busted";
        events.push({ type: "bust", player: p, card: card });
        return;
      }
      player.round.numbers.push(card);
      if (player.round.numbers.length >= state.config.flip7Count) {
        player.round.flip7 = true;
        player.round.status = "flip7";
        events.push({ type: "flip7", player: p });
        endRoundNow(state, events);
      }
      return;
    }

    if (card.kind === "mod") {
      player.round.mods.push(card);
      events.push({ type: "modifier", player: p, card: card });
      return;
    }

    // Special cards revealed during "Trois à la suite" only apply after the draws (or the bust).
    if (src === "flip3") {
      player.round.actions.push(card);
      events.push({ type: "actionDeferred", player: p, card: card });
      return;
    }
    resolveSpecial(state, p, card, events);
  }

  function resolveSpecial(state, p, card, events) {
    const player = state.players[p];
    if (card.value === "second") {
      if (isActive(player) && !player.round.second) {
        player.round.second = card;
        events.push({ type: "secondChanceKept", player: p, card: card });
        return;
      }
      const options = state.players
        .filter(function (o) {
          return o.index !== p && isActive(o) && !o.round.second;
        })
        .map(function (o) {
          return o.index;
        });
      if (options.length === 0) {
        state.discard.push(card);
        events.push({ type: "secondChanceDiscarded", player: p, card: card });
        return;
      }
      pushFront(state, [{ t: "choose", p: p, action: "second", card: card }]);
      return;
    }

    pushFront(state, [{ t: "choose", p: p, action: card.value, card: card }]);
  }

  function targetOptions(state, p, action) {
    if (action === "second") {
      return state.players
        .filter(function (o) {
          return o.index !== p && isActive(o) && !o.round.second;
        })
        .map(function (o) {
          return o.index;
        });
    }
    return activePlayers(state).map(function (o) {
      return o.index;
    });
  }

  function applyAction(state, p, action, card, target, events) {
    const t = state.players[target];
    if (action === "second") {
      t.round.second = card;
      events.push({ type: "secondChanceGiven", player: p, target: target, card: card });
      return;
    }
    state.discard.push(card);
    if (action === "freeze") {
      t.round.status = "frozen";
      events.push({ type: "freeze", player: p, target: target, card: card, score: roundScore(state, t) });
      return;
    }
    // Flip Three
    events.push({ type: "flip3", player: p, target: target, card: card });
    const tasks = [];
    for (let k = 0; k < state.config.flip3Draws; k++) tasks.push({ t: "draw", p: target, src: "flip3", k: k + 1 });
    tasks.push({ t: "flip3End", p: target });
    pushFront(state, tasks);
  }

  function processTask(state, task, events) {
    switch (task.t) {
      case "deal": {
        if (isActive(state.players[task.p])) {
          resolveDraw(state, task.p, "deal", events);
        }
        return;
      }
      case "draw": {
        resolveDraw(state, task.p, task.src, events);
        return;
      }
      case "flip3End": {
        // Applied even if the player busted: they then target another player still in the round.
        const player = state.players[task.p];
        const deferred = player.round.actions;
        player.round.actions = [];
        pushFront(
          state,
          deferred.map(function (c) {
            return { t: "special", p: task.p, card: c };
          })
        );
        return;
      }
      case "special": {
        resolveSpecial(state, task.p, task.card, events);
        return;
      }
      case "choose": {
        const options = targetOptions(state, task.p, task.action);
        if (options.length === 0) {
          state.discard.push(task.card);
          events.push({ type: "actionWasted", player: task.p, card: task.card });
          return;
        }
        if (options.length === 1) {
          applyAction(state, task.p, task.action, task.card, options[0], events);
          return;
        }
        state.pending = {
          type: "target",
          player: task.p,
          action: task.action,
          card: task.card,
          options: options,
        };
        return;
      }
      case "turn": {
        const i = isActive(state.players[task.p]) ? task.p : findNextActive(state, task.p);
        if (i < 0) {
          state.queue = [{ t: "roundEnd" }];
          return;
        }
        state.pending = { type: "turn", player: i };
        events.push({ type: "turn", player: i });
        return;
      }
      case "nextTurn": {
        const i = findNextActive(state, task.after);
        if (i < 0) {
          state.queue = [{ t: "roundEnd" }];
          return;
        }
        pushFront(state, [{ t: "turn", p: i }]);
        return;
      }
      case "roundEnd": {
        finishRound(state, events);
        return;
      }
      default:
        throw new Error("Unknown task " + task.t);
    }
  }

  function finishRound(state, events) {
    const results = state.players.map(function (p) {
      const b = scoreBreakdown(state, p);
      return { player: p.index, status: p.round.status, breakdown: b, score: b.total };
    });
    for (const r of results) {
      const p = state.players[r.player];
      p.total += r.score;
      p.history.push(r.score);
    }
    // Collect table cards into the discard pile.
    for (const p of state.players) {
      const r = p.round;
      for (const c of r.numbers) state.discard.push(c);
      for (const c of r.mods) state.discard.push(c);
      for (const c of r.actions) state.discard.push(c);
      if (r.second) state.discard.push(r.second);
    }
    state.lastRound = { round: state.roundNumber, results: results };
    state.queue = [];
    state.pending = null;

    const target = state.config.targetScore;
    const best = Math.max.apply(
      null,
      state.players.map(function (p) {
        return p.total;
      })
    );
    let over = false;
    if (best >= target) {
      const leaders = state.players.filter(function (p) {
        return p.total === best;
      });
      if (leaders.length === 1 || state.config.tieRule === "shared") {
        over = true;
        state.winners = leaders.map(function (p) {
          return p.index;
        });
      }
    }
    events.push({ type: "roundEnd", results: results, gameOver: over });
    if (over) {
      state.phase = "gameOver";
      events.push({ type: "gameOver", winners: state.winners });
    } else {
      state.phase = "roundEnd";
      state.dealer = nextIndex(state, state.dealer);
    }
  }

  /** Processes tasks until a decision is required or the round is over. Returns events. */
  function advance(state) {
    const events = [];
    if (state.pending) return events;
    if (state.phase === "idle" || state.phase === "roundEnd") {
      return startRound(state);
    }
    if (state.phase !== "playing") return events;
    const task = state.queue.shift();
    if (!task) return events;
    processTask(state, task, events);
    return events;
  }

  /** Applies a player's decision. decision: {hit:true} | {stay:true} | {target:index} */
  function act(state, decision) {
    const pending = state.pending;
    if (!pending) throw new Error("No pending decision");
    const events = [];
    if (pending.type === "turn") {
      const p = pending.player;
      state.pending = null;
      if (decision.stay) {
        state.players[p].round.status = "stayed";
        events.push({ type: "stay", player: p, score: roundScore(state, state.players[p]) });
        pushFront(state, [{ t: "nextTurn", after: p }]);
      } else {
        events.push({ type: "hit", player: p });
        pushFront(state, [
          { t: "draw", p: p, src: "hit" },
          { t: "nextTurn", after: p },
        ]);
      }
      return events;
    }
    if (pending.type === "target") {
      if (pending.options.indexOf(decision.target) < 0) throw new Error("Invalid target");
      state.pending = null;
      applyAction(state, pending.player, pending.action, pending.card, decision.target, events);
      return events;
    }
    throw new Error("Unknown pending type");
  }

  // ---------- Probability helpers (used by AI and the bust meter) ----------
  /** Composition of cards not visible on the table or in the discard pile (= the deck). */
  function unseenCounts(state) {
    const counts = {};
    let total = 0;
    const source = state.deck.length ? state.deck : state.discard;
    for (const c of source) {
      const k = cardKey(c);
      counts[k] = (counts[k] || 0) + 1;
      total++;
    }
    return { counts: counts, total: total };
  }

  function bustProbability(state, playerIndex) {
    const player = state.players[playerIndex];
    if (player.round.second) return 0;
    const u = unseenCounts(state);
    if (u.total === 0) return 0;
    let bad = 0;
    for (const c of player.round.numbers) bad += u.counts["n" + c.value] || 0;
    return bad / u.total;
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    buildDeck: buildDeck,
    createGame: createGame,
    advance: advance,
    act: act,
    roundScore: roundScore,
    scoreBreakdown: scoreBreakdown,
    bustProbability: bustProbability,
    unseenCounts: unseenCounts,
    targetOptions: targetOptions,
    cardKey: cardKey,
    nextRandom: nextRandom,
    isActive: isActive,
  };
});
