"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../app/src/main/assets/www/js/engine.js");
const AI = require("../app/src/main/assets/www/js/ai.js");

function countCards(state) {
  let n = state.deck.length + state.discard.length;
  for (const p of state.players) {
    const r = p.round;
    if (state.phase === "playing") n += r.numbers.length + r.mods.length + r.actions.length + (r.second ? 1 : 0);
  }
  // An action card waiting for its target is held by the task or the pending decision.
  n += state.queue.filter((t) => t.t === "choose" || t.t === "special").length;
  if (state.pending && state.pending.type === "target") n += 1;
  return n;
}

function runUntilPending(state) {
  const events = [];
  let guard = 0;
  while (!state.pending && state.phase === "playing" && guard++ < 1000) events.push(...E.advance(state));
  return events;
}

function setupRound(state) {
  E.advance(state);
  state.queue = [];
  state.pending = null;
  for (const p of state.players) p.round.numbers = [];
}

function playGame(config, seed) {
  const state = E.createGame(config, seed);
  const total = E.buildDeck(state.config).length;
  let guard = 0;
  while (state.phase !== "gameOver" && guard++ < 100000) {
    if (state.pending) E.act(state, AI.decide(state));
    else E.advance(state);
    if (state.phase === "playing" || state.phase === "roundEnd") assert.equal(countCards(state), total);
  }
  assert.equal(state.phase, "gameOver");
  return state;
}

test("deck has 94 cards with the official composition", () => {
  const deck = E.buildDeck(E.DEFAULT_CONFIG);
  assert.equal(deck.length, 94);
  assert.equal(deck.filter((c) => c.kind === "number").length, 79);
  assert.equal(deck.filter((c) => c.kind === "number" && c.value === 12).length, 12);
  assert.equal(deck.filter((c) => c.kind === "number" && c.value === 0).length, 1);
  assert.equal(deck.filter((c) => c.kind === "mod").length, 6);
  assert.equal(deck.filter((c) => c.kind === "action").length, 9);
});

test("score: numbers doubled by x2, then modifiers, then Flip 7 bonus", () => {
  const s = E.createGame({ players: [{ name: "A" }] }, 1);
  const p = s.players[0];
  p.round.numbers = [1, 2, 3, 4, 5, 6, 7].map((v) => ({ kind: "number", value: v }));
  p.round.mods = [
    { kind: "mod", op: "mul", value: 2 },
    { kind: "mod", op: "add", value: 4 },
  ];
  p.round.flip7 = true;
  p.round.status = "flip7";
  assert.equal(E.roundScore(s, p), 28 * 2 + 4 + 15);
  p.round.status = "busted";
  assert.equal(E.roundScore(s, p), 0);
});

test("duplicate number busts, Second Chance saves once", () => {
  const s = E.createGame({ players: [{ name: "A" }, { name: "B" }] }, 3);
  E.advance(s); // start round
  s.queue = [];
  const a = s.players[0];
  a.round.numbers = [{ id: 900, kind: "number", value: 5 }];
  a.round.second = { id: 901, kind: "action", value: "second" };
  s.deck.push({ id: 902, kind: "number", value: 5 });
  s.queue = [{ t: "draw", p: 0, src: "hit" }];
  E.advance(s);
  assert.equal(a.round.status, "active");
  assert.equal(a.round.second, null);
  s.deck.push({ id: 903, kind: "number", value: 5 });
  s.queue = [{ t: "draw", p: 0, src: "hit" }];
  const ev = E.advance(s);
  assert.equal(a.round.status, "busted");
  assert.ok(ev.some((e) => e.type === "bust"));
});

test("seven unique numbers end the round immediately with the bonus", () => {
  const s = E.createGame({ players: [{ name: "A" }, { name: "B" }] }, 5);
  E.advance(s);
  const a = s.players[0];
  a.round.numbers = [0, 1, 2, 3, 4, 5].map((v, i) => ({ id: 800 + i, kind: "number", value: v }));
  s.deck.push({ id: 810, kind: "number", value: 12 });
  s.queue = [{ t: "draw", p: 0, src: "hit" }, { t: "nextTurn", after: 0 }];
  E.advance(s);
  assert.equal(a.round.status, "flip7");
  E.advance(s); // roundEnd
  assert.equal(s.lastRound.results[0].score, 15 + 12 + 15);
});

test("Flip Three defers Freeze until the three cards are drawn", () => {
  const s = E.createGame({ players: [{ name: "A" }, { name: "B" }, { name: "C" }] }, 9);
  E.advance(s);
  s.queue = [];
  s.pending = null;
  for (const p of s.players) p.round.numbers = [];
  // Deck top is the end of the array.
  s.deck.push({ id: 1003, kind: "number", value: 9 });
  s.deck.push({ id: 1002, kind: "action", value: "freeze" });
  s.deck.push({ id: 1001, kind: "number", value: 2 });
  s.deck.push({ id: 1000, kind: "action", value: "flip3" });
  s.queue = [{ t: "draw", p: 0, src: "hit" }, { t: "nextTurn", after: 0 }];
  runUntilPending(s);
  assert.equal(s.pending.type, "target");
  assert.equal(s.pending.action, "flip3");
  E.act(s, { target: 1 });
  runUntilPending(s);
  const b = s.players[1];
  assert.deepEqual(
    b.round.numbers.map((c) => c.value),
    [2, 9]
  );
  assert.equal(s.pending.type, "target");
  assert.equal(s.pending.action, "freeze");
  assert.equal(s.pending.player, 1);
});

test("full AI games terminate and conserve every card", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const players = [
      { name: "E", type: "ai", level: "easy" },
      { name: "N", type: "ai", level: "normal" },
      { name: "H", type: "ai", level: "hard" },
      { name: "X", type: "ai", level: "expert" },
    ];
    const s = playGame({ players }, seed);
    assert.ok(s.winners.length >= 1);
    assert.ok(s.players[s.winners[0]].total >= 200);
  }
});

test("custom rules: no actions, small target, Flip 5", () => {
  const players = [
    { name: "A", type: "ai", level: "hard" },
    { name: "B", type: "ai", level: "normal" },
  ];
  const s = playGame({ players, targetScore: 50, flip7Count: 5, actions: { freeze: 0, flip3: 0, second: 0 } }, 42);
  assert.equal(s.phase, "gameOver");
});

test("stronger AI wins more often than the beginner", () => {
  const wins = { easy: 0, expert: 0 };
  for (let seed = 1; seed <= 150; seed++) {
    const players =
      seed % 2
        ? [
            { name: "e", type: "ai", level: "easy" },
            { name: "x", type: "ai", level: "expert" },
          ]
        : [
            { name: "x", type: "ai", level: "expert" },
            { name: "e", type: "ai", level: "easy" },
          ];
    const s = playGame({ players }, seed * 7919);
    for (const w of s.winners) wins[s.players[w].level]++;
  }
  assert.ok(wins.expert > wins.easy, JSON.stringify(wins));
});

test("official French rules: no initial deal, the first player chooses right away", () => {
  const s = E.createGame({ players: [{ name: "A" }, { name: "B" }] }, 11);
  E.advance(s);
  runUntilPending(s);
  assert.equal(s.pending.type, "turn");
  assert.ok(s.players.every((p) => p.round.numbers.length === 0));
  assert.equal(s.pending.player, (s.dealer + 1) % 2);
});

test("initial deal variant gives one card to everyone first", () => {
  const s = E.createGame({ players: [{ name: "A" }, { name: "B" }], initialDeal: true, actions: { freeze: 0, flip3: 0, second: 0 } }, 11);
  E.advance(s);
  runUntilPending(s);
  assert.ok(s.players.every((p) => p.round.numbers.length + p.round.mods.length === 1));
});

test("Second Chance revealed during Trois a la suite does not protect during the draws", () => {
  const s = E.createGame({ players: [{ name: "A" }, { name: "B" }, { name: "C" }] }, 13);
  setupRound(s);
  s.players[1].round.numbers = [{ id: 2000, kind: "number", value: 5 }];
  s.deck.push({ id: 2003, kind: "number", value: 7 });
  s.deck.push({ id: 2002, kind: "number", value: 5 });
  s.deck.push({ id: 2001, kind: "action", value: "second" });
  s.queue = [{ t: "draw", p: 1, src: "flip3" }, { t: "draw", p: 1, src: "flip3" }, { t: "draw", p: 1, src: "flip3" }, { t: "flip3End", p: 1 }];
  runUntilPending(s);
  assert.equal(s.players[1].round.status, "busted");
  // Busted: the Second Chance must go to another player still in the round.
  assert.equal(s.pending.type, "target");
  assert.equal(s.pending.action, "second");
  assert.deepEqual(s.pending.options, [0, 2]);
});

test("a player who busts during Trois a la suite still plays a revealed Stop on someone else", () => {
  const s = E.createGame({ players: [{ name: "A" }, { name: "B" }, { name: "C" }] }, 17);
  setupRound(s);
  s.players[1].round.numbers = [{ id: 3000, kind: "number", value: 9 }];
  s.deck.push({ id: 3002, kind: "number", value: 9 });
  s.deck.push({ id: 3001, kind: "action", value: "freeze" });
  s.queue = [{ t: "draw", p: 1, src: "flip3" }, { t: "draw", p: 1, src: "flip3" }, { t: "draw", p: 1, src: "flip3" }, { t: "flip3End", p: 1 }];
  runUntilPending(s);
  assert.equal(s.players[1].round.status, "busted");
  assert.equal(s.pending.action, "freeze");
  assert.deepEqual(s.pending.options, [0, 2]);
});
