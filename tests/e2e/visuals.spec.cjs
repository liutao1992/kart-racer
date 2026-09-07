const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
// Adapted from typing's production visual suite. All mutable handles are test-injected.
test('new kart models, all item states, interpolation and nine-track visual regression', async ({ page }, info) => {
  test.setTimeout(240000);
  const out = info.outputDir, report = {}, capture = true, errors = [];
  fs.mkdirSync(out, { recursive: true });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.route('**/js/world.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nconst QAWorld=KartWorld; KartWorld=class extends QAWorld { constructor(...a){super(...a); window.qaWorld=this;} update(...a){if(!window.qaManual) super.update(...a);} }; window.qaRender=(...a)=>QAWorld.prototype.update.apply(qaWorld,a);' });
  });
  await page.goto('/');
  await expect(page.locator('#start-button')).toBeEnabled({timeout: 30000});
    await page.evaluate(() => {
      window.qaManual = true;
      document.body.classList.add('racing');
      document.getElementById('stage').style.height='620px';
      qaWorld.resize();
      window.qaScene = (index = 0) => {
        // Keep the camera/FOV and decorative phase identical across reloads.
        // GPU geometry counts are lazy and otherwise vary with frustum visibility.
        qaWorld.clock = 0; qaWorld.camera.fov = 57;
        const track = KartCore.buildTrack(KartTracks[index]);
        window.qaRace = new KartCore.Race(track, '#f17b46', () => 0.5);
        qaRace.state = 'racing'; qaWorld.load(track, qaRace); qaWorld.cameraReady = false;
        qaRace.cars.forEach((c, i) => { const p = KartCore.sample(track, -8 - i * 6, i % 2 ? 2.1 : -2.1); Object.assign(c, p, { speed: 24, aiItemCooldown: 999 }); });
        window.qaTick = dt => {
          qaRace.cars.forEach(c => qaRace.drive(c, { throttle: 0, steer: 0 }, dt));
          qaRace.updateItems(dt);
          for (const e of qaRace.drainEvents()) { if(qaWorld.handleRaceEvent) qaWorld.handleRaceEvent(e, qaRace); else if(e.type==='itemHit') qaWorld.hitBurst(qaRace.cars[e.id]); }
          qaRender(qaRace, dt, false);
        };
        qaRender(qaRace, 1/60, false);
      };
      qaScene();
    });
      report.checks = await page.evaluate(() => {
        const checks=[],check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
        const render=dt=>qaRender(qaRace,dt,false),tick=dt=>qaTick(dt);
        const event=()=>{for(const e of qaRace.drainEvents())qaWorld.handleRaceEvent(e,qaRace);};
        const reset=()=>{qaScene();qaRace.cars.forEach(c=>c.speed=0);};
        reset();check(qaWorld.carModels.every(m=>m.goggles?.visible),'player-and-ai-use-approved-model');
        if(qaWorld.capturePreviousTransforms){
          const car=qaRace.player,model=qaWorld.carModels[0],x=car.x;
          car.heading=Math.PI-.02;qaWorld.capturePreviousTransforms(qaRace);car.x+=.6;car.heading=-Math.PI+.02;
          const physics=JSON.stringify(qaRace.cars);
          qaRender(qaRace,0,false,.5);
          check(Math.abs(model.group.position.x-x-.3)<1e-8,'render-interpolates-between-physics-steps');
          check(Math.abs(Math.abs(model.group.rotation.y)-Math.PI)<1e-8,'heading-interpolation-crosses-angle-boundary');
          check(JSON.stringify(qaRace.cars)===physics,'interpolation-does-not-mutate-physics');
          car.x+=20;qaRender(qaRace,0,false,.25);check(model.group.position.x===car.x,'teleport-is-not-interpolated');
          qaWorld.handleRaceEvent({type:'reset',id:0},qaRace);qaRender(qaRace,0,false,0);check(model.group.position.x===car.x,'reset-discards-interpolation-history');
          reset();let accumulator=0,last,zeroSteps=0;const deltas=[];
          for(let frame=0;frame<150;frame++){
            accumulator+=1/144;
            while(accumulator>=1/60){qaWorld.capturePreviousTransforms(qaRace);qaRace.player.z+=.6;accumulator-=1/60;}
            qaRender(qaRace,1/144,false,accumulator*60);
            const z=qaWorld.carModels[0].group.position.z;
            if(frame>3){const delta=z-last;deltas.push(delta);if(Math.abs(delta)<1e-8)zeroSteps++;}last=z;
          }
          check(zeroSteps===0&&deltas.every(d=>Math.abs(d-.25)<1e-8),'144hz-motion-has-no-duplicate-or-double-steps');
          check(qaWorld.canvas.width*qaWorld.canvas.height<=qaWorld.pixelBudget,'render-buffer-obeys-pixel-budget');
          check(qaWorld.sun.shadow.mapSize.x===1024&&qaWorld.renderer.shadowMap.enabled,'bounded-shadow-keeps-lighting');
          reset();
        }
        check(qaWorld.itemEffects.states.every(s=>s.shield.material.uniforms.tint.value.getHexString()==='ffca4f'),'all-shields-use-gold');
        for(const id of [0,1])for(const [kind,field,duration]of [['lightning','zap',1.6],['water','bubble',2],['ufo','ufo',3],['missile','stun',1.1],['banana','slip',.9]]) {
          reset();const car=qaRace.cars[id];qaRace.applyHit(car,kind,2);event();render(0);
          check(car[field]===duration,`${id}:${kind}:duration`);
          check(qaWorld.carModels[id].pose===kind,`${id}:${kind}:pose`);
          const model=qaWorld.carModels[id];
          if(kind==='banana'||kind==='missile'){
            tick(duration*.4);
            check(kind==='missile'?model.visual.rotation.x>.3:Math.abs(model.visual.rotation.y)>.3,`${id}:${kind}:whole-vehicle-spin`);
            check(model.wheels.every(w=>w.pivot.parent===model.visual)&&model.body.parent===model.visual,`${id}:${kind}:wheels-and-body-share-spin`);
          }
          for(let i=0;i<220;i++)tick(1/60);
          check(car[field]===0&&model.pose==='drive'&&model.visual.rotation.y===0,`${id}:${kind}:recover`);
        }
        reset();const p=qaRace.player;p.shield=6;qaRace.applyHit(p,'lightning',1);event();render(0);
        check(p.zap===0&&qaWorld.itemEffects.states[0].block.visible&&!qaWorld.itemEffects.states[0].bolt.visible,'shield-block-no-hurt');
        reset();qaRace.applyHit(qaRace.player,'lightning',1);event();tick(.3);qaRace.applyHit(qaRace.player,'lightning',1);event();render(0);
        check(qaWorld.itemEffects.states[0].timers.lightning===.36&&qaRace.player.zap===1.6,'repeat-hit-restarts-flash');
        qaRace.applyHit(qaRace.player,'ufo',1);qaRace.applyHit(qaRace.player,'water',1);qaRace.applyHit(qaRace.player,'missile',1);event();render(0);
        check(qaWorld.carModels[0].pose==='missile'&&qaWorld.itemEffects.states[0].bubble.visible&&qaWorld.itemEffects.states[0].zap.visible&&qaWorld.itemEffects.states[0].beam.visible,'stacked-status-priority');
        tick(.4);check(qaWorld.itemEffects.states[0].bubble.position.y>2.8,'stacked-bubble-follows-airborne-kart');
        tick(.4);check(qaWorld.carModels[0].visual.position.length()<.001&&qaRace.player.stun>0,'flip-lands-at-point-eight-with-stun-remaining');
        qaRace.applyHit(qaRace.player,'missile',1);event();render(0);
        const state=()=>JSON.stringify({clock:qaWorld.clock,fx:qaWorld.itemEffects.time,timers:qaWorld.itemEffects.states.map(s=>s.timers),poses:qaWorld.carModels.map(m=>[m.visual.rotation.toArray(),m.wheels.map(w=>w.roll.rotation.x)]),particles:Array.from(qaWorld.itemEffects.spark.life)});
        qaRace.pause();render(0);const paused=state();for(let i=0;i<10;i++)render(.1);check(state()===paused,'pause-freezes-all-animation');qaRace.resume();
        const before=qaWorld.itemEffects.states[0].timers.missile;render(.01);check(qaWorld.itemEffects.states[0].timers.missile<before,'resume-does-not-replay-hit');
        qaWorld.reducedMotion=true;render(0);check(qaWorld.carModels[0].visual.rotation.y===0&&qaWorld.carModels[0].visual.rotation.x===0&&qaWorld.carModels[0].visual.position.length()<.001&&qaWorld.itemEffects.states[0].bubble.visible&&qaWorld.itemEffects.states[0].zap.visible&&qaWorld.itemEffects.states[0].beam.visible,'reduced-motion-keeps-identifiable-status');qaWorld.reducedMotion=false;
        reset();qaRace.player.items=['nitro'];qaRace.useItem();event();render(0);
        check(qaWorld.itemEffects.states[0].nitro.visible&&qaWorld.carModels[0].flames.every(f=>!f.visible),'nitro-refill-does-not-boost');
        qaRace.useNitro();event();render(0);check(qaWorld.carModels[0].flames.every(f=>f.visible&&f.children.length===2),'nitro-activation-layered-flames');
        reset();qaRace.player.magnet=2.4;qaRace.player.magnetTarget=1;render(0);check(qaWorld.itemEffects.states[0].link.visible,'magnet-connects-target');qaRace.cars[1].finishTime=1;render(0);check(!qaWorld.itemEffects.states[0].link.visible,'magnet-clears-finished-target');
        reset();qaRace.player.items=['water'];qaRace.useItem();event();render(0);const h=qaRace.hazards[0],proj=qaWorld.itemEffects.projectiles.get(h.visualId).model;
        check(Math.abs(proj.position.x+proj.userData.orb.position.x-h.originX)<.001,'water-starts-at-thrower');
        for(let i=0;i<49;i++)tick(1/60);check(proj.userData.ring.visible&&!proj.userData.orb.visible,'water-lands-on-physics-time');
        reset();qaRace.player.speed=20;render(.2);check(qaWorld.carModels[0].wheels.every(w=>Math.abs(w.roll.rotation.x)>.1),'all-wheels-roll');
        for(const steer of [-.7,0,.7]){qaRace.player.steer=steer;render(.1);const m=qaWorld.carModels[0];m.group.updateMatrixWorld(true);
          check(m.arms.every((arm,i)=>arm.localToWorld(arm.userData.gripPoint.clone()).distanceTo(m.steering.localToWorld(new THREE.Vector3((i===0?-1:1)*.30,0,0)))<.19),`steer-${steer}:hands-follow-wheel`);}
        qaWorld.setColor('#8596d3');check(qaWorld.carModels[0].paint!==qaWorld.carModels[0].helmetPaint&&qaWorld.carModels[0].paint.color.equals(qaWorld.carModels[0].helmetPaint.color),'independent-materials-linked-color');
        qaRace.applyHit(qaRace.player,'water',1);event();render(.1);qaRace.resetCar();event();render(0);check(!qaWorld.itemEffects.states[0].bubble.visible&&qaWorld.itemEffects.states[0].timers['end-water']===undefined,'reset-clears-without-fake-release');
        const counts=[];for(let i=0;i<8;i++){qaScene(i%2);render(.1);qaWorld.renderer.getContext().finish();counts.push(qaWorld.stats());}
        for(const key of ['geometries','textures'])check(counts[2][key]===counts[6][key]&&counts[3][key]===counts[7][key],`reload-stable-${key}: ${JSON.stringify(counts.map(c=>c[key]))}`);
        qaWorld.handleRaceEvent({type:'finish'},qaRace);check(qaWorld.itemEffects.states.every(s=>Object.keys(s.timers).length===0),'finish-clears-effects');
        return checks;
      });
        for(let i=0;i<9;i++) {
      await page.evaluate(i=>qaScene(i),i);
      await page.locator('#game-canvas').screenshot({path:`${out}/track-${i}.png`});
    }
    report.lowDetail=await page.evaluate(()=>{
      const checks=[];qaWorld.effectDensity=.55;qaWorld.reducedMotion=true;
      for(let i=0;i<9;i++){
        qaScene(i);const p=qaRace.player;p.shield=6;p.zap=1.6;p.bubble=2;p.ufo=3;p.stun=.7;qaRender(qaRace,0,false);
        const m=qaWorld.carModels[0],s=qaWorld.itemEffects.states[0];
        if(!s.shield.visible||!s.zap.visible||!s.bubble.visible||!s.beam.visible||s.shieldRibs.visible||s.arcHalo.visible||s.impact.visible||m.visual.rotation.x!==0||m.visual.position.length()>.001)throw Error(`low-detail-track-${i}`);
        checks.push(`low-detail-track-${i}`);
      }
      qaWorld.effectDensity=1;qaWorld.reducedMotion=false;qaScene();return checks;
    });
    if(capture){await page.evaluate(()=>{qaScene();qaRender(qaRace,0,true);qaWorld.camera.position.set(qaRace.player.x+5,3.8,qaRace.player.z+7);qaWorld.camera.lookAt(qaRace.player.x,1.4,qaRace.player.z);qaWorld.renderer.render(qaWorld.scene,qaWorld.camera);});
    await page.locator('#game-canvas').screenshot({path:`${out}/character.png`});}
    if(capture)for(const item of ['lightning','ufo','water','missile','banana','shield','magnet','nitro']) {
      await page.evaluate(item=>{
        qaScene();const p=qaRace.player;
        if(['shield','magnet','nitro'].includes(item)){p.items=[item];qaRace.useItem(p);if(item==='magnet'){p.magnet=2.4;p.magnetTarget=1;}}
        else qaRace.applyHit(p,item,1);
        for(const e of qaRace.drainEvents()){if(qaWorld.handleRaceEvent)qaWorld.handleRaceEvent(e,qaRace);else if(e.type==='itemHit')qaWorld.hitBurst(qaRace.cars[e.id]);}
        qaRender(qaRace,0,false);
      },item);
      await page.locator('#game-canvas').screenshot({path:`${out}/${item}-hit.png`});
      await page.evaluate(async()=>{for(let i=0;i<24;i++){qaTick(1/60);await new Promise(requestAnimationFrame);}});
      await page.locator('#game-canvas').screenshot({path:`${out}/${item}-hold.png`});
      await page.evaluate(async()=>{for(let i=0;i<190;i++){qaTick(1/60);await new Promise(requestAnimationFrame);}});
      await page.locator('#game-canvas').screenshot({path:`${out}/${item}-end.png`});
    }
  expect(errors).toEqual([]);
  report.errors = errors;
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await info.attach('visual-checks', { body: JSON.stringify(report), contentType: 'application/json' });
});

test('high DPI and low-memory rendering respect the selected pixel budget', async ({ browser }) => {
  for (const memory of [8, 1]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
    try {
      const page = await context.newPage();
      await page.addInitScript(memory => Object.defineProperty(navigator, 'deviceMemory', { get: () => memory }), memory);
      await page.goto('http://127.0.0.1:5190');
      await expect(page.locator('#start-button')).toBeEnabled({ timeout: 30000 });
      await page.locator('#start-button').click();
      for (const width of [1920, 2560]) {
        await page.setViewportSize({ width, height: 1440 });
        await expect.poll(() => page.evaluate(() => {
          const r = __kart.snapshot().render.resolution;
          return r.width * r.height <= r.pixelBudget && r.pixelBudget === (navigator.deviceMemory === 1 ? 1280 * 720 : 1920 * 1080);
        })).toBe(true);
        expect((await page.evaluate(() => __kart.snapshot().render.resolution)).shadowSize).toBe(1024);
      }
    } finally { await context.close(); }
  }
});
