const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
function harness(file) {
  const contexts = [];
  class Param {
    constructor() {
      this.value = 0;
    }
    setValueAtTime(v) {
      this.value = v;
    }
    setTargetAtTime(v) {
      this.value = v;
    }
    linearRampToValueAtTime(v) {
      this.value = v;
    }
    exponentialRampToValueAtTime(v) {
      this.value = v;
    }
    cancelScheduledValues() {}
  }
  class Node {
    constructor() {
      this.gain = new Param();
      this.frequency = new Param();
      this.Q = new Param();
      this.stops = [];
    }
    connect() {}
    disconnect() {}
    start(t) {
      this.startAt = t;
    }
    stop(t) {
      this.stops.push(t);
    }
  }
  class AudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 1;
      this.destination = {};
      this.sampleRate = 100;
      this.oscillators = [];
      contexts.push(this);
    }
    createGain() {
      return new Node();
    }
    createOscillator() {
      const n = new Node();
      this.oscillators.push(n);
      return n;
    }
    createBiquadFilter() {
      return new Node();
    }
    createBuffer(c, n) {
      return { getChannelData: () => new Float32Array(n) };
    }
    createBufferSource() {
      return new Node();
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  const sandbox = { AudioContext };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, "../js", path.basename(file)),
      "utf8",
    ),
    sandbox,
  );
  return { sandbox, contexts };
}
test("racer retains all eight V3 item voices and engine/drift synthesis", async () => {
  const { sandbox, contexts } = harness("kart-racer/js/audio.js"),
    a = new sandbox.KartAudio();
  await a.unlock();
  for (const [item, pitches] of Object.entries({
    missile: [300, 600],
    banana: [500, 350],
    water: [700, 450],
    magnet: [220, 440],
    shield: [980, 1470],
    nitro: [780, 1170],
    lightning: [1400, 180],
    ufo: [320, 480],
  })) {
    const n = contexts[0].oscillators.length;
    a.event("item-" + item);
    assert.deepEqual(
      contexts[0].oscillators.slice(n).map((v) => v.frequency.value),
      pitches,
    );
  }
  a.update({ speed: 40, boost: 0, drift: true, charge: 50 }, true);
  assert.equal(a.engine.frequency.value, 148);
  assert.equal(a.noiseFilter.frequency.value, 1800);
  assert.equal(a.noiseGain.gain.value, 0.24);
});
test("racer pause cancels scheduled effects, inactivity silences finish cue, destroy closes sources", async () => {
  const { sandbox, contexts } = harness("kart-racer/js/audio.js"),
    a = new sandbox.KartAudio();
  await a.unlock();
  const car = { speed: 40, boost: 0, drift: false, charge: 0 };
  a.update(car, true);
  a.event("finish");
  const voices = [...a.voices];
  assert.equal(voices.length, 4);
  a.update(car, false);
  assert.equal(a.master.gain.value, 0);
  assert.equal(a.voices.size, 0);
  assert.ok(voices.every((v) => v.stops.length === 2));
  a.setEnabled(false);
  const n = contexts[0].oscillators.length;
  a.event("itemPickup");
  assert.equal(contexts[0].oscillators.length, n);
  a.destroy();
  assert.equal(contexts[0].state, "closed");
  assert.equal(a.engine.stops.length, 1);
  a.setEnabled(true);
  await a.unlock();
  assert.equal(contexts.length, 1);
});

test('racer impact timbres differ by item and shield does not play a hurt cue', async () => {
  const { sandbox, contexts } = harness('kart-racer/js/audio.js'), a = new sandbox.KartAudio();
  await a.unlock();
  const signatures = new Set();
  for (const item of ['lightning', 'water', 'ufo', 'banana', 'missile']) {
    a.silence(); const start=contexts[0].oscillators.length;
    a.event('itemHit', item);
    signatures.add(JSON.stringify(contexts[0].oscillators.slice(start).map(v=>[v.type,v.frequency.value])));
  }
  assert.equal(signatures.size,5);
  a.silence(); const start=contexts[0].oscillators.length;
  a.event('itemBlock','lightning');
  assert.deepEqual(contexts[0].oscillators.slice(start).map(v=>v.frequency.value),[980,1470]);
});

test('racer status hum is bounded and pause/resume never replays an impact', async () => {
  const { sandbox, contexts } = harness('kart-racer/js/audio.js'), a = new sandbox.KartAudio();
  await a.unlock();
  const car={speed:20,boost:0,charge:0,drift:false,ufo:3}, initial=contexts[0].oscillators.length;
  for(let i=0;i<120;i++)a.update(car,true);
  assert.equal(contexts[0].oscillators.length,initial);
  assert.ok(a.statusGain.gain.value>0);
  a.update(car,false);assert.equal(a.statusGain.gain.value,0);
  a.update(car,true);assert.equal(contexts[0].oscillators.length,initial);
  car.ufo=0;a.update(car,true);assert.equal(contexts[0].oscillators.length,initial+2);
  a.update(car,true);assert.equal(contexts[0].oscillators.length,initial+2);
  a.event('reset');assert.equal(a.voices.size,0);assert.equal(a.statusGain.gain.value,0);
  a.destroy();assert.equal(a.statusTone.stops.length,1);
});
