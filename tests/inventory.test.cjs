const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const track = C.buildTrack(require('../js/tracks.js')[0]);
function setup() {
  let randomCalls = 0;
  const race = new C.Race(track, '#f17b46', () => { randomCalls++; return .5; });
  race.state = 'racing'; race.player.progress = 100;
  race.cars.slice(1).forEach((car, i) => car.progress = 90 - i * 10);
  return { race, car: race.player, randomCalls: () => randomCalls };
}
for (const [item, reason, configure] of [
  ['magnet', 'magnet-no-target', () => {}],
  ['nitro', 'nitro-full', (race, car) => { car.nitro = 2; }],
  ['ufo', 'ufo-leading', () => {}],
  ['lightning', 'no-target', race => race.cars.slice(1).forEach(car => car.finishTime = 1)],
]) test(`${item}: failed use explains why and preserves inventory/events/randomness`, () => {
  const { race, car, randomCalls } = setup(); car.items = [item, 'shield']; configure(race, car);
  const before = JSON.stringify(race.cars), count = randomCalls(), result = {};
  for (let i = 0; i < 3; i++) { assert.equal(race.useItem(car, result), false); assert.equal(result.reason, reason); }
  assert.equal(JSON.stringify(race.cars), before); assert.equal(randomCalls(), count); assert.deepEqual(race.drainEvents(), []);
});
test('magnet retains the existing strict range and finished-target rules', () => {
  const { race, car } = setup(), result = {}; car.items = ['magnet'];
  race.cars[1].progress = 230; assert.equal(race.useItem(car, result), false);
  race.cars[1].progress = 229; race.cars[1].finishTime = 1; assert.equal(race.useItem(car, result), false);
  race.cars[1].finishTime = null; assert.equal(race.useItem(car, result), true);
  assert.equal(result.reason, null); assert.equal(car.magnet, 2.4); assert.equal(car.magnetTarget, 1);
});
test('swap frees a shield behind an unusable magnet without consuming either item', () => {
  const { race, car, randomCalls } = setup(); car.items = ['magnet', 'shield']; const count = randomCalls();
  assert.equal(race.swapItems(), true); assert.deepEqual(car.items, ['shield', 'magnet']);
  assert.equal(randomCalls(), count); assert.deepEqual(race.drainEvents(), []);
  assert.equal(race.useItem(), true); assert.equal(car.shield, 6); assert.deepEqual(car.items, ['magnet']);
});
test('discard removes exactly the first item without activating it or creating a hazard', () => {
  const { race, car, randomCalls } = setup(); car.items = ['banana', 'shield']; const count = randomCalls();
  assert.equal(race.discardItem(), 'banana'); assert.deepEqual(car.items, ['shield']);
  assert.equal(car.shield, 0); assert.equal(race.hazards.length, 0); assert.equal(randomCalls(), count);
  assert.deepEqual(race.drainEvents(), []);
});
test('equal items can be swapped and discarded individually', () => {
  const { race, car } = setup(); car.items = ['magnet', 'magnet'];
  assert.equal(race.swapItems(), true); assert.equal(race.discardItem(), 'magnet'); assert.deepEqual(car.items, ['magnet']);
  assert.equal(race.swapItems(), false); assert.equal(race.discardItem(), 'magnet'); assert.equal(race.discardItem(), null);
  const result = {}; assert.equal(race.useItem(car, result), false); assert.equal(result.reason, 'empty');
});
for (const state of ['ready', 'countdown', 'paused', 'finished']) test(`${state}: inventory actions are blocked`, () => {
  const { race, car } = setup(); race.state = state; car.items = ['magnet', 'shield']; const result = {};
  assert.equal(race.swapItems(), false); assert.equal(race.discardItem(), null); assert.equal(race.useItem(car, result), false);
  assert.equal(result.reason, 'not-racing'); assert.deepEqual(car.items, ['magnet', 'shield']);
});
test('a finished player cannot manipulate inventory while AI are racing', () => {
  const { race, car } = setup(); car.finishTime = 3; car.items = ['shield', 'magnet']; const result = {};
  assert.equal(race.swapItems(), false); assert.equal(race.discardItem(), null); assert.equal(race.useItem(car, result), false);
  assert.equal(result.reason, 'finished'); assert.deepEqual(car.items, ['shield', 'magnet']);
});
