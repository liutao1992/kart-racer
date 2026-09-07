// Real requestAnimationFrame pacing. Run alone; concurrent GPU tests invalidate the comparison.
// All autoplay and profiling hooks are injected into an isolated browser context.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = process.env.KART_PREVIEW_BASE || 'http://127.0.0.1:5190';
const phase = process.env.KART_PERF_PHASE || 'current';
const baseline = process.env.KART_PERF_BASELINE;
const track = process.env.KART_PERF_TRACK || 'coast';
const withItems = process.env.KART_PERF_ITEMS === '1';
const out = path.join(root, 'output/performance');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ ...(process.env.BREEZE_BROWSER_PATH ? {executablePath: process.env.BREEZE_BROWSER_PATH} : {channel: 'chrome'}), headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
    await context.addInitScript(track => {
      let seed = 19419;
      Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
      localStorage.setItem('breeze-kart-v1', JSON.stringify({ track, sound: false }));
    }, track);
    // Replay baseline HTML/CSS/scripts at the same URL and viewport; vendor engine is unchanged.
    await context.route('**/*', async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (!/^(index\.html|css\/style\.css|js\/[a-z-]+\.js)$/.test(name)) return route.continue();
      const response = await route.fetch();
      let source = baseline ? execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `${baseline}:${name}`], {cwd:root,encoding:'utf8'}) : await response.text();
      if (name === 'js/game.js') source = source.replace('function input(padState) {', `function input(padState) {
        if(window.qaAuto && race) {
          if (${withItems} && race.state === 'racing') {
            const tick = Math.floor(race.elapsed);
            if (window.qaItemTick !== tick) {
              window.qaItemTick = tick;
              const car = race.cars[tick % 6];
              car.items = [['lightning','shield','ufo','water','missile','magnet','banana','nitro'][tick % 8]];
              race.useItem(car); if (car.nitro) race.useNitro(car);
            }
          }
          return race.aiInput(race.player);
        }`);
      if (name === 'js/world.js') source += `
        const QAWorld=KartWorld;KartWorld=class extends QAWorld {
          constructor(...a){super(...a);window.qaWorld=this;}
          update(...a){const t=performance.now();super.update(...a);
            if(window.qaSamples){qaSamples.work.push(performance.now()-t);if(a[3]>0&&a[3]<1)qaSamples.interpolated++;}}
        };`;
      return route.fulfill({ response, body: source });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => window.qaWorld?.race);
    await page.evaluate(() => {
      window.qaAuto = true; document.getElementById('start-button').click();
      qaWorld.race.cars.forEach(car => car.aiItemCooldown = 999);
      qaWorld.race.boxes.forEach(box => box.respawn = 999);
      document.getElementById('stage').style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:20';
      qaWorld.resize();
    });
    await page.waitForFunction(() => qaWorld.race.state === 'racing');
    const measurement = await page.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      window.qaSamples = { frames: [], work: [], interpolated: 0 };
      const longTasks = [], observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ type: 'longtask' });
      const start = performance.now(); let previous;
      await new Promise(resolve => {
        function sample(now) {
          if (previous !== undefined) qaSamples.frames.push(now - previous);
          previous = now;
          if (now - start >= 12000) resolve(); else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      observer.disconnect();
      const summarize = values => {
        const sorted = [...values].sort((a, b) => a - b);
        return { count: values.length, median: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)],
          p99: sorted[Math.floor(sorted.length * .99)], max: Math.max(...values), over25: values.filter(v => v > 25).length, over50: values.filter(v => v > 50).length };
      };
      const world = qaWorld, gl = world.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const result = { frame: summarize(qaSamples.frames), work: summarize(qaSamples.work), longTasks, interpolated: qaSamples.interpolated,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        size: [world.canvas.width, world.canvas.height], stats: world.stats(), track: world.race.track.id, state: world.race.state };
      qaSamples = null;
      return result;
    });
    if (errors.length || measurement.state !== 'racing') throw Error(JSON.stringify({ errors, state: measurement.state }));
    if (!baseline && measurement.interpolated === 0) throw Error('Game loop did not supply render interpolation');
    const name = `${phase}-${track}${withItems ? '-items' : ''}`;
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ phase, baseline, withItems, seed: 19419, ...measurement, errors }, null, 2));
    await page.locator('#game-canvas').screenshot({ path: path.join(out, `${name}.png`) });
    console.log(JSON.stringify({ phase, track, withItems, frame: measurement.frame, work: measurement.work, size: measurement.size, longTasks: measurement.longTasks, errors }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
