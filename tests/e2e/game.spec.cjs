const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const C = require('../../js/core.js');
const tracks = require('../../js/tracks.js').map(C.buildTrack);
const fileUrl = pathToFileURL(path.resolve(__dirname, '../../index.html')).href;
const snapshot = page => page.evaluate(() => window.__kart.snapshot());
async function loaded(page, url = '/') { await page.goto(url); await expect(page.locator('#start-button')).toBeEnabled({ timeout: 20000 }); }

test('menu, local rendering, all tracks, color selection, guide and responsive layout', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loaded(page);
  await expect(page).toHaveTitle(/风驰卡丁车/);
  await expect(page.locator('.track-card')).toHaveCount(8);
  await page.screenshot({ path: info.outputPath('menu-desktop.png'), fullPage: true });
  for (const track of tracks) {
    await page.locator(`[data-track="${track.id}"]`).click();
    await expect(page.locator('#preview-title')).toHaveText(track.name);
    expect((await snapshot(page)).track).toBe(track.id);
    expect((await snapshot(page)).render.triangles).toBeGreaterThan(1000);
    await page.screenshot({ path: info.outputPath(`preview-${track.id}.png`) });
  }
  await page.getByRole('button', { name: '薄荷绿', exact: true }).click();
  expect((await snapshot(page)).player.color).toBe('#3fafa7');
  await page.locator('#guide-button').click(); await expect(page.locator('#guide-overlay')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#guide-overlay')).toBeHidden();
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`menu-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('file URL works offline, settings persist and blocked storage is tolerated', async ({ page, context }, info) => {
  const external = []; page.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
  await context.setOffline(true);
  await loaded(page, fileUrl);
  await page.locator('#sound-button').click();
  await page.getByRole('button', { name: '晴空蓝', exact: true }).click();
  await page.reload(); await expect(page.locator('#start-button')).toBeEnabled();
  expect((await snapshot(page)).audio.enabled).toBe(false); expect((await snapshot(page)).player.color).toBe('#8596d3');
  await page.locator('#start-button').click(); await expect(page.locator('#race-hud')).toBeVisible();
  await page.screenshot({ path: info.outputPath('offline-race.png') });
  expect(external).toEqual([]);
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }); });
  await loaded(page, fileUrl); await page.locator('[data-track="forest"]').click();
  await page.locator('#start-button').click(); await expect(page.locator('#race-hud')).toBeVisible();
});

test('keyboard driving, pause, reset, focus loss and replay', async ({ page }, info) => {
  await loaded(page); await page.clock.install();
  await page.locator('#start-button').click();
  expect((await snapshot(page)).state).toBe('countdown');
  await page.keyboard.down('ArrowUp');
  for (let i = 0; i < 38; i++) await page.clock.fastForward(100);
  expect((await snapshot(page)).state).toBe('racing');
  // Test acceleration on the starting straight, before steering is needed.
  // Poll until up to speed: rAF throughput under first-paint load varies.
  let driven;
  for (let i = 0; i < 60; i++) {
    await page.clock.fastForward(100);
    driven = await snapshot(page);
    if (driven.player.speed > 20 && i >= 8) break;
  }
  await page.keyboard.up('ArrowUp');
  driven = await snapshot(page);
  expect(driven.player.speed).toBeGreaterThan(18);
  expect(driven.player.progress).toBeGreaterThan(-3);
  await page.screenshot({ path: info.outputPath('race-driving.png') });
  await page.keyboard.press('Escape'); await expect(page.locator('#pause-overlay')).toBeVisible();
  const paused = await snapshot(page); await page.clock.fastForward(1000);
  expect((await snapshot(page)).elapsed).toBe(paused.elapsed);
  await page.locator('#resume-button').click();
  await page.keyboard.press('KeyR'); await page.clock.fastForward(100);
  expect((await snapshot(page)).player.speed).toBeLessThan(1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect((await snapshot(page)).state).toBe('paused');
  await page.locator('#restart-button').click();
  const replay = await snapshot(page); expect(replay.state).toBe('countdown'); expect(replay.elapsed).toBe(0); expect(replay.player.nitro).toBe(0); expect(replay.player.lap).toBe(1);
  await page.keyboard.press('Escape'); await page.locator('#menu-button').click();
  await expect(page.locator('#setup')).toBeVisible();
});

test('WebGL unavailable shows an actionable error without a dead start button', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /^webgl/.test(type) ? null : get.call(this, type, ...args); };
  });
  await page.goto('/'); await expect(page.locator('#error-panel')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('WebGL');
  await expect(page.locator('#start-button')).toBeDisabled();
});

test('arrows and A/D steer toward the corresponding screen side, also while drifting', async ({ page }, info) => {
  await loaded(page); await page.clock.install();
  // Capture the camera used for actual rendering. Expectations are in camera
  // space, independent of the game's signed steering/heading convention.
  await page.evaluate(() => {
    const lookAt = THREE.Object3D.prototype.lookAt;
    THREE.Object3D.prototype.lookAt = function (...args) {
      const result = lookAt.apply(this, args);
      if (this.isPerspectiveCamera) {
        this.updateMatrixWorld(true);
        window.__steeringCamera = this.clone();
      }
      return result;
    };
  });
  const measurements = [];
  for (const drift of [false, true]) {
    for (const [code, side] of [['ArrowLeft', -1], ['ArrowRight', 1], ['KeyA', -1], ['KeyD', 1]]) {
      if (measurements.length === 0) await page.locator('#start-button').click();
      else { await page.keyboard.press('Escape'); await page.locator('#restart-button').click(); }
      await page.keyboard.down('ArrowUp');
      // Poll until up to speed instead of a fixed wait: first-paint load makes
      // real-time rAF throughput nondeterministic.
      let before;
      for (let i = 0; i < 90; i++) {
        await page.clock.fastForward(100);
        before = await page.evaluate(() => {
          window.__steeringReference = window.__steeringCamera.clone();
          const car = window.__kart.snapshot().player;
          const forward = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
          return { screenX: forward.transformDirection(window.__steeringReference.matrixWorldInverse).x, speed: car.speed };
        });
        if (before.speed > 22 && i >= 38) break;
      }
      expect(before.speed).toBeGreaterThan(20);
      if (drift) await page.keyboard.down('ShiftLeft');
      await page.keyboard.down(code);
      for (let i = 0; i < 4; i++) await page.clock.fastForward(100);
      const after = await page.evaluate(() => {
        const car = window.__kart.snapshot().player;
        const forward = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
        return { screenX: forward.transformDirection(window.__steeringReference.matrixWorldInverse).x, drift: car.drift };
      });
      await page.keyboard.up(code); await page.keyboard.up('ArrowUp');
      if (drift) await page.keyboard.up('ShiftLeft');
      const screenDelta = after.screenX - before.screenX;
      measurements.push({ code, drift, screenDelta });
      await page.screenshot({ path: info.outputPath(`steering-${code}-${drift ? 'drift' : 'normal'}.png`) });
      expect(screenDelta * side, `${code} must turn ${side < 0 ? 'left' : 'right'} in the rendered camera`).toBeGreaterThan(0.08);
      expect(after.drift).toBe(drift);
    }
  }
  await info.attach('camera-space-steering', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`drift effects render, fade, pause and reset (${reducedMotion})`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.emulateMedia({ reducedMotion });
    await loaded(page); await page.clock.install();
    // This test measures drift-effect lifecycle only. Disable item pickup/AI item
    // use so AI-vs-AI item hits can't inject hitBurst sparks into the particle
    // pool during the fade/pause windows (the item system has its own test).
    await page.evaluate(() => {
      window.KartCore.Race.prototype.updateItems = () => {};
      window.KartCore.Race.prototype.aiItems = () => {};
    });
    await page.locator('#start-button').click();
    // Compare GPU allocations in the same race camera, after lazy uploads.
    await page.clock.fastForward(100);
    const initial = (await snapshot(page)).render;
    await page.keyboard.down('ArrowUp');
    for (let i = 0; i < 45; i++) await page.clock.fastForward(100);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('ArrowLeft');
    for (let i = 0; i < 4; i++) await page.clock.fastForward(100);
    const drifting = await snapshot(page), effects = drifting.render.effects;
    expect(drifting.player.drift).toBe(true);
    expect(effects.skids).toBeGreaterThan(0);
    expect(effects.sparks + effects.smoke).toBeLessThanOrEqual(effects.capacity);
    expect(effects.capacity).toBeLessThanOrEqual(336);
    await expect(page.locator('#drift-feedback')).toHaveClass(/active/);
    await expect(page.locator('#nitro-panel')).toHaveClass(/drifting/);
    if (reducedMotion === 'reduce') {
      expect(effects.sparks).toBe(0); expect(effects.smoke).toBe(0); expect(effects.glow).toBe(0);
    } else {
      expect(effects.sparks).toBeGreaterThan(0); expect(effects.smoke).toBeGreaterThan(0); expect(effects.glow).toBeGreaterThan(0.1);
    }
    await page.screenshot({ path: info.outputPath(`drift-effects-${reducedMotion}.png`) });
    await page.keyboard.press('Escape');
    const paused = await snapshot(page);
    for (let i = 0; i < 10; i++) await page.clock.fastForward(100);
    expect((await snapshot(page)).render.effects).toEqual(paused.render.effects);
    expect((await snapshot(page)).elapsed).toBe(paused.elapsed);
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowUp');
    await page.locator('#resume-button').click();
    for (let i = 0; i < 16; i++) await page.clock.fastForward(100);
    const faded = (await snapshot(page)).render.effects;
    expect(faded.sparks).toBe(0); expect(faded.smoke).toBe(0); expect(faded.glow).toBeLessThan(0.01);
    expect(faded.skids).toBe(paused.render.effects.skids);
    await expect(page.locator('#drift-feedback')).not.toHaveClass(/active/);
    await page.keyboard.press('Escape'); await page.locator('#restart-button').click();
    await page.clock.fastForward(100);
    const replay = (await snapshot(page)).render;
    expect(replay.effects.sparks).toBe(0); expect(replay.effects.smoke).toBe(0); expect(replay.effects.skids).toBe(0);
    expect(replay.effects.glow).toBe(0);
    await info.attach('effect-resources', { body: JSON.stringify({ initial, active: drifting.render, replay }, null, 2), contentType: 'application/json' });
    expect(replay.geometries).toBeLessThanOrEqual(initial.geometries);
    expect(replay.textures).toBeLessThanOrEqual(initial.textures);
    expect(errors).toEqual([]);
  });
}

test('complete a race through keyboard inputs, drift, use nitro, save result, race again', async ({ page }, info) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loaded(page); await page.clock.install(); await page.locator('#start-button').click();
  const held = new Set();
  async function key(code, down) { if (down && !held.has(code)) { await page.keyboard.down(code); held.add(code); } else if (!down && held.has(code)) { await page.keyboard.up(code); held.delete(code); } }
  let usedBoost = false, drifted = false, charged = false, state, capturedCharge = false, capturedDrift = false;
  for (let i = 0; i < 1800; i++) {
    state = await snapshot(page);
    if (state.state === 'finished') break;
    const car = state.player, track = tracks[0];
    const here = C.sample(track, car.progress), ahead = C.sample(track, car.progress + 12 + Math.max(0, car.speed) * 0.32);
    const curve = Math.abs(C.angleDelta(C.sample(track, car.progress + 35).heading, here.heading));
    const delta = C.angleDelta(Math.atan2(ahead.x - car.x, ahead.z - car.z), car.heading);
    const target = C.clamp(39 - curve * 22, 21, 39);
    await key('ArrowUp', car.speed < target + 0.5);
    await key('ArrowDown', car.speed > target + 4);
    // Positive world yaw is a left turn from the driver's viewpoint.
    await key('ArrowLeft', delta > 0.07); await key('ArrowRight', delta < -0.07);
    await key('ShiftLeft', Math.abs(delta) > 0.06 && curve > 0.14 && car.speed > 16);
    drifted ||= car.drift; charged ||= car.nitro > 0;
    // Item chaos is part of the race now: recover from debuffs with R (a real
    // mechanic that clears them) and fire held items on straights, like a player would.
    if (car.stun > 0 || car.slip > 0 || car.bubble > 0 || car.zap > 0 || car.ufo > 0) await page.keyboard.press('KeyR');
    else if (car.items.length && curve < 0.25 && Math.abs(delta) < 0.15) await page.keyboard.press('ControlLeft');
    if (car.drift && state.elapsed > 6 && car.charge > 45 && !capturedDrift) {
      capturedDrift = true;
      await page.screenshot({ path: info.outputPath('drift-on-track.png') });
    }
    // Only capture the charge-ready UI state when the nitro came from drift
    // charging: a nitro *item* also sets car.nitro but never raises the class.
    if (!capturedCharge && car.nitro > 0 && await page.locator('#nitro-panel').evaluate(el => el.classList.contains('charge-ready'))) {
      capturedCharge = true;
      await page.screenshot({ path: info.outputPath('drift-charge-ready.png') });
    }
    if (car.nitro > 0 && car.boost <= 0 && curve < 0.25 && Math.abs(delta) < 0.15) {
      await page.keyboard.press('Space'); usedBoost = true;
      if (i % 10 === 0) await page.screenshot({ path: info.outputPath('nitro-boost.png') });
    }
    await page.clock.fastForward(100);
    if (i === 170) await page.screenshot({ path: info.outputPath('race-in-progress.png') });
  }
  for (const code of held) await page.keyboard.up(code);
  expect(state.state, 'race finished').toBe('finished'); expect(drifted, 'drifted').toBe(true); expect(charged, 'charged').toBe(true); expect(usedBoost, 'usedBoost').toBe(true);
  await expect(page.locator('#results-overlay')).toBeVisible(); await expect(page.locator('#result-laps li')).toHaveCount(3);
  await expect(page.locator('#record-label')).toContainText('个人最佳');
  await page.screenshot({ path: info.outputPath('race-results.png') });
  await page.locator('#results-menu-button').click(); await expect(page.locator('#best-time')).toContainText('个人最佳');
  await page.locator('#start-button').click();
  expect((await snapshot(page)).player.lapTimes).toEqual([]); expect((await snapshot(page)).player.nitro).toBe(0);
  expect(errors).toEqual([]);
});

test('item system: HUD slots, empty-inventory hint and live boxes in snapshot', async ({ page }) => {
  await loaded(page); await page.clock.install();
  await page.locator('#start-button').click();
  for (let i = 0; i < 38; i++) await page.clock.fastForward(100);
  expect((await snapshot(page)).state).toBe('racing');
  await expect(page.locator('.item-slot')).toHaveCount(2);
  const snap = await snapshot(page);
  expect(Array.isArray(snap.player.items)).toBe(true);
  expect(snap.boxes).toBeGreaterThan(0);
  await page.keyboard.press('ControlLeft');
  await expect(page.locator('#toast')).toContainText('道具栏');
});

test('difficulty selection persists and scopes records per tier', async ({ page }) => {
  // Synthetic legacy save: a pre-difficulty record keyed by plain track id.
  // Seeded only when absent, so the reload below re-reads what the game
  // itself persisted (difficulty choice included) instead of being stomped.
  await page.addInitScript(() => {
    if (!localStorage.getItem('breeze-kart-v1')) {
      localStorage.setItem('breeze-kart-v1', JSON.stringify({ sound: true, color: '#f17b46', track: 'coast', records: { coast: 80 } }));
    }
  });
  await loaded(page);
  // Legacy records migrate to the normal tier; normal is the default choice.
  await expect(page.locator('.difficulty-choice.selected')).toHaveAttribute('data-difficulty', 'normal');
  expect((await snapshot(page)).difficulty).toBe('normal');
  await expect(page.locator('#best-time')).toContainText('个人最佳（标准）');
  // Master tier has its own, still empty record slot.
  await page.locator('[data-difficulty="master"]').click();
  await expect(page.locator('.difficulty-choice.selected')).toHaveAttribute('data-difficulty', 'master');
  expect((await snapshot(page)).difficulty).toBe('master');
  await expect(page.locator('#best-time')).toContainText('新的赛道');
  // The choice survives a reload, and tier-scoped records stay apart.
  await page.reload(); await expect(page.locator('#start-button')).toBeEnabled();
  await expect(page.locator('.difficulty-choice.selected')).toHaveAttribute('data-difficulty', 'master');
  await expect(page.locator('#best-time')).toContainText('新的赛道');
  await page.locator('[data-difficulty="normal"]').click();
  await expect(page.locator('#best-time')).toContainText('个人最佳（标准）');
  // The legend tier is selectable and persists as well.
  await page.locator('[data-difficulty="legend"]').click();
  expect((await snapshot(page)).difficulty).toBe('legend');
  await page.reload(); await expect(page.locator('#start-button')).toBeEnabled();
  await expect(page.locator('.difficulty-choice.selected')).toHaveAttribute('data-difficulty', 'legend');
});
