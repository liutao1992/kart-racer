(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const mod = (n, d) => ((n % d) + d) % d;
  const angleDelta = (a, b) => mod(a - b + Math.PI, TAU) - Math.PI;
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (a, b, dt, rate) => lerp(a, b, 1 - Math.exp(-rate * dt));
  function spline(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function buildTrack(config) {
    const raw = [], points = config.points, n = points.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 64; j++) {
        const p = [points[mod(i - 1, n)], points[i], points[(i + 1) % n], points[(i + 2) % n]];
        raw.push({ x: spline(p[0][0], p[1][0], p[2][0], p[3][0], j / 64), z: spline(p[0][1], p[1][1], p[2][1], p[3][1], j / 64) });
      }
    }
    raw.push({ ...raw[0] });
    const cumulative = [0];
    for (let i = 1; i < raw.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
    const length = cumulative[cumulative.length - 1], count = 720, samples = [];
    let index = 0;
    for (let i = 0; i < count; i++) {
      const s = i * length / count;
      while (cumulative[index + 1] < s) index++;
      const f = (s - cumulative[index]) / (cumulative[index + 1] - cumulative[index]);
      samples.push({ x: lerp(raw[index].x, raw[index + 1].x, f), z: lerp(raw[index].z, raw[index + 1].z, f), s });
    }
    for (let i = 0; i < count; i++) {
      const prev = samples[mod(i - 1, count)], next = samples[(i + 1) % count];
      const dx = next.x - prev.x, dz = next.z - prev.z, d = Math.hypot(dx, dz);
      Object.assign(samples[i], { tx: dx / d, tz: dz / d, rx: dz / d, rz: -dx / d, heading: Math.atan2(dx, dz) });
    }
    const bounds = { minX: Math.min(...samples.map(p => p.x)), maxX: Math.max(...samples.map(p => p.x)), minZ: Math.min(...samples.map(p => p.z)), maxZ: Math.max(...samples.map(p => p.z)) };
    return { ...config, samples, length, bounds, gateCount: 12 };
  }
  function sample(track, distance, offset = 0) {
    const u = mod(distance, track.length) / track.length * track.samples.length;
    const i = Math.floor(u), t = u - i;
    const a = track.samples[i], b = track.samples[(i + 1) % track.samples.length];
    const heading = a.heading + angleDelta(b.heading, a.heading) * t;
    const tx = Math.sin(heading), tz = Math.cos(heading);
    return { x: lerp(a.x, b.x, t) + tz * offset, z: lerp(a.z, b.z, t) - tx * offset, tx, tz, rx: tz, rz: -tx, heading, s: mod(distance, track.length) };
  }
  function project(track, x, z) {
    let best = Infinity, result;
    const n = track.samples.length;
    for (let i = 0; i < n; i++) {
      const a = track.samples[i], b = track.samples[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) {
        best = d2;
        const d = Math.hypot(dx, dz);
        result = { x: px, z: pz, s: mod((i + t) / n * track.length, track.length), lateral: (x - px) * dz / d - (z - pz) * dx / d, heading: Math.atan2(dx, dz), distance: Math.sqrt(d2) };
      }
    }
    return result;
  }
  const COLORS = ['#f17b46', '#3fafa7', '#f1be4b', '#8596d3', '#e486a4', '#90b56b'];
  const NAMES = ['你', '小风', '橘子', '阿森', '泡泡', '闪电'];
  const ITEMS = ['missile', 'banana', 'water', 'magnet', 'shield', 'nitro', 'lightning', 'ufo'];
  // Rank-weighted item odds: trailing drivers get more attack items, KartRider style.
  const ITEM_TABLE = [
    { maxRank: 1, weights: { missile: 5, water: 15, magnet: 10, nitro: 10, banana: 28, shield: 27, lightning: 5, ufo: 0 } },
    { maxRank: 3, weights: { missile: 20, water: 18, magnet: 18, nitro: 8, banana: 12, shield: 12, lightning: 7, ufo: 5 } },
    { maxRank: 5, weights: { missile: 25, water: 18, magnet: 20, nitro: 10, banana: 4, shield: 4, lightning: 10, ufo: 9 } }];
  // Rows of three boxes every 150 units, starting past the grid area.
  function buildBoxes(track) {
    const boxes = [];
    for (let s = 60; s < track.length - 20; s += 150) for (const lateral of [-2.4, 0, 2.4]) {
      const p = sample(track, s, lateral); boxes.push({ x: p.x, z: p.z, respawn: 0 });
    }
    return boxes;
  }
  // Difficulty tiers: normal mirrors the original constants exactly. AI pace and
  // item aggression scale per tier; wall/offroad/reset penalties only bite the
  // player in practice (AI reset at half+2, before ever touching a wall).
  // Smart-driving keys (aiTopCap/rubber/steerGain/nitro thresholds/huntPlayer)
  // default to the classic behavior on the original three tiers; only legend
  // breaks the top-speed cap, rubber-bands around the player, and hunts them.
  const BASE_SMART = { aiTopCap: 42, rubberGain: 0, rubberMin: 1, rubberMax: 1, steerGain: 2.2, nitroSteer: 0.15, nitroSpeed: 25, huntPlayer: false, cornerFactor: 22, cornerFloor: 19, driftCurveMin: 0.33, driftCurveMax: 1.35, driftDeltaMax: 0.7, turnBoost: 1 };
  const DIFFICULTY = {
    easy:   { ...BASE_SMART, paceBase: 0.76, paceStep: 0.017, aiTop: 41, itemCooldown: 1.15, shieldFire: 0.03, bananaFire: 0.05, wallKeep: 0.58, offroadTop: 21, resetCooldown: 2.0 },
    normal: { ...BASE_SMART, paceBase: 0.83, paceStep: 0.021, aiTop: 41, itemCooldown: 0.9,  shieldFire: 0.05, bananaFire: 0.08, wallKeep: 0.52, offroadTop: 19, resetCooldown: 2.2 },
    master: { ...BASE_SMART, paceBase: 0.90, paceStep: 0.022, aiTop: 41, itemCooldown: 0.55, shieldFire: 0.10, bananaFire: 0.15, wallKeep: 0.44, offroadTop: 16, resetCooldown: 2.6 },
    legend: { paceBase: 1.00, paceStep: 0.020, aiTop: 45, itemCooldown: 0.4, shieldFire: 0.14, bananaFire: 0.20, wallKeep: 0.38, offroadTop: 14, resetCooldown: 3.0,
              aiTopCap: 44.5, rubberGain: 0.0006, rubberMin: 0.94, rubberMax: 1.10, steerGain: 2.6, nitroSteer: 0.28, nitroSpeed: 21, huntPlayer: true,
              cornerFactor: 22, cornerFloor: 19, driftCurveMin: 0.33, driftCurveMax: 1.35, driftDeltaMax: 0.7, turnBoost: 1 },
    hell:   { paceBase: 1.06, paceStep: 0.018, aiTop: 47, itemCooldown: 0.3, shieldFire: 0.18, bananaFire: 0.25, wallKeep: 0.34, offroadTop: 13, resetCooldown: 3.4,
              aiTopCap: 46, rubberGain: 0.0009, rubberMin: 0.97, rubberMax: 1.20, steerGain: 3.0, nitroSteer: 0.32, nitroSpeed: 19, huntPlayer: true,
              cornerFactor: 16, cornerFloor: 28, driftCurveMin: 0.20, driftCurveMax: 1.9, driftDeltaMax: 1.1, turnBoost: 1.35 },
  };
  class Race {
    constructor(track, color = COLORS[0], rng = Math.random, difficulty = 'normal') {
      this.difficultyKey = Object.hasOwn(DIFFICULTY, difficulty) ? difficulty : 'normal';
      this.difficulty = DIFFICULTY[this.difficultyKey];
      this.track = track;
      this.state = 'ready'; this.elapsed = 0; this.countdown = 3.4; this.laps = 3;
      this.events = []; this.finishedCount = 0; this.rand = rng;
      this.boxes = buildBoxes(track); this.hazards = []; this.missiles = [];
      this.nextVisualId = 1; // Presentation identity only; never consumes simulation randomness.
      this.cars = Array.from({ length: 6 }, (_, id) => {
        const progress = -8 - Math.floor(id / 2) * 7;
        const pos = sample(track, progress, id % 2 ? 2.1 : -2.1);
        return { id, name: NAMES[id], color: id === 0 ? color : COLORS[id], x: pos.x, z: pos.z,
          heading: pos.heading, velocityHeading: pos.heading, speed: 0, steer: 0, drift: false, driftBlend: 0, pullUp: 0, driftDir: 1, driftHold: 0,
          driftPhase: 'grip', driftBlocked: false, driftValidTime: 0, miniReady: 0, miniBoost: 0,
          driftTime: 0, charge: 0, nitro: 0, boost: 0, progress, nextGate: 0,
          lastS: mod(progress, track.length), lateral: id % 2 ? 2.1 : -2.1, lap: 1,
          finishTime: null, finishPlace: null, lapTimes: [], lapStart: 0, bump: 0,
          resetCooldown: 0, wrongWay: 0, missedGate: false, lastSafeProgress: progress,
          items: [], shield: 0, stun: 0, slip: 0, slipDir: 1, bubble: 0, magnet: 0, magnetTarget: -1, zap: 0, ufo: 0, aiItemCooldown: 0,
          aiLane: (id % 3 - 1) * 2.2, aiPace: this.difficulty.paceBase + id * this.difficulty.paceStep };
      });
    }
    get player() { return this.cars[0]; }
    start() { if (this.state === 'ready') this.state = 'countdown'; }
    pause() { if (this.state === 'racing' || this.state === 'countdown') { this.resumeState = this.state; this.state = 'paused'; } }
    resume() { if (this.state === 'paused') this.state = this.resumeState; }
    useNitro(car = this.player) {
      if (this.state !== 'racing' || car.finishTime !== null || car.nitro < 1 || car.boost > 0) return false;
      car.nitro--; car.boost = 2.3;
      this.events.push({ type: 'boost', id: car.id });
      return true;
    }
    rollItem(car) {
      const rank = this.standings().indexOf(car);
      const row = ITEM_TABLE.find(r => rank <= r.maxRank) || ITEM_TABLE[ITEM_TABLE.length - 1];
      let roll = this.rand() * 100;
      for (const item of ITEMS) { roll -= row.weights[item]; if (roll < 0) return item; }
      return 'banana';
    }
    swapItems(car = this.player) {
      if (this.state !== 'racing' || car.finishTime !== null || car.items.length < 2) return false;
      [car.items[0], car.items[1]] = [car.items[1], car.items[0]];
      return true;
    }
    discardItem(car = this.player) {
      if (this.state !== 'racing' || car.finishTime !== null || !car.items.length) return null;
      return car.items.shift();
    }
    useItem(car = this.player, result = null) {
      if (result) result.reason = null;
      const fail = reason => { if (result) result.reason = reason; return false; };
      if (this.state !== 'racing') return fail('not-racing');
      if (car.finishTime !== null) return fail('finished');
      if (!car.items.length) return fail('empty');
      const item = car.items.shift(), refund = reason => { car.items.unshift(item); return fail(reason); };
      if (item === 'nitro') {
        if (car.nitro >= 2) return refund('nitro-full');
        car.nitro++;
      } else if (item === 'shield') {
        car.shield = 6;
      } else if (item === 'banana') {
        this.hazards.push({ visualId: this.nextVisualId++, kind: 'banana', x: car.x, z: car.z, arm: 0.5, life: 40, from: car.id });
      } else if (item === 'water') {
        const p = sample(this.track, car.progress + 45, car.lateral);
        this.hazards.push({ visualId: this.nextVisualId++, originX: car.x, originZ: car.z, kind: 'water', x: p.x, z: p.z, arm: 0.8, blast: 0, from: car.id });
      } else if (item === 'magnet') {
        const target = this.cars.filter(c => c !== car && c.finishTime === null && c.progress > car.progress && c.progress - car.progress < 130).sort((a, b) => a.progress - b.progress)[0];
        if (!target) return refund('magnet-no-target');
        car.magnet = 2.4; car.magnetTarget = target.id;
      } else if (item === 'lightning') {
        const targets = this.cars.filter(c => c !== car && c.finishTime === null);
        if (!targets.length) return refund('no-target');
        for (const target of targets) this.applyHit(target, 'lightning', car.id);
      } else if (item === 'ufo') {
        const target = this.standings().find(c => c.finishTime === null);
        if (!target) return refund('no-target');
        if (target === car) return refund('ufo-leading');
        this.applyHit(target, 'ufo', car.id);
      } else if (item === 'missile') {
        const order = this.standings(), rank = order.indexOf(car);
        let target = rank > 0 ? order[rank - 1] : null;
        // Legend AI jump the queue: any in-range player takes priority over rank order.
        const pd = this.player.finishTime === null ? this.player.progress - car.progress : Infinity;
        if (this.difficulty.huntPlayer && pd > 0 && pd < 110) target = this.player;
        this.missiles.push({ visualId: this.nextVisualId++, originX: car.x, originZ: car.z, from: car.id, target: target ? target.id : -1, progress: car.progress, lateral: car.lateral, life: 4 });
        this.events.push({ type: 'missileLaunch', id: car.id, target: target ? target.id : -1 });
      }
      this.events.push({ type: 'itemUse', id: car.id, item });
      return true;
    }
    // Single funnel for item damage: shields block everything except bananas (KartRider rule).
    applyHit(car, kind, fromId = -1) {
      if (car.finishTime !== null) return false;
      if (kind !== 'banana' && car.shield > 0) {
        car.shield = 0; this.events.push({ type: 'itemBlock', id: car.id, item: kind, sourceId: fromId });
        return false;
      }
      if (kind === 'missile') { car.stun = 1.1; car.speed *= 0.35; }
      else if (kind === 'banana') { car.slip = 0.9; car.slipDir = car.steer >= 0 ? 1 : -1; car.speed *= 0.55; }
      else if (kind === 'water') car.bubble = 2;
      else if (kind === 'lightning') { car.zap = 1.6; car.speed *= 0.5; }
      else if (kind === 'ufo') { car.ufo = 3; car.speed *= 0.85; }
      car.miniReady = 0; car.miniBoost = 0; car.driftValidTime = 0;
      this.events.push({ type: 'itemHit', id: car.id, item: kind, from: fromId });
      return true;
    }
    // Deliberately simple triggers; a cooldown keeps item spam in check.
    aiItems(car) {
      if (car.aiItemCooldown > 0 || !car.items.length) return;
      car.aiItemCooldown = this.difficulty.itemCooldown;
      const item = car.items[0];
      const deltas = this.cars.filter(c => c !== car && c.finishTime === null).map(c => c.progress - car.progress);
      const nearestAhead = Math.min(...deltas.filter(d => d > 0)), nearestBehind = Math.max(...deltas.filter(d => d < 0));
      // Hunt-the-player tactics (legend only): lightning is held until the
      // player leads, and bananas cover a wider window when the player chases.
      const hunt = this.difficulty.huntPlayer && this.player.finishTime === null;
      const playerDelta = hunt ? this.player.progress - car.progress : Infinity;
      if (item === 'missile' && nearestAhead < 110) this.useItem(car);
      else if (item === 'water' && nearestAhead > 25 && nearestAhead < 75) this.useItem(car);
      else if (item === 'magnet' && nearestAhead < 130) this.useItem(car);
      else if (item === 'shield' && (this.missiles.some(m => m.target === car.id) || this.rand() < this.difficulty.shieldFire)) this.useItem(car);
      else if (item === 'banana' && ((nearestBehind > -25 && nearestBehind < -2) || (playerDelta > -40 && playerDelta < -2) || this.rand() < this.difficulty.bananaFire)) this.useItem(car);
      else if (item === 'lightning' && (playerDelta > 0 || !hunt)) this.useItem(car);
      else if (item === 'ufo') this.useItem(car);
      else if (item === 'nitro' && car.nitro < 2 && Math.abs(car.steer) < 0.15 && car.speed > 25) this.useItem(car);
    }
    updateItems(dt) {
      for (const box of this.boxes) {
        box.respawn = Math.max(0, box.respawn - dt);
        if (box.respawn > 0) continue;
        for (const car of this.cars) {
          if (car.finishTime !== null || car.items.length >= 2) continue;
          if (Math.hypot(car.x - box.x, car.z - box.z) < 2.3) {
            const item = this.rollItem(car);
            car.items.push(item); box.respawn = 4;
            this.events.push({ type: 'itemPickup', id: car.id, item });
            break;
          }
        }
      }
      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const h = this.hazards[i];
        if (h.arm > 0) {
          h.arm -= dt;
          if (h.kind === 'water' && h.arm <= 0) {
            h.blast = 0.5;
            for (const car of this.cars) if (Math.hypot(car.x - h.x, car.z - h.z) < 7) this.applyHit(car, 'water', h.from);
          }
        } else if (h.kind === 'banana') {
          h.life -= dt;
          for (const car of this.cars) {
            if (car.finishTime !== null) continue;
            if (Math.hypot(car.x - h.x, car.z - h.z) < 1.7) { this.applyHit(car, 'banana', h.from); h.life = 0; break; }
          }
          if (h.life <= 0) this.hazards.splice(i, 1);
        } else if (h.kind === 'water') { h.blast -= dt; if (h.blast <= 0) this.hazards.splice(i, 1); }
      }
      for (let i = this.missiles.length - 1; i >= 0; i--) {
        const m = this.missiles[i];
        m.life -= dt; m.progress += 72 * dt;
        const target = this.cars[m.target];
        if (target && target.finishTime === null) {
          m.lateral = approach(m.lateral, target.lateral, dt, 6);
          if (Math.abs(target.progress - m.progress) < 3 && Math.abs(target.lateral - m.lateral) < 2.2) { this.applyHit(target, 'missile', m.from); m.life = 0; }
        } else if (target) m.life = 0;
        if (m.life <= 0) this.missiles.splice(i, 1);
      }
      for (const car of this.cars) if (car.magnet <= 0) car.magnetTarget = -1;
    }
    resetCar(car = this.player) {
      if (this.state !== 'racing' || car.finishTime !== null || car.resetCooldown > 0) return false;
      // Reposition at or behind the last validated gate; reset cannot skip a gate.
      const gate = Math.max(0, car.nextGate - 1) * this.track.length / this.track.gateCount;
      const progress = Math.min(car.lastSafeProgress, gate + this.track.length / this.track.gateCount - 4);
      const p = sample(this.track, progress);
      Object.assign(car, { x: p.x, z: p.z, heading: p.heading, velocityHeading: p.heading, speed: 0, drift: false, driftBlend: 0, pullUp: 0, driftDir: 1, driftHold: 0,
        driftPhase: 'grip', driftBlocked: false, driftValidTime: 0, driftTime: 0, miniReady: 0, miniBoost: 0,
        progress, lastS: p.s, lateral: 0, boost: 0, resetCooldown: this.difficulty.resetCooldown, wrongWay: 0, missedGate: false,
        stun: 0, slip: 0, bubble: 0, magnet: 0, magnetTarget: -1, zap: 0, ufo: 0 });
      this.events.push({ type: 'reset', id: car.id });
      return true;
    }
    aiInput(car) {
      const here = sample(this.track, car.progress);
      const ahead = sample(this.track, car.progress + 12 + Math.max(0, car.speed) * 0.38, car.aiLane);
      const later = sample(this.track, car.progress + 34);
      const delta = angleDelta(Math.atan2(ahead.x - car.x, ahead.z - car.z), car.heading);
      const curve = Math.abs(angleDelta(later.heading, here.heading));
      // Rubber band: chase the player when behind them, ease off when ahead.
      // rubberGain is 0 on classic tiers, making this an exact identity there.
      const gap = this.player.progress - car.progress;
      const paceEff = car.aiPace * clamp(1 + gap * this.difficulty.rubberGain, this.difficulty.rubberMin, this.difficulty.rubberMax);
      const target = clamp(43 - curve * this.difficulty.cornerFactor, this.difficulty.cornerFloor, this.difficulty.aiTop) * paceEff;
      return { throttle: car.speed < target ? 1 : 0, brake: car.speed > target + 2, steer: clamp(delta * this.difficulty.steerGain, -1, 1), drift: curve > this.difficulty.driftCurveMin && curve < this.difficulty.driftCurveMax && car.speed > 21 && Math.abs(delta) < this.difficulty.driftDeltaMax };
    }
    step(dt, input = {}) {
      if (this.state === 'countdown') {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        if (Math.ceil(this.countdown) !== before) this.events.push({ type: 'count', value: Math.max(0, Math.ceil(this.countdown)) });
        if (this.countdown <= 0) { this.state = 'racing'; this.events.push({ type: 'go' }); }
        return;
      }
      if (this.state !== 'racing') return;
      this.elapsed += dt;
      for (const car of this.cars) {
        if (car.finishTime !== null) { car.speed *= Math.exp(-dt * 2); continue; }
        const controls = car.id === 0 ? input : this.aiInput(car);
        if (car.id && car.nitro && car.boost <= 0 && Math.abs(controls.steer) < this.difficulty.nitroSteer && car.speed > this.difficulty.nitroSpeed) this.useNitro(car);
        if (car.id) this.aiItems(car);
        this.drive(car, controls, dt);
      }
      this.collisions();
      for (const car of this.cars) {
        if (car.finishTime === null) this.updateProgress(car, dt);
      }
      this.updateItems(dt);
      if (this.player.finishTime !== null) { this.state = 'finished'; this.events.push({ type: 'finish' }); }
    }
    drive(car, input, dt) {
      car.bump = Math.max(0, car.bump - dt);
      car.resetCooldown = Math.max(0, car.resetCooldown - dt);
      car.boost = Math.max(0, car.boost - dt);
      car.stun = Math.max(0, car.stun - dt); car.slip = Math.max(0, car.slip - dt);
      car.bubble = Math.max(0, car.bubble - dt); car.magnet = Math.max(0, car.magnet - dt);
      car.shield = Math.max(0, car.shield - dt); car.aiItemCooldown = Math.max(0, car.aiItemCooldown - dt);
      car.zap = Math.max(0, car.zap - dt); car.ufo = Math.max(0, car.ufo - dt);
      car.pullUp = Math.max(0, car.pullUp - dt);
      const oldDrift = car.drift;
      const desiredSteer = car.stun > 0 ? 0 : clamp(Number(input.steer) || 0, -1, 1);
      // Player steering ramps up faster than AI: digital keys need a snappier lock.
      car.steer = approach(car.steer, car.slip > 0 ? car.slipDir : desiredSteer, dt, car.id === 0 ? 18 : 10);
      if (car.id === 0) {
        car.miniBoost = Math.max(0, car.miniBoost - dt);
        car.miniReady = Math.max(0, car.miniReady - dt);
        const controlled = car.stun <= 0 && car.slip <= 0 && car.bubble <= 0
          && car.zap <= 0 && car.ufo <= 0;
        const canDrift = controlled && car.speed > 14 && Math.abs(car.lateral) < this.track.width / 2;
        if (!input.drift) car.driftBlocked = false;
        if (!controlled) { car.driftPhase = 'grip'; car.pullUp = 0; }
        if (!canDrift || car.bump > 0) { car.miniReady = 0; car.miniBoost = 0; car.driftValidTime = 0; }
        if (oldDrift) {
          // Neutral steering briefly carries the arc; opposite input explicitly recovers.
          const relative = desiredSteer * car.driftDir;
          car.driftHold = relative > 0.16 ? 0.35 : Math.max(0, car.driftHold - dt);
          if (!input.drift || !canDrift || relative < -0.16 || car.driftHold <= 0) {
            car.drift = false;
            car.driftPhase = controlled ? 'recover' : 'grip';
            car.pullUp = controlled ? 0.3 : 0;
            car.driftBlocked = Boolean(input.drift);
            if (canDrift && car.bump <= 0 && car.driftValidTime >= 0.22 && !input.brake) car.miniReady = 0.8;
            car.driftValidTime = 0;
          }
        } else if (canDrift && input.drift && !car.driftBlocked && car.driftPhase !== 'recover'
          && Math.abs(desiredSteer) > 0.16) {
          car.drift = true; car.driftPhase = 'drift';
          car.driftDir = Math.sign(desiredSteer); car.driftHold = 0.35;
          car.heading += desiredSteer * 0.045;
          car.pullUp = 0; car.driftValidTime = 0; car.miniReady = 0; car.miniBoost = 0;
        }
        car.driftBlend = approach(car.driftBlend, car.drift ? 1 : 0, dt, car.drift ? 12 : 16);
      } else {
        // Computer handling is kept independent from the player's drift phases.
        car.drift = Boolean(input.drift && car.speed > 14 && Math.abs(car.lateral) < this.track.width / 2 && Math.abs(car.steer) > 0.16);
        car.driftBlend = car.drift ? 1 : 0;
      }
      const offroad = Math.abs(car.lateral) > this.track.width / 2;
      const top = car.bubble > 0 ? 12 : offroad ? this.difficulty.offroadTop : car.boost > 0 ? 61 : car.magnet > 0 ? 54 : car.miniBoost > 0 ? 50 : (car.id === 0 ? 42 : this.difficulty.aiTopCap);
      const throttle = clamp(Number(input.throttle) || 0, 0, 1);
      if (throttle && car.stun <= 0 && car.bubble <= 0) car.speed += (car.boost > 0 ? 34 : (car.miniBoost > 0 || car.magnet > 0) ? 30 : 20) * throttle * dt;
      else car.speed = approach(car.speed, 0, dt, 0.36);
      if (input.brake) car.speed -= (car.speed > 1 ? 42 : 12) * dt;
      car.speed -= car.speed * (0.06 + (car.id === 0 ? 0.06 : 0.1) * car.driftBlend) * dt;
      if (car.stun > 0) car.speed = approach(car.speed, 6, dt, 3);
      if (car.speed > top) car.speed = approach(car.speed, top, dt, offroad ? 4 : 2.8);
      // Lightning and UFO are hard ceilings: being zapped or dragged must feel firm.
      if (car.zap > 0) car.speed = Math.min(car.speed, 24);
      if (car.ufo > 0) car.speed = Math.min(car.speed, 30);
      car.speed = clamp(car.speed, -9, 64);
      if (Math.abs(car.speed) < 0.02) car.speed = 0;
      const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
      if (car.id === 0) {
        if (car.driftPhase === 'recover') {
          // Rotate the nose back toward travel, with a bounded angular speed.
          // Travel also converges below, so recovery never flips into an opposite drift.
          const gap = angleDelta(car.velocityHeading, car.heading);
          car.heading += clamp(gap * (1 - Math.exp(-18 * dt)), -2.8 * dt, 2.8 * dt);
          if (Math.abs(gap) < 0.025 || car.pullUp <= 0) car.driftPhase = 'grip';
        } else {
          const relative = car.drift ? clamp(car.steer * car.driftDir, 0, 1) : 0;
          const steering = car.drift ? car.driftDir * (0.24 + 0.76 * relative) : car.steer;
          const turnRate = (1.15 - clamp(Math.abs(car.speed) / 70, 0, 0.65)) * 1.25
            * (car.drift ? 1.8 : 1);
          car.heading += steering * turnRate * speedFactor * dt * (car.speed < 0 ? -1 : 1);
        }
        // Build slip with duration; a short tap remains shallow even on digital keys.
        const relative = clamp(car.steer * car.driftDir, 0, 1);
        const depth = (0.07 + 0.21 * clamp(car.driftTime / 0.55, 0, 1)) * (0.55 + 0.45 * relative);
        const target = car.heading - (car.drift ? car.driftDir * depth * car.driftBlend : 0);
        const followRate = car.drift ? 14 : 22;
        car.velocityHeading += angleDelta(target, car.velocityHeading) * (1 - Math.exp(-dt * followRate));
      } else {
        const turnRate = (1.15 - clamp(Math.abs(car.speed) / 70, 0, 0.65)) * (1 + 0.65 * car.driftBlend) * this.difficulty.turnBoost;
        car.heading += car.steer * turnRate * speedFactor * dt * (car.speed < 0 ? -1 : 1);
        const target = car.heading - car.steer * 0.37 * car.driftBlend;
        car.velocityHeading += angleDelta(target, car.velocityHeading) * (1 - Math.exp(-dt * (12 - 6.5 * car.driftBlend)));
      }
      car.x += Math.sin(car.velocityHeading) * car.speed * dt;
      car.z += Math.cos(car.velocityHeading) * car.speed * dt;
      if (car.drift) {
        car.driftTime += dt;
        const effectiveSlide = car.id !== 0 || (car.bump <= 0 && Math.abs(angleDelta(car.heading, car.velocityHeading)) > 0.06);
        if (car.id === 0 && effectiveSlide && !input.brake) car.driftValidTime += dt;
        if (car.nitro < 2 && effectiveSlide) {
          car.charge += dt * (22 + Math.abs(car.steer) * 12);
          if (car.charge >= 100) {
            car.charge -= 100; car.nitro++;
            this.events.push({ type: 'charged', id: car.id });
            if (car.nitro === 2) car.charge = 0;
          }
        }
      } else { car.driftTime = 0; }
      if (car.id === 0 && car.miniReady > 0 && !car.drift && car.driftPhase === 'grip'
        && throttle > 0 && !input.brake && Math.abs(angleDelta(car.heading, car.velocityHeading)) < 0.06) {
        car.miniReady = 0; car.miniBoost = 0.55;
        this.events.push({ type: 'miniBoost', id: car.id });
      }
      if (oldDrift && !car.drift && car.id === 0) this.events.push({ type: 'driftEnd', id: car.id });
    }
    collisions() {
      for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        if (a.finishTime !== null || b.finishTime !== null) continue;
        let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 2.25) {
          if (d < 0.001) { dx = 1; dz = 0; d = 1; }
          const push = (2.25 - d) / 2;
          a.x -= dx / d * push; a.z -= dz / d * push;
          b.x += dx / d * push; b.z += dz / d * push;
          a.miniReady = b.miniReady = a.miniBoost = b.miniBoost = a.driftValidTime = b.driftValidTime = 0;
          if (a.bump <= 0 && b.bump <= 0) {
            a.speed *= 0.87; b.speed *= 0.87; a.bump = b.bump = 0.6;
            this.events.push({ type: 'bump', id: a.id });
          }
        }
      }
    }
    updateProgress(car, dt) {
      let p = project(this.track, car.x, car.z), half = this.track.width / 2;
      car.lateral = p.lateral;
      if (Math.abs(p.lateral) >= half) { car.miniReady = 0; car.miniBoost = 0; car.driftValidTime = 0; }
      let delta = p.s - car.lastS;
      if (delta > this.track.length / 2) delta -= this.track.length;
      if (delta < -this.track.length / 2) delta += this.track.length;
      // Nearest-segment switches and teleports never grant race distance.
      if (Math.abs(delta) <= Math.max(5, Math.abs(car.speed) * dt * 2 + 1)) car.progress += delta;
      car.lastS = p.s;
      if (Math.abs(p.lateral) > half + 3.3) {
        const pos = sample(this.track, p.s, Math.sign(p.lateral) * (half + 3.25));
        car.x = pos.x; car.z = pos.z;
        if (car.bump <= 0) {
          car.miniReady = 0; car.miniBoost = 0; car.driftValidTime = 0;
          car.speed *= this.difficulty.wallKeep; car.bump = 0.7;
          this.events.push({ type: 'bump', id: car.id });
        }
        car.velocityHeading += angleDelta(p.heading, car.velocityHeading) * 0.24;
        // Re-project so gate checks below use the post-clamp position.
        p = project(this.track, car.x, car.z); car.lateral = p.lateral;
      }
      const gateSpacing = this.track.length / this.track.gateCount;
      const nextDistance = car.nextGate * gateSpacing;
      const crossedForward = delta > 0 && car.progress >= nextDistance && car.progress - delta < nextDistance;
      // Gate tolerance matches the physical wall (half + 3.3): any position the
      // car can actually reach counts, so running wide no longer silently misses a gate.
      if (crossedForward && Math.abs(p.lateral) <= half + 3.3) {
        if (car.nextGate > 0 && car.nextGate % this.track.gateCount === 0) {
          car.lapTimes.push(this.elapsed - car.lapStart); car.lapStart = this.elapsed;
          if (car.nextGate === this.track.gateCount * this.laps) {
            car.finishTime = this.elapsed; car.finishPlace = ++this.finishedCount;
            this.events.push({ type: 'carFinish', id: car.id });
          } else {
            car.lap++; this.events.push({ type: 'lap', id: car.id, lap: car.lap });
          }
        }
        car.nextGate++;
      }
      // Safe respawn only follows progress that has passed every preceding gate.
      if (Math.abs(p.lateral) < half && car.progress < car.nextGate * gateSpacing && car.progress > (car.nextGate - 1) * gateSpacing) car.lastSafeProgress = car.progress;
      car.missedGate = car.finishTime === null && car.progress > car.nextGate * gateSpacing + 4;
      car.wrongWay = car.speed > 4 && Math.cos(angleDelta(car.velocityHeading, p.heading)) < -0.35 ? car.wrongWay + dt : Math.max(0, car.wrongWay - dt * 2);
      if (car.id && (Math.abs(p.lateral) > half + 2 || car.wrongWay > 1.2 || car.missedGate)) this.resetCar(car);
    }
    standings() {
      const spacing = this.track.length / this.track.gateCount;
      const score = c => c.nextGate === 0 ? c.progress : Math.min(c.progress, c.nextGate * spacing);
      return [...this.cars].sort((a, b) => {
        if (a.finishTime !== null && b.finishTime !== null) return a.finishPlace - b.finishPlace;
        if (a.finishTime !== null) return -1;
        if (b.finishTime !== null) return 1;
        return score(b) - score(a) || a.id - b.id;
      });
    }
    drainEvents() { const events = this.events; this.events = []; return events; }
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const ms = Math.floor(Math.max(0, seconds) * 1000);
    return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  }
  const api = { Race, buildTrack, buildBoxes, sample, project, clamp, lerp, mod, angleDelta, approach, formatTime, COLORS, ITEMS, DIFFICULTY };
  root.KartCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
