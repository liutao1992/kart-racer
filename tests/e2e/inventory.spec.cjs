const { test, expect } = require('@playwright/test');

async function setup(page, mode = 'keyboard') {
  await page.addInitScript(mode => {
    localStorage.setItem('breeze-kart-v1', JSON.stringify({ controlMode: mode, sound: false }));
    window.qaPad = { id: 'Inventory pad', index: 0, mapping: 'standard', connected: true,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [qaPad];
  }, mode);
  await page.route('**/js/core.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nconst QARace=KartCore.Race; KartCore.Race=class extends QARace {constructor(...a){super(...a); window.qaRace=this;}};' });
  });
  await page.goto('/');
  await expect(page.locator('#start-button')).toBeEnabled({ timeout: 30000 });
  await page.clock.install();
}
async function advance(page, ms) {
  for (let t = 0; t < ms; t += 50) await page.clock.fastForward(Math.min(50, ms - t));
}
async function inventory(page, items = ['magnet', 'shield']) {
  await page.evaluate(items => {
    qaRace.player.items = items; qaRace.player.nitro = 0;
    qaRace.cars.slice(1).forEach(car => { car.finishTime = 1; });
    qaRace.boxes.forEach(box => box.respawn = 999);
  }, items);
}
const items = page => page.evaluate(() => qaRace.player.items);
async function pad(page, index, pressed) {
  await page.evaluate(({ index, pressed }) => Object.assign(qaPad.buttons[index], { pressed, value: Number(pressed) }), { index, pressed });
  await advance(page, 50);
}
async function start(page) {
  await page.locator('#start-button').click(); await advance(page, 4000);
  expect(await page.evaluate(() => qaRace.state)).toBe('racing');
}

test('item use gives accurate reasons and swap reaches the rear shield', async ({ page }) => {
  await setup(page); await start(page);
  for (const [item, text] of [['magnet', '前方暂无可吸附目标'], ['nitro', '氮气已满'], ['ufo', '你已领先'], ['lightning', '暂无可攻击的对手'], [null, '道具栏是空的']]) {
    await inventory(page, item ? [item, 'shield'] : []);
    if (item === 'nitro') await page.evaluate(() => qaRace.player.nitro = 2);
    await page.keyboard.press('ControlLeft');
    await expect(page.locator('#toast')).toContainText(text);
    expect(await items(page)).toEqual(item ? [item, 'shield'] : []);
  }
  await inventory(page, ['ufo', 'shield']);
  await page.evaluate(() => { qaRace.cars[1].finishTime = null; qaRace.cars[1].progress = qaRace.player.progress - 50; });
  await page.keyboard.press('ControlLeft'); await expect(page.locator('#toast')).toContainText('你已领先');
  await inventory(page);
  await page.keyboard.down('KeyC'); await page.keyboard.down('KeyC');
  expect(await items(page)).toEqual(['shield', 'magnet']); await page.keyboard.up('KeyC');
  await page.keyboard.press('ControlRight'); expect(await items(page)).toEqual(['magnet']);
  expect(await page.evaluate(() => qaRace.player.shield)).toBeGreaterThan(5.5);
  await expect(page.locator('#item-1')).toHaveAttribute('aria-label', '当前道具：磁铁');
});

for (const mode of ['keyboard', 'gamepad']) {
  test(`${mode}: swap, short hold, one discard per press and input isolation`, async ({ page }, info) => {
    await setup(page, mode); await start(page); await inventory(page);
    const down = () => mode === 'keyboard' ? page.keyboard.down('KeyQ') : pad(page, 13, true);
    const up = () => mode === 'keyboard' ? page.keyboard.up('KeyQ') : pad(page, 13, false);
    if (mode === 'gamepad') {
      await page.keyboard.press('KeyC'); await page.keyboard.down('KeyQ'); await advance(page, 800); await page.keyboard.up('KeyQ');
    } else {
      await pad(page, 5, true); await pad(page, 13, true); await advance(page, 800);
      await pad(page, 5, false); await pad(page, 13, false);
    }
    expect(await items(page)).toEqual(['magnet', 'shield']);
    if (mode === 'keyboard') await page.keyboard.press('KeyC');
    else { await pad(page, 5, true); await advance(page, 300); await pad(page, 5, false); }
    expect(await items(page)).toEqual(['shield', 'magnet']);
    await inventory(page, ['magnet', 'magnet']);
    await down(); await advance(page, 200);
    await expect(page.locator('#item-discard-progress')).toBeVisible();
    await up(); await advance(page, 700); expect(await items(page)).toEqual(['magnet', 'magnet']);
    await down(); await advance(page, 800); expect(await items(page)).toEqual(['magnet']);
    await advance(page, 800); expect(await items(page)).toEqual(['magnet']);
    await up(); await down(); await advance(page, 800); expect(await items(page)).toEqual([]); await up();
    await inventory(page); await down(); await advance(page, 200);
    await page.screenshot({ path: info.outputPath(`inventory-${mode}.png`) });
    if (mode === 'gamepad') { // Other input cannot cancel a valid pad hold.
      await page.keyboard.press('KeyQ'); await advance(page, 700); expect(await items(page)).toEqual(['shield']);
    }
    await up();
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`inventory-${mode}-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const stage = await page.locator('#stage').boundingBox(), panel = await page.locator('.item-panel').boundingBox();
      expect(panel.x).toBeGreaterThanOrEqual(stage.x);
      expect(panel.x + panel.width).toBeLessThanOrEqual(stage.x + stage.width);
      await expect(page.locator(`.item-actions .ctl-${mode === 'gamepad' ? 'gp' : 'kb'}`).first()).toBeVisible();
      await expect(page.locator(`.item-actions .ctl-${mode === 'gamepad' ? 'kb' : 'gp'}`).first()).toBeHidden();
    }
  });

  test(`${mode}: transition and action cancellation requires a fresh discard press`, async ({ page }) => {
    page.setDefaultTimeout(10000);
    await setup(page, mode);
    const down = () => mode === 'keyboard' ? page.keyboard.down('KeyQ') : pad(page, 13, true);
    const up = () => mode === 'keyboard' ? page.keyboard.up('KeyQ') : pad(page, 13, false);
    await inventory(page); await down(); await advance(page, 700); expect(await items(page)).toEqual(['magnet', 'shield']); await up();
    await page.locator('#start-button').click(); await inventory(page);
    await down(); await advance(page, 4000); expect(await items(page)).toEqual(['magnet', 'shield']); await up();
    for (const action of ['swap', 'use', 'reset', 'pause', 'blur', 'guide', 'finish', 'menu', ...(mode === 'gamepad' ? ['disconnect'] : [])]) {
      await inventory(page); await down(); await advance(page, 200);
      if (action === 'swap' || action === 'use' || action === 'reset') {
        const code = { swap: 'KeyC', use: 'ControlLeft', reset: 'KeyR' }[action];
        const button = { swap: 5, use: 2, reset: 3 }[action];
        if (mode === 'keyboard') await page.keyboard.press(code);
        else { await pad(page, button, true); await pad(page, button, false); }
      } else if (action === 'pause') { await page.keyboard.press('Escape'); await page.locator('#resume-button').click(); }
      else if (action === 'blur') { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.locator('#resume-button').click(); }
      else if (action === 'guide') { await page.evaluate(() => document.getElementById('guide-button').click()); await page.keyboard.press('Escape'); await page.locator('#resume-button').click(); }
      else if (action === 'finish') { await page.evaluate(() => qaRace.player.finishTime = 10); }
      else if (action === 'menu') { await page.keyboard.press('Escape'); await page.locator('#menu-button').click(); }
      else {
        await page.evaluate(() => { qaPad.connected = false; const e = new Event('gamepaddisconnected'); e.gamepad = qaPad; window.dispatchEvent(e); });
        await expect(page.locator('#pause-overlay')).toBeVisible();
        await page.evaluate(() => { qaPad.connected = true; const e = new Event('gamepadconnected'); e.gamepad = qaPad; window.dispatchEvent(e); });
        await page.locator('#resume-button').click();
      }
      await advance(page, 800); await expect(page.locator('#item-discard-progress')).toBeHidden();
      if (action !== 'menu') expect(await items(page)).toEqual(action === 'swap' ? ['shield', 'magnet'] : ['magnet', 'shield']);
      await up();
      if (action === 'menu') await start(page);
      if (action === 'finish') { await page.locator('#results-menu-button').click(); await start(page); }
    }
  });
}
