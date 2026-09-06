// Track geometry and AI-pace validation. Fast gate before unit/e2e suites:
// catches Catmull-Rom self-intersection, sharp openings, and tracks too slow
// for the AI to finish three laps inside the test budget.
'use strict';
const assert = require('node:assert');
const C = require('../js/core.js');
const configs = require('../js/tracks.js');

const dt = 1 / 60;
const lcg = seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const tracks = configs.map(C.buildTrack);
assert.equal(new Set(tracks.map(t => t.length)).size, tracks.length, 'track lengths must be distinct');
assert.equal(new Set(configs.map(t => t.id)).size, configs.length, 'track ids must be distinct');

for (const track of tracks) {
  assert.ok(track.length > 600 && track.length < 1200, `${track.id}: length ${track.length.toFixed(1)} outside (600, 1200)`);
  assert.deepEqual(track.points[0], [0, 0], `${track.id}: points[0] must be [0, 0] (start line)`);
  assert.ok(track.points[1][1] > 0, `${track.id}: opening must head toward +Z`);

  const openTurn = Math.abs(C.angleDelta(C.sample(track, 30).heading, C.sample(track, 2).heading));
  assert.ok(openTurn < 0.15, `${track.id}: opening bends ${openTurn.toFixed(3)} rad over s=2..30 (gantry zone)`);

  // Corridor separation: any two samples at least 60 arc-units apart must be far
  // enough apart in space for both corridors' guardrails (width/2 + 3.3 each side).
  const minSep = 2 * (track.width / 2 + 3.3);
  let worst = Infinity, worstPair = null;
  const S = track.samples, n = S.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const arc = Math.min((j - i) / n * track.length, track.length - (j - i) / n * track.length);
    if (arc < 60) continue;
    const d = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
    if (d < worst) { worst = d; worstPair = [S[i].s.toFixed(0), S[j].s.toFixed(0)]; }
  }
  assert.ok(worst >= minSep, `${track.id}: corridors ${worst.toFixed(1)} apart at s=${worstPair} (need >= ${minSep.toFixed(1)})`);

  // AI pace: all five computer drivers must finish three laps under 200s sim time.
  const race = new C.Race(track, '#f17b46', lcg(track.level * 31 + 5));
  race.start();
  for (let i = 0; i < 205; i++) race.step(dt);
  assert.equal(race.state, 'racing', `${track.id}: countdown never ended`);
  for (let i = 0; i < 60 * 200 && race.finishedCount < 5; i++) race.step(dt);
  assert.equal(race.finishedCount, 5, `${track.id}: AI never finished`);
  const slowest = Math.max(...race.cars.slice(1).map(c => c.finishTime));
  assert.ok(slowest < 200, `${track.id}: slowest AI ${slowest.toFixed(1)}s >= 200s`);
  console.log(`${track.id.padEnd(8)} len=${track.length.toFixed(1).padStart(7)} openTurn=${openTurn.toFixed(3)} corridor=${worst.toFixed(1).padStart(5)} aiWorst=${slowest.toFixed(1)}s`);
}
console.log(`${tracks.length} tracks OK`);
