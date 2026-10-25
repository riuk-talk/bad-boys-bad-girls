/* Synthesised sound effects (Web Audio, no audio files). */
(function (root) {
  "use strict";
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type, gain, slideTo) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(start, dur, freq, q, gain) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + start;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  const sounds = {
    flip() {
      noise(0, 0.09, 2400, 0.8, 0.5);
      tone(520, 0.02, 0.06, "triangle", 0.08, 900);
    },
    land(value) {
      const base = 330 + (value || 0) * 28;
      tone(base, 0, 0.14, "triangle", 0.18);
      tone(base * 1.5, 0.03, 0.12, "sine", 0.08);
    },
    tap() {
      tone(700, 0, 0.05, "square", 0.05);
    },
    stay() {
      tone(523, 0, 0.12, "triangle", 0.2);
      tone(659, 0.08, 0.12, "triangle", 0.2);
      tone(784, 0.16, 0.22, "triangle", 0.2);
    },
    bust() {
      tone(220, 0, 0.5, "sawtooth", 0.22, 55);
      noise(0, 0.35, 180, 0.7, 0.9);
      tone(110, 0.05, 0.4, "square", 0.08, 40);
    },
    flip7() {
      const notes = [523, 659, 784, 1047, 784, 1047, 1319];
      notes.forEach(function (n, i) {
        tone(n, i * 0.09, 0.25, "triangle", 0.22);
        tone(n * 2, i * 0.09, 0.15, "sine", 0.06);
      });
      noise(0.62, 0.6, 6000, 0.5, 0.25);
    },
    freeze() {
      [1568, 2093, 2637, 3136].forEach(function (n, i) {
        tone(n, i * 0.05, 0.4, "sine", 0.09);
      });
      noise(0, 0.5, 8000, 1.5, 0.2);
    },
    flip3() {
      [392, 523, 659].forEach(function (n, i) {
        tone(n, i * 0.1, 0.16, "square", 0.08);
      });
    },
    second() {
      tone(660, 0, 0.18, "sine", 0.2, 990);
      tone(990, 0.12, 0.3, "sine", 0.16, 1320);
    },
    saved() {
      tone(440, 0, 0.12, "triangle", 0.2, 880);
      noise(0, 0.2, 3000, 1, 0.3);
    },
    modifier() {
      tone(880, 0, 0.1, "triangle", 0.15);
      tone(1320, 0.06, 0.16, "triangle", 0.12);
    },
    shuffle() {
      for (let i = 0; i < 8; i++) noise(i * 0.045, 0.05, 2000 + i * 200, 0.9, 0.35);
    },
    roundEnd() {
      tone(392, 0, 0.2, "triangle", 0.2);
      tone(523, 0.15, 0.3, "triangle", 0.2);
    },
    win() {
      const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
      const times = [0, 0.12, 0.24, 0.36, 0.6, 0.78, 0.9, 1.1];
      notes.forEach(function (n, i) {
        tone(n, times[i], 0.3, "triangle", 0.22);
        tone(n / 2, times[i], 0.3, "sine", 0.1);
      });
    },
  };

  root.Flip7Audio = {
    play(name, arg) {
      if (!enabled || !sounds[name]) return;
      try {
        sounds[name](arg);
      } catch (e) {
        /* audio is best effort */
      }
    },
    setEnabled(v) {
      enabled = !!v;
    },
    unlock() {
      ensure();
    },
  };
})(this);
