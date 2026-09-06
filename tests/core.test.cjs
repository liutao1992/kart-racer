const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const TRACKS = require('../js/tracks.js').map(C.buildTrack);
const dt = 1 / 60;
function racing(track = TRACKS[0]) { const race = new C.Race(track); race.start(); for (let i = 0; i < 205; i++) race.step(dt); assert.equal(race.state, 'racing'); return race; }
function positionCar(race, s, offset = 0) { const p = C.sample(race.track, s, offset); Object.assign(race.player, { x: p.x, z: p.z, heading: p.heading, velocityHeading: p.heading }); }
const lcg = seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function itemRace(seed = 7, track = TRACKS[0]) { const race = new C.Race(track, '#f17b46', lcg(seed)); race.start(); for (let i = 0; i < 205; i++) race.step(dt); assert.equal(race.state, 'racing'); return race; }

test('all tracks are continuous, distinct, and have stable arc-length sampling', () => {
  assert.equal(new Set(TRACKS.map(t => t.length)).size, TRACKS.length);
  for (const track of TRACKS) {
    assert.ok(track.length > 600 && track.length < 1200);
    assert.ok(Math.abs(C.angleDelta(C.sample(track, 0.001).heading, C.sample(track, track.length - 0.001).heading)) < 0.01);
    for (let s = 0; s < track.length; s += 19) {
      const a = C.sample(track, s), b = C.sample(track, s + 1);
      assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 1) < 0.02);
      const p = C.project(track, a.x, a.z);
      assert.ok(p.distance < 0.01);
    }
  }
});
test('countdown prevents movement and pause freezes countdown and racing time', () => {
  const race = new C.Race(TRACKS[0]); race.start(); const before = { ...race.player };
  race.step(1, { throttle: 1 }); assert.equal(race.player.x, before.x); assert.equal(race.elapsed, 0);
  race.pause(); const countdown = race.countdown; race.step(1); assert.equal(race.countdown, countdown);
  race.resume(); for (let i = 0; i < 150; i++) race.step(dt);
  race.step(0.1, { throttle: 1 }); race.pause(); const snapshot = JSON.stringify(race.cars), elapsed = race.elapsed;
  race.step(1, { throttle: 1, steer: 1 }); assert.equal(JSON.stringify(race.cars), snapshot); assert.equal(race.elapsed, elapsed);
  race.resume(); race.step(dt, { throttle: 1 }); assert.ok(race.elapsed > elapsed);
});
test('stationary turning and drift without steering do not generate nitro', () => {
  const race = racing();
  for (let i = 0; i < 300; i++) race.step(dt, { drift: true, steer: 1 });
  assert.equal(race.player.charge, 0); assert.equal(race.player.nitro, 0);
  for (let i = 0; i < 120; i++) race.drive(race.player, { throttle: 1, drift: true, steer: 0 }, dt);
  assert.equal(race.player.charge, 0);
});
test('valid drift charges bottles, capacity is two, boost consumes one and expires', () => {
  const race = racing(), car = race.player;
  car.speed = 30;
  for (let i = 0; i < 600; i++) race.drive(car, { throttle: 1, drift: true, steer: 0.45 }, dt);
  assert.equal(car.nitro, 2); assert.equal(car.charge, 0);
  assert.equal(race.useNitro(), true); assert.equal(car.nitro, 1); assert.equal(race.useNitro(), false);
  for (let i = 0; i < 60; i++) race.drive(car, { throttle: 1 }, dt);
  assert.ok(car.speed > 50);
  for (let i = 0; i < 140; i++) race.drive(car, { throttle: 1 }, dt);
  assert.equal(car.boost, 0); assert.ok(car.speed < 50);
  race.pause(); assert.equal(race.useNitro(), false);
});
test('reverse across start then forward again never adds laps or duplicate gates', () => {
  const race = racing(), car = race.player;
  car.progress = -1; car.lastS = C.mod(-1, race.track.length); car.speed = 12;
  positionCar(race, 1); race.updateProgress(car, 0.2); assert.equal(car.nextGate, 1);
  positionCar(race, -1); race.updateProgress(car, 0.2);
  positionCar(race, 1); race.updateProgress(car, 0.2);
  assert.equal(car.nextGate, 1); assert.equal(car.lap, 1); assert.equal(car.lapTimes.length, 0);
});
test('teleporting or skipping gates grants no lap; reset preserves validated progress', () => {
  const race = racing(), car = race.player;
  car.progress = 8; car.lastS = 8; car.nextGate = 1; car.lastSafeProgress = 8;
  positionCar(race, race.track.length - 1); race.updateProgress(car, dt);
  assert.equal(car.nextGate, 1); assert.equal(car.lap, 1); assert.ok(car.progress < 20);
  assert.equal(race.resetCar(), true); assert.ok(Math.abs(car.progress - 8) < 0.1);
  assert.equal(car.nextGate, 1); assert.equal(car.speed, 0); assert.equal(race.resetCar(), false);
});
test('crossing a checkpoint while running wide still counts up to the guardrail', () => {
  const race = racing(), car = race.player, gate = race.track.length / race.track.gateCount;
  car.nextGate = 1; car.progress = gate - 1; car.lastS = gate - 1; car.speed = 15;
  positionCar(race, gate + 1, race.track.width / 2 + 2);
  race.updateProgress(car, 0.2); assert.equal(car.nextGate, 2);
  // Even a guardrail-clamped crossing counts: the bump is punishment enough.
  car.nextGate = 1; car.progress = gate - 1; car.lastS = gate - 1;
  positionCar(race, gate + 1, race.track.width / 2 + 4);
  race.updateProgress(car, 0.2); assert.equal(car.nextGate, 2);
});
test('car contact and guardrails slow vehicles and keep positions finite', () => {
  const race = racing(), a = race.player, b = race.cars[1];
  a.speed = b.speed = 30; b.x = a.x + 0.5; b.z = a.z;
  race.collisions(); assert.ok(a.speed < 30); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2.24);
  // A new wall contact after the collision debounce interval.
  for (let i = 0; i < 45; i++) race.drive(a, {}, dt);
  positionCar(race, 20, race.track.width); a.speed = 30;
  race.updateProgress(a, dt); assert.ok(a.speed < 20); assert.ok(C.project(race.track, a.x, a.z).distance < race.track.width / 2 + 3.4);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z));
});
test('standings prioritize finish order, then validated race progress', () => {
  const race = racing(); race.cars[2].finishTime = 60; race.cars[2].finishPlace = 1;
  race.cars[4].finishTime = 62; race.cars[4].finishPlace = 2;
  race.player.progress = 300; race.player.nextGate = 1;
  race.cars[3].progress = 100; race.cars[3].nextGate = 2;
  assert.deepEqual(race.standings().slice(0, 3).map(c => c.id), [2, 4, 3]);
});
for (const track of TRACKS) {
  test(`${track.id}: all five computer drivers finish three laps without invalid gates`, () => {
    const race = itemRace(track.level * 31 + 5, track);
    for (let i = 0; i < 60 * 200 && race.finishedCount < 5; i++) race.step(dt);
    assert.equal(race.finishedCount, 5);
    for (const car of race.cars.slice(1)) { assert.equal(car.nextGate, 37); assert.equal(car.lapTimes.length, 3); assert.ok(car.finishTime < 200); }
    assert.equal(new Set(race.cars.slice(1).map(c => c.finishPlace)).size, 5);
  });
}
test('a driven race reaches final results once, lap times sum to total, replay is clean', () => {
  const race = itemRace(19);
  for (let i = 0; i < 60 * 200 && race.state !== 'finished'; i++) race.step(dt, race.aiInput(race.player));
  assert.equal(race.state, 'finished'); assert.equal(race.player.lapTimes.length, 3);
  assert.ok(Math.abs(race.player.lapTimes.reduce((a, b) => a + b, 0) - race.elapsed) < 1e-8);
  assert.equal(race.drainEvents().filter(e => e.type === 'finish').length, 1);
  race.step(dt, { throttle: 1 }); assert.equal(race.drainEvents().length, 0);
  const replay = new C.Race(race.track); assert.equal(replay.player.nitro, 0); assert.equal(replay.elapsed, 0); assert.equal(replay.player.lap, 1); assert.equal(replay.finishedCount, 0);
});
test('time formatting handles invalid, minute boundaries, and zero values', () => {
  assert.equal(C.formatTime(0), '00:00.000'); assert.equal(C.formatTime(61.234), '01:01.234'); assert.equal(C.formatTime(NaN), '—');
});
test('item boxes line every track in rows, on the surface, clear of the grid', () => {
  for (const track of TRACKS) {
    const boxes = C.buildBoxes(track);
    assert.ok(boxes.length >= 9 && boxes.length % 3 === 0);
    for (const b of boxes) {
      const p = C.project(track, b.x, b.z);
      assert.ok(Math.abs(p.lateral) < track.width / 2);
      assert.ok(p.s > 50 && p.s < track.length - 10);
    }
  }
});
test('driving over an item box grants an item and the box respawns after four seconds', () => {
  const race = itemRace(), car = race.player, box = race.boxes[0];
  Object.assign(car, { x: box.x, z: box.z });
  race.updateItems(dt);
  assert.equal(car.items.length, 1); assert.ok(C.ITEMS.includes(car.items[0])); assert.equal(box.respawn, 4);
  assert.ok(race.drainEvents().some(e => e.type === 'itemPickup' && e.id === 0));
  race.updateItems(dt); assert.equal(car.items.length, 1);
  for (let i = 0; i < 250; i++) race.updateItems(dt);
  assert.equal(car.items.length, 2);
});
test('a full two-slot inventory leaves the box for rivals', () => {
  const race = itemRace(), car = race.player, box = race.boxes[0];
  car.items = ['banana', 'banana'];
  Object.assign(car, { x: box.x, z: box.z });
  race.updateItems(dt);
  assert.deepEqual(car.items, ['banana', 'banana']); assert.equal(box.respawn, 0);
});
test('items are used oldest-first and an empty inventory refuses', () => {
  const race = itemRace(), car = race.player;
  assert.equal(race.useItem(), false);
  car.items = ['shield', 'nitro'];
  assert.equal(race.useItem(), true);
  assert.equal(car.shield, 6); assert.deepEqual(car.items, ['nitro']);
});
test('item rolls are deterministic per seed and favor attack items when trailing', () => {
  const seq = seed => { const race = itemRace(seed); return Array.from({ length: 20 }, () => race.rollItem(race.player)).join(','); };
  assert.equal(seq(11), seq(11)); assert.notEqual(seq(11), seq(12));
  const tally = r => { const t = { missile: 0, banana: 0, water: 0, magnet: 0, shield: 0, nitro: 0 }; for (let i = 0; i < 600; i++) t[r.rollItem(r.player)]++; return t; };
  const race = itemRace(5);
  race.player.progress = -100; race.cars.slice(1).forEach((c, i) => { c.progress = i * 10; });
  const last = tally(race);
  assert.ok(last.missile > last.banana * 3); assert.ok(last.missile + last.water + last.magnet > 300);
  race.player.progress = 1000;
  const lead = tally(race);
  assert.ok(lead.banana + lead.shield > lead.missile * 5);
});
test('a missile hunts the car ahead and stuns it', () => {
  const race = itemRace(), car = race.player, target = race.cars[1];
  car.progress = 100; target.progress = 130; race.cars.slice(2).forEach(c => { c.progress = 0; });
  car.items = ['missile'];
  assert.equal(race.useItem(), true);
  assert.equal(race.missiles.length, 1); assert.equal(race.missiles[0].target, 1);
  for (let i = 0; i < 180; i++) race.updateItems(dt);
  assert.ok(target.stun > 0); assert.equal(race.missiles.length, 0);
  assert.ok(race.drainEvents().some(e => e.type === 'itemHit' && e.id === 1 && e.item === 'missile' && e.from === 0));
});
test('a shield blocks one missile and is consumed', () => {
  const race = itemRace(), car = race.player, target = race.cars[1];
  car.progress = 100; target.progress = 130; race.cars.slice(2).forEach(c => { c.progress = 0; });
  target.shield = 6; car.items = ['missile'];
  race.useItem();
  for (let i = 0; i < 180; i++) race.updateItems(dt);
  assert.equal(target.stun, 0); assert.equal(target.shield, 0);
  assert.ok(race.drainEvents().some(e => e.type === 'itemBlock' && e.id === 1));
});
test('a missile fired by the leader flies straight and expires', () => {
  const race = itemRace(), car = race.player;
  car.progress = 500; race.cars.slice(1).forEach(c => { c.progress = 0; });
  car.items = ['missile']; race.useItem();
  assert.equal(race.missiles[0].target, -1);
  for (let i = 0; i < 250; i++) race.updateItems(dt);
  assert.equal(race.missiles.length, 0); assert.ok(race.cars.every(c => c.stun === 0));
});
test('bananas spin out rivals after a short arming delay and force their steering', () => {
  const race = itemRace(), car = race.player, victim = race.cars[2];
  car.items = ['banana'];
  positionCar(race, 200); car.progress = 200;
  assert.equal(race.useItem(), true); assert.equal(race.hazards.length, 1);
  const banana = race.hazards[0];
  race.updateItems(dt); race.updateItems(dt); assert.equal(race.hazards.length, 1);
  positionCar(race, 220); car.progress = 220;
  Object.assign(victim, { x: banana.x, z: banana.z, speed: 30, steer: 0 });
  for (let i = 0; i < 40; i++) race.updateItems(dt);
  assert.ok(victim.slip > 0); assert.ok(victim.speed < 20); assert.equal(race.hazards.length, 0);
  assert.ok(race.drainEvents().some(e => e.type === 'itemHit' && e.item === 'banana' && e.id === 2));
  victim.steer = 0; race.drive(victim, { steer: -1 }, dt);
  assert.equal(Math.sign(victim.steer), victim.slipDir);
});
test('water bombs trap cars near the landing point and a shield blocks the bubble', () => {
  const race = itemRace(), car = race.player, near = race.cars[2], far = race.cars[3], blocker = race.cars[4];
  car.items = ['water'];
  positionCar(race, 300); car.progress = 300; car.lateral = 0;
  const landing = C.sample(race.track, 345, 0);
  Object.assign(near, { x: landing.x, z: landing.z, speed: 30 });
  const off = C.sample(race.track, 345, 12);
  Object.assign(far, { x: off.x, z: off.z, speed: 30 });
  Object.assign(blocker, { x: landing.x + 2, z: landing.z, shield: 6 });
  assert.equal(race.useItem(), true);
  for (let i = 0; i < 55; i++) race.updateItems(dt);
  assert.ok(near.bubble > 0); assert.equal(far.bubble, 0);
  assert.equal(blocker.bubble, 0); assert.equal(blocker.shield, 0);
  assert.ok(race.drainEvents().some(e => e.type === 'itemBlock' && e.id === 4));
  near.speed = 20;
  for (let i = 0; i < 60; i++) race.drive(near, { throttle: 1 }, dt);
  assert.ok(near.speed < 14);
});
test('magnet boosts toward a car ahead and is refunded with no target', () => {
  const race = itemRace(), car = race.player;
  car.progress = 100; race.cars.slice(1).forEach(c => { c.progress = 0; });
  race.cars[3].progress = 180;
  car.items = ['magnet'];
  assert.equal(race.useItem(), true);
  assert.ok(car.magnet > 0); assert.equal(car.magnetTarget, 3);
  // Magnet's terminal (~63) sits well above the cruise equilibrium (~48).
  car.speed = 50; car.lateral = 0;
  for (let i = 0; i < 90; i++) race.drive(car, { throttle: 1 }, dt);
  assert.ok(car.speed > 58);
  for (let i = 0; i < 300; i++) race.drive(car, { throttle: 1 }, dt);
  assert.ok(car.speed < 50);
  race.cars.forEach(c => { if (c !== car) c.finishTime = 1; });
  car.items = ['magnet'];
  assert.equal(race.useItem(), false); assert.deepEqual(car.items, ['magnet']);
});
test('the nitro item refills a bottle and is refunded at full capacity', () => {
  const race = itemRace(), car = race.player;
  car.nitro = 0; car.items = ['nitro'];
  assert.equal(race.useItem(), true); assert.equal(car.nitro, 1);
  car.nitro = 2; car.items = ['nitro'];
  assert.equal(race.useItem(), false); assert.deepEqual(car.items, ['nitro']);
});
test('a chaotic item race still finishes with every state finite', () => {
  const race = itemRace(3);
  let sawHit = false;
  for (let i = 0; i < 60 * 240; i++) {
    race.step(dt);
    if (race.events.some(e => e.type === 'itemHit')) sawHit = true;
    race.drainEvents();
    if (i % 600 === 599) race.cars.forEach(c => { if (c.id && c.items.length < 2) c.items.push('missile'); });
    if (race.cars.slice(1).every(c => c.finishTime !== null)) break;
  }
  assert.ok(sawHit);
  assert.ok(race.cars.slice(1).every(c => c.finishTime !== null));
  assert.ok(race.cars.every(c => Number.isFinite(c.x) && Number.isFinite(c.speed) && Number.isFinite(c.progress)));
});
test('resetting clears control debuffs but keeps the inventory', () => {
  const race = itemRace(), car = race.player;
  car.items = ['shield']; car.stun = 1; car.bubble = 1; car.slip = 1; car.magnet = 1; car.magnetTarget = 2;
  assert.equal(race.resetCar(), true);
  assert.equal(car.stun + car.bubble + car.slip + car.magnet, 0); assert.equal(car.magnetTarget, -1);
  assert.deepEqual(car.items, ['shield']);
});
test('pausing freezes boxes, hazards, and missiles along with the cars', () => {
  const race = itemRace();
  race.player.items = ['missile', 'water']; race.player.progress = 100;
  race.useItem(); race.useItem();
  race.boxes[0].respawn = 2;
  const snapshot = JSON.stringify([race.boxes, race.hazards, race.missiles]);
  race.pause(); race.step(1); race.step(1);
  assert.equal(JSON.stringify([race.boxes, race.hazards, race.missiles]), snapshot);
});
test('lightning zaps every unfinished opponent and a shield blocks it', () => {
  const race = itemRace(), car = race.player;
  race.cars.slice(1).forEach(c => { c.speed = 30; });
  race.cars[5].shield = 6; race.cars[4].finishTime = 1;
  car.items = ['lightning'];
  assert.equal(race.useItem(), true);
  assert.ok(race.cars[1].zap > 0 && race.cars[1].speed <= 15.1);
  assert.equal(race.cars[5].zap, 0); assert.equal(race.cars[5].shield, 0);
  assert.equal(race.cars[4].zap, 0);
  assert.ok(race.drainEvents().some(e => e.type === 'itemBlock' && e.id === 5));
  // Zap caps top speed at 24 even under full throttle.
  race.cars[1].speed = 30;
  for (let i = 0; i < 60; i++) race.drive(race.cars[1], { throttle: 1 }, dt);
  assert.ok(race.cars[1].speed < 27);
  // No valid targets left -> refund.
  race.cars.forEach(c => { if (c !== car) c.finishTime = 1; });
  car.items = ['lightning'];
  assert.equal(race.useItem(), false); assert.deepEqual(car.items, ['lightning']);
});
test('a UFO latches onto the leader and drags their top speed down', () => {
  const race = itemRace(), car = race.player, leader = race.cars[2];
  race.cars.slice(1).forEach(c => { c.progress = 10; });
  leader.progress = 400; leader.speed = 40; car.progress = 0;
  car.items = ['ufo'];
  assert.equal(race.useItem(), true);
  assert.ok(leader.ufo > 0); assert.ok(leader.speed < 40);
  for (let i = 0; i < 90; i++) race.drive(leader, { throttle: 1 }, dt);
  assert.ok(leader.speed < 33);
  // The leader using one has no target -> refund.
  leader.items = ['ufo']; leader.ufo = 0;
  assert.equal(race.useItem(leader), false); assert.deepEqual(leader.items, ['ufo']);
});
test('lightning and UFO only show up for midfield and trailing drivers', () => {
  const race = itemRace(9);
  race.player.progress = -100; race.cars.slice(1).forEach((c, i) => { c.progress = i * 10; });
  const last = { lightning: 0, ufo: 0 };
  for (let i = 0; i < 600; i++) { const item = race.rollItem(race.player); if (item in last) last[item]++; }
  assert.ok(last.lightning + last.ufo > 60);
  race.player.progress = 1000;
  for (let i = 0; i < 600; i++) assert.notEqual(race.rollItem(race.player), 'ufo');
});

// --- Difficulty tiers ---
function diffRace(track, diff, seed = 7) {
  const race = new C.Race(track, '#f17b46', lcg(seed), diff);
  race.start(); for (let i = 0; i < 205; i++) race.step(dt);
  return race;
}
function simWorstAi(track, diff) {
  const race = diffRace(track, diff, track.level * 31 + 5);
  for (let i = 0; i < 60 * 200 && race.finishedCount < 5; i++) race.step(dt);
  assert.equal(race.finishedCount, 5);
  return Math.max(...race.cars.slice(1).map(c => c.finishTime));
}
test('difficulty: default and explicit normal share identical AI pacing', () => {
  const expected = [0.83, 0.851, 0.872, 0.893, 0.914, 0.935];
  for (const race of [new C.Race(TRACKS[0]), new C.Race(TRACKS[0], C.COLORS[0], Math.random, 'normal')]) {
    assert.equal(race.difficultyKey, 'normal');
    race.cars.forEach((car, id) => assert.ok(Math.abs(car.aiPace - expected[id]) < 1e-9));
  }
});
test('difficulty: an unknown key falls back to normal', () => {
  const race = new C.Race(TRACKS[0], C.COLORS[0], Math.random, 'insane');
  assert.equal(race.difficultyKey, 'normal');
  assert.equal(race.difficulty, C.DIFFICULTY.normal);
});
test('difficulty: master AI outrun normal AI on the same track and seed', () => {
  // Neon has the longest straights, where the pace gap shows most clearly.
  const neon = TRACKS.find(t => t.id === 'neon');
  const normal = simWorstAi(neon, 'normal'), master = simWorstAi(neon, 'master');
  assert.ok(master < normal - 3, `master ${master.toFixed(1)} should clearly beat normal ${normal.toFixed(1)}`);
});
test('difficulty: master AI still finish three laps inside the sim budget (volcano worst case)', () => {
  const volcano = TRACKS.find(t => t.id === 'volcano');
  const race = diffRace(volcano, 'master', volcano.level * 31 + 5);
  for (let i = 0; i < 60 * 200 && race.finishedCount < 5; i++) race.step(dt);
  assert.equal(race.finishedCount, 5);
  for (const car of race.cars.slice(1)) assert.ok(car.finishTime < 200);
});
test('difficulty: mistake penalties scale — offroad top speed, wall impact, reset lockout', () => {
  const offroadSpeeds = {};
  for (const diff of ['easy', 'normal', 'master']) {
    const race = diffRace(TRACKS[0], diff), car = race.player;
    car.lateral = race.track.width / 2 + 1; car.speed = 40;
    for (let i = 0; i < 300; i++) { race.drive(car, { throttle: 1 }, dt); car.lateral = race.track.width / 2 + 1; }
    offroadSpeeds[diff] = car.speed;
    const wall = diffRace(TRACKS[0], diff), w = wall.player;
    positionCar(wall, 20, wall.track.width); w.speed = 30;
    wall.updateProgress(w, dt);
    if (diff === 'master') assert.ok(w.speed < 14, `master wall should nearly stop the car, got ${w.speed.toFixed(1)}`);
    wall.resetCar();
    assert.equal(wall.player.resetCooldown, C.DIFFICULTY[diff].resetCooldown);
  }
  assert.ok(offroadSpeeds.master < offroadSpeeds.normal && offroadSpeeds.normal < offroadSpeeds.easy);
  assert.ok(offroadSpeeds.master < 21.5 && offroadSpeeds.easy > 24);
});
test('difficulty: master AI re-fire items much sooner than normal AI', () => {
  const cooldowns = {};
  for (const diff of ['easy', 'normal', 'master']) {
    const race = diffRace(TRACKS[0], diff), ai = race.cars[1];
    ai.items = ['lightning'];
    race.aiItems(ai);
    cooldowns[diff] = ai.aiItemCooldown;
  }
  assert.equal(cooldowns.easy, 1.15);
  assert.equal(cooldowns.normal, 0.9);
  assert.equal(cooldowns.master, 0.55);
});

// --- Legend tier: smarter, faster, and out to get the player ---
test('difficulty: legend config is complete and classic tiers keep default smart-driving keys', () => {
  for (const tier of ['easy', 'normal', 'master']) {
    const d = C.DIFFICULTY[tier];
    assert.deepEqual([d.aiTopCap, d.rubberGain, d.rubberMin, d.rubberMax, d.steerGain, d.nitroSteer, d.nitroSpeed, d.huntPlayer],
      [42, 0, 1, 1, 2.2, 0.15, 25, false]);
  }
  const d = C.DIFFICULTY.legend;
  assert.equal(d.aiTopCap, 44.5); assert.ok(d.rubberGain > 0); assert.equal(d.huntPlayer, true);
  assert.equal(new C.Race(TRACKS[0], C.COLORS[0], Math.random, 'legend').difficultyKey, 'legend');
});
test('difficulty: legend AI break the classic 42 top speed that caps the player', () => {
  const race = diffRace(TRACKS[0], 'legend');
  let aiMax = 0, playerMax = 0;
  for (let i = 0; i < 900; i++) {
    race.step(dt, { throttle: 1 });
    for (const c of race.cars.slice(1)) if (c.boost <= 0) aiMax = Math.max(aiMax, c.speed);
    if (race.player.boost <= 0) playerMax = Math.max(playerMax, race.player.speed);
  }
  assert.ok(aiMax > 42.5, `legend AI should beat the classic 42 cap, got ${aiMax.toFixed(2)}`);
  assert.ok(playerMax <= 43, `player stays at the classic cap, got ${playerMax.toFixed(2)}`);
});
test('difficulty: legend AI outrun master AI on the same track and seed', () => {
  const neon = TRACKS.find(t => t.id === 'neon');
  const master = simWorstAi(neon, 'master'), legend = simWorstAi(neon, 'legend');
  assert.ok(legend < master - 3, `legend ${legend.toFixed(1)} should clearly beat master ${master.toFixed(1)}`);
});
test('difficulty: legend AI still finish three laps inside the sim budget (volcano worst case)', () => {
  const volcano = TRACKS.find(t => t.id === 'volcano');
  const race = diffRace(volcano, 'legend', volcano.level * 31 + 5);
  for (let i = 0; i < 60 * 200 && race.finishedCount < 5; i++) race.step(dt);
  assert.equal(race.finishedCount, 5);
  for (const car of race.cars.slice(1)) assert.ok(car.finishTime < 200);
});
test('difficulty: legend rubber band — faster when chasing the player, floored when far ahead', () => {
  const coast = TRACKS[0];
  const probe = gapSetup => {
    const race = diffRace(coast, 'legend', 1);
    const ai = race.cars[5];
    for (let i = 0; i < 600; i++) { race.step(dt); race.player.progress = ai.progress + gapSetup; }
    return ai.speed;
  };
  const chasing = probe(150), leading = probe(-150), farAhead = probe(-5000);
  assert.ok(chasing > leading + 3, `chasing ${chasing.toFixed(1)} should clearly beat leading ${leading.toFixed(1)}`);
  assert.ok(Math.abs(farAhead - leading) < 1, `rubber floor clamps: ${farAhead.toFixed(1)} vs ${leading.toFixed(1)}`);
  // Classic tiers have no rubber band at all.
  const flat = gapSetup => {
    const race = diffRace(coast, 'normal', 1);
    const ai = race.cars[5];
    for (let i = 0; i < 600; i++) { race.step(dt); race.player.progress = ai.progress + gapSetup; }
    return ai.speed;
  };
  assert.ok(Math.abs(flat(150) - flat(-150)) < 1, 'normal tier pace ignores the player gap');
});
test('difficulty: legend items hunt the player — missile queue-jump, held lightning, wider banana window', () => {
  const coast = TRACKS[0], still = () => 0.99; // random fire never triggers
  // Missile: another AI is the rank-above target, but the player is in range.
  for (const diff of ['normal', 'legend']) {
    const race = diffRace(coast, diff, 1); race.rand = still;
    const ai = race.cars[1];
    race.player.progress = ai.progress + 100; race.cars[2].progress = ai.progress + 30;
    for (const c of race.cars.slice(3)) c.progress = ai.progress - 50;
    ai.items = ['missile']; race.aiItems(ai);
    assert.equal(race.missiles[0].target, diff === 'legend' ? 0 : 2, `${diff} missile target`);
  }
  // Lightning: legend holds it until the player leads; normal fires instantly.
  for (const diff of ['normal', 'legend']) {
    const race = diffRace(coast, diff, 1); race.rand = still;
    const ai = race.cars[1];
    race.player.progress = ai.progress - 50;
    ai.items = ['lightning']; race.aiItems(ai);
    assert.equal(ai.items.length, diff === 'legend' ? 1 : 0, `${diff} lightning while player behind`);
    race.player.progress = ai.progress + 50; ai.aiItemCooldown = 0; race.aiItems(ai);
    assert.equal(ai.items.length, 0, `${diff} lightning once player leads`);
  }
  // Banana: the player 35 behind is outside the classic 25-window, inside legend's 40.
  for (const diff of ['normal', 'legend']) {
    const race = diffRace(coast, diff, 1); race.rand = still;
    const ai = race.cars[1];
    race.player.progress = ai.progress - 35;
    for (const c of race.cars.slice(2)) c.progress = ai.progress + 200;
    ai.items = ['banana']; race.aiItems(ai);
    assert.equal(race.hazards.length > 0, diff === 'legend', `${diff} banana for chasing player`);
  }
});
test('difficulty: legend mistakes hurt more — wall, offroad, reset lockout', () => {
  const race = diffRace(TRACKS[0], 'legend'), car = race.player;
  car.lateral = race.track.width / 2 + 1; car.speed = 40;
  for (let i = 0; i < 300; i++) { race.drive(car, { throttle: 1 }, dt); car.lateral = race.track.width / 2 + 1; }
  assert.ok(car.speed < 19.5, `legend offroad should crawl below master's 20.5, got ${car.speed.toFixed(1)}`);
  const wall = diffRace(TRACKS[0], 'legend'), w = wall.player;
  positionCar(wall, 20, wall.track.width); w.speed = 30;
  wall.updateProgress(w, dt);
  assert.ok(w.speed < 12.5, `legend wall should nearly stop the car, got ${w.speed.toFixed(1)}`);
  wall.resetCar();
  assert.equal(wall.player.resetCooldown, 3.0);
});
