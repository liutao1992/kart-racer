const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const TRACKS = require('../js/tracks.js').map(C.buildTrack);
const dt = 1 / 60;
function racing(track = TRACKS[0]) { const race = new C.Race(track); race.start(); for (let i = 0; i < 205; i++) race.step(dt); assert.equal(race.state, 'racing'); return race; }
function positionCar(race, s, offset = 0) { const p = C.sample(race.track, s, offset); Object.assign(race.player, { x: p.x, z: p.z, heading: p.heading, velocityHeading: p.heading }); }

test('three tracks are continuous, distinct, and have stable arc-length sampling', () => {
  assert.equal(new Set(TRACKS.map(t => t.length)).size, 3);
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
test('crossing a checkpoint outside the race surface does not count', () => {
  const race = racing(), car = race.player, gate = race.track.length / race.track.gateCount;
  car.nextGate = 1; car.progress = gate - 1; car.lastS = gate - 1; car.speed = 15;
  positionCar(race, gate + 1, race.track.width / 2 + 2);
  race.updateProgress(car, 0.2); assert.equal(car.nextGate, 1);
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
    const race = racing(track);
    for (let i = 0; i < 60 * 160 && race.finishedCount < 5; i++) race.step(dt);
    assert.equal(race.finishedCount, 5);
    for (const car of race.cars.slice(1)) { assert.equal(car.nextGate, 37); assert.equal(car.lapTimes.length, 3); assert.ok(car.finishTime < 160); }
    assert.equal(new Set(race.cars.slice(1).map(c => c.finishPlace)).size, 5);
  });
}
test('a driven race reaches final results once, lap times sum to total, replay is clean', () => {
  const race = racing();
  for (let i = 0; i < 60 * 180 && race.state !== 'finished'; i++) race.step(dt, race.aiInput(race.player));
  assert.equal(race.state, 'finished'); assert.equal(race.player.lapTimes.length, 3);
  assert.ok(Math.abs(race.player.lapTimes.reduce((a, b) => a + b, 0) - race.elapsed) < 1e-8);
  assert.equal(race.drainEvents().filter(e => e.type === 'finish').length, 1);
  race.step(dt, { throttle: 1 }); assert.equal(race.drainEvents().length, 0);
  const replay = new C.Race(race.track); assert.equal(replay.player.nitro, 0); assert.equal(replay.elapsed, 0); assert.equal(replay.player.lap, 1); assert.equal(replay.finishedCount, 0);
});
test('time formatting handles invalid, minute boundaries, and zero values', () => {
  assert.equal(C.formatTime(0), '00:00.000'); assert.equal(C.formatTime(61.234), '01:01.234'); assert.equal(C.formatTime(NaN), '—');
});
