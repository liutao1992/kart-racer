const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const tracks = require('../js/tracks.js');
const current = require('../js/core.js');
const fixture = path.join(__dirname, 'physics-baseline.json');
function replay(C, seed, difficulty) {
  let rng = seed >>> 0, randomCalls=0;
  const rand=()=>{randomCalls++;rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const race=new C.Race(C.buildTrack(tracks[seed%tracks.length]),'#f17b46',rand,difficulty);
  race.start();const hash=createHash('sha256'),items=['missile','banana','water','magnet','shield','nitro','lightning','ufo'];
  for(let frame=0;frame<3000;frame++) {
    if(frame%67===0){const car=race.cars[Math.floor(frame/67)%6];car.items=[items[Math.floor(frame/67)%8]];race.useItem(car);}
    if(frame%193===0)race.useNitro();
    if(frame%401===0)race.resetCar();
    if(frame===1100)race.pause();if(frame===1120)race.resume();
    race.step(1/60,{throttle:frame%800<650?1:0,steer:Math.sin(frame*.013)*.55,drift:frame%280>190,brake:frame%800>760});
    const events=race.drainEvents();
    if(frame%15===0||events.length) {
      const snapshot=JSON.stringify({cars:race.cars,boxes:race.boxes,hazards:race.hazards,missiles:race.missiles,state:race.state,elapsed:race.elapsed,countdown:race.countdown,finishedCount:race.finishedCount,order:race.standings().map(c=>c.id),events,randomCalls},(key,value)=>['visualId','originX','originZ','sourceId'].includes(key)?undefined:value);
      hash.update(snapshot);
    }
  }
  return hash.digest('hex');
}
if(process.env.KART_RECORD_BASELINE) {
  const baseline=require(path.resolve(process.env.KART_RECORD_BASELINE)),results=[];
  for(const seed of [7,19])for(const difficulty of ['easy','normal','master','legend','hell'])results.push({seed,difficulty,sha256:replay(baseline,seed,difficulty)});
  fs.writeFileSync(fixture,JSON.stringify({source:'d55107104a50fdbc606b1b0759079da57be14572 (upstream drift improvements before typing migration)',framesPerCase:3000,results},null,2)+'\n');
} else {
  const baseline=JSON.parse(fs.readFileSync(fixture,'utf8'));
  for(const row of baseline.results)test(`unchanged physics replay: ${row.difficulty}, seed ${row.seed}`,()=>assert.equal(replay(current,row.seed,row.difficulty),row.sha256));
}
