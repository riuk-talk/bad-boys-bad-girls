/*
 * Flip 7 AI players. Uses only public information (every card in Flip 7 is face up),
 * so card counting from the deck composition is fair play.
 * Levels: easy, normal, hard, expert.
 */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./engine.js") : root.Flip7Engine);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Flip7AI = api;
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  const LEVELS = {
    easy: { label: "Débutant", memory: false, minStop: 12, maxStop: 26, noise: 0.25 },
    normal: { label: "Joueur", memory: false, riskCap: 0.3, noise: 0.1 },
    hard: { label: "Stratège", memory: true, noise: 0.03 },
    expert: { label: "Expert", memory: true, noise: 0, lookahead: true },
  };

  function rand(state) {
    // Use a separate stream so AI randomness does not change the deck order.
    state.aiRng = ((state.aiRng || state.rng ^ 0x9e3779b9) + 0x6d2b79f5) >>> 0;
    let t = state.aiRng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Card distribution the AI believes is left in the deck. */
  function beliefCounts(state, perfectMemory) {
    if (perfectMemory) return E.unseenCounts(state);
    // Without memory: full deck minus what is visible on the table right now.
    const counts = {};
    let total = 0;
    for (const c of E.buildDeck(state.config)) {
      const k = E.cardKey(c);
      counts[k] = (counts[k] || 0) + 1;
      total++;
    }
    for (const p of state.players) {
      const r = p.round;
      const visible = r.numbers.concat(r.mods, r.actions, r.second ? [r.second] : []);
      for (const c of visible) {
        const k = E.cardKey(c);
        if (counts[k]) {
          counts[k]--;
          total--;
        }
      }
    }
    return { counts: counts, total: Math.max(total, 1) };
  }

  function scoreOf(state, numbers, mods, flip7) {
    let sum = 0;
    for (const v of numbers) sum += v;
    let mul = 1;
    let add = 0;
    for (const m of mods) {
      if (m.op === "mul") mul *= m.value;
      else add += m.value;
    }
    return sum * mul + add + (flip7 ? state.config.flip7Bonus : 0);
  }

  /**
   * Expected round score if the player hits once more and then plays optimally-ish
   * (depth-limited). Returns {stay, hit, pBust}.
   */
  function evaluate(state, playerIndex, belief, depth) {
    const player = state.players[playerIndex];
    const numbers = player.round.numbers.map(function (c) {
      return c.value;
    });
    const mods = player.round.mods.map(function (c) {
      return { op: c.op, value: c.value };
    });
    const hasSecond = !!player.round.second;
    return evalNode(state, numbers, mods, hasSecond, belief.counts, belief.total, depth);
  }

  function evalNode(state, numbers, mods, hasSecond, counts, total, depth) {
    const stay = scoreOf(state, numbers, mods, false);
    if (total <= 0) return { stay: stay, hit: stay, pBust: 0 };
    let ev = 0;
    let pBust = 0;
    for (const key of Object.keys(counts)) {
      const n = counts[key];
      if (!n) continue;
      const p = n / total;
      let value;
      if (key[0] === "n") {
        const v = parseInt(key.slice(1), 10);
        if (numbers.indexOf(v) >= 0) {
          if (hasSecond) value = stay;
          else {
            value = 0;
            pBust += p;
          }
        } else {
          const nn = numbers.concat([v]);
          if (nn.length >= state.config.flip7Count) {
            value = scoreOf(state, nn, mods, true);
          } else if (depth > 1) {
            counts[key]--;
            const child = evalNode(state, nn, mods, hasSecond, counts, total - 1, depth - 1);
            counts[key]++;
            value = Math.max(child.stay, child.hit);
          } else {
            value = scoreOf(state, nn, mods, false);
          }
        }
      } else if (key[0] === "m") {
        const label = key.slice(1);
        const mod = label === "x2" ? { op: "mul", value: 2 } : { op: "add", value: parseInt(label, 10) };
        value = scoreOf(state, numbers, mods.concat([mod]), false);
      } else {
        // Action cards: roughly neutral for our own score; Second Chance protects.
        value = key === "asecond" ? stay + 2 : stay;
      }
      ev += p * value;
    }
    return { stay: stay, hit: ev, pBust: pBust };
  }

  function bestOpponentTotal(state, playerIndex) {
    let best = 0;
    for (const p of state.players) {
      if (p.index === playerIndex) continue;
      best = Math.max(best, p.total + (p.round.status === "busted" ? 0 : E.roundScore(state, p)));
    }
    return best;
  }

  function decideTurn(state, playerIndex) {
    const player = state.players[playerIndex];
    const level = LEVELS[player.level] || LEVELS.normal;
    const current = E.roundScore(state, player);
    const target = state.config.targetScore;

    if (player.round.numbers.length === 0 && player.round.mods.length === 0) return { hit: true };

    if (player.level === "easy") {
      const pBust = E.bustProbability(state, playerIndex);
      const stopAt = level.minStop + rand(state) * (level.maxStop - level.minStop);
      if (pBust > 0.55) return { stay: true };
      return current >= stopAt ? { stay: true } : { hit: true };
    }

    const belief = beliefCounts(state, level.memory);
    const depth = level.lookahead ? 2 : 1;
    const ev = evaluate(state, playerIndex, belief, depth);

    // Endgame awareness.
    const myFinal = player.total + current;
    const others = bestOpponentTotal(state, playerIndex);
    const othersStillPlaying = state.players.some(function (p) {
      return p.index !== playerIndex && E.isActive(p);
    });
    if (myFinal >= target && myFinal > others && !othersStillPlaying) return { stay: true };
    if (myFinal >= target && myFinal > others + 15) return { stay: true };

    let margin = 0;
    // Someone is about to win and we are behind: take more risk.
    if (others >= target - 10 && myFinal < others) margin -= current * 0.5 + 5;
    // Far ahead: play safer.
    if (player.total - others > 40) margin += 2;

    if (player.level === "normal") {
      if (ev.pBust > level.riskCap + (margin < 0 ? 0.25 : 0)) return { stay: true };
    }

    const noise = (rand(state) - 0.5) * 2 * level.noise * Math.max(current, 10);
    return ev.hit + noise >= current + margin ? { hit: true } : { stay: true };
  }

  /** Higher = more dangerous opponent. */
  function threat(state, p) {
    const leaderBoost = p.total / Math.max(state.config.targetScore, 1);
    return 1 + leaderBoost * 2;
  }

  function decideTarget(state, pending) {
    const me = state.players[pending.player];
    const level = LEVELS[me.level] || LEVELS.normal;
    const options = pending.options;
    if (me.level === "easy" && rand(state) < 0.5) {
      return { target: options[Math.floor(rand(state) * options.length)] };
    }
    const belief = beliefCounts(state, level.memory);

    if (pending.action === "second") {
      // Give it to the weakest player.
      let best = options[0];
      for (const o of options) {
        if (state.players[o].total < state.players[best].total) best = o;
      }
      return { target: best };
    }

    let bestTarget = options[0];
    let bestValue = -Infinity;
    for (const o of options) {
      const p = state.players[o];
      const current = E.roundScore(state, p);
      const ev = evaluate(state, o, belief, 1);
      let value;
      if (pending.action === "freeze") {
        if (o === me.index) {
          // Banking our own points is good when hitting looks bad.
          value = current - ev.hit + (ev.pBust > 0.35 ? current * 0.3 : -5);
        } else {
          // Freezing an opponent early denies their future points.
          const potential = Math.max(0, ev.hit - current) * 3 + Math.max(0, 25 - current);
          value = potential * 0.5 * threat(state, p);
        }
      } else {
        // Flip Three: hurts players likely to bust with a big hand.
        const pBust3 = 1 - Math.pow(1 - ev.pBust, 3);
        if (o === me.index) {
          value = (1 - pBust3) * 12 - pBust3 * current - 4;
        } else {
          value = (pBust3 * current - (1 - pBust3) * 10) * threat(state, p);
        }
      }
      if (value > bestValue) {
        bestValue = value;
        bestTarget = o;
      }
    }
    return { target: bestTarget };
  }

  function decide(state) {
    const pending = state.pending;
    if (!pending) return null;
    if (pending.type === "turn") return decideTurn(state, pending.player);
    return decideTarget(state, pending);
  }

  return { LEVELS: LEVELS, decide: decide, evaluate: evaluate };
});
