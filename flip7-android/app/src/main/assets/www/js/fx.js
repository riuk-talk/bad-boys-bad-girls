/* Particle effects on a full-screen canvas: confetti, sparkles, ice shards. */
(function (root) {
  "use strict";
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  let particles = [];
  let running = false;
  let dpr = 1;

  function resize() {
    dpr = Math.min(root.devicePixelRatio || 1, 2);
    canvas.width = root.innerWidth * dpr;
    canvas.height = root.innerHeight * dpr;
  }
  root.addEventListener("resize", resize);
  resize();

  const PALETTE = ["#ffc93c", "#ff3d7f", "#3de0ff", "#9cf04a", "#a78bfa", "#ff9f1c", "#ffffff"];

  function loop() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = performance.now();
    particles = particles.filter(function (p) {
      return now - p.born < p.life;
    });
    for (const p of particles) {
      const age = (now - p.born) / p.life;
      p.vy += p.g;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.pow(age, 3));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx.scale(1, Math.cos(p.rot * 3));
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.shape === "star") {
        star(p.size);
      } else if (p.shape === "shard") {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.3, 0);
        ctx.lineTo(0, p.size);
        ctx.lineTo(-p.size * 0.3, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (particles.length) requestAnimationFrame(loop);
    else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function star(r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  function add(p) {
    particles.push(
      Object.assign(
        { born: performance.now(), life: 1500, g: 0.25, drag: 0.985, rot: 0, vr: 0, shape: "rect", size: 8, color: "#fff" },
        p
      )
    );
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  root.Flip7FX = {
    confetti(amount) {
      const w = root.innerWidth;
      const n = amount || 160;
      for (let i = 0; i < n; i++) {
        const fromLeft = i % 2 === 0;
        add({
          x: fromLeft ? -10 : w + 10,
          y: root.innerHeight * rand(0.45, 0.8),
          vx: (fromLeft ? 1 : -1) * rand(5, 14),
          vy: rand(-16, -7),
          g: 0.28,
          vr: rand(-0.2, 0.2),
          size: rand(7, 13),
          life: rand(2200, 3400),
          color: PALETTE[i % PALETTE.length],
          shape: i % 5 === 0 ? "star" : "rect",
        });
      }
    },
    burst(x, y, colors, amount, opts) {
      const n = amount || 28;
      const o = opts || {};
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(2, o.speed || 8);
        add({
          x: x,
          y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - (o.lift || 2),
          g: o.g === undefined ? 0.18 : o.g,
          drag: 0.96,
          vr: rand(-0.3, 0.3),
          size: rand(4, o.size || 9),
          life: rand(600, o.life || 1100),
          color: (colors || PALETTE)[i % (colors || PALETTE).length],
          shape: o.shape || (i % 3 === 0 ? "star" : "dot"),
        });
      }
    },
    ice(x, y) {
      this.burst(x, y, ["#e6fcff", "#9eeaff", "#3de0ff", "#ffffff"], 34, { shape: "shard", speed: 9, g: 0.12, size: 14, life: 1300 });
    },
  };
})(this);
