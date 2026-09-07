(function(root) {
  'use strict';
  const T=root.THREE,C=root.KartCore,TAU=Math.PI*2;
  const STATUS={lightning:'zap',water:'bubble',ufo:'ufo',missile:'stun',banana:'slip',shield:'shield',magnet:'magnet',nitro:'boost'};
  class KartItemEffects {
    constructor(world,race) {
      this.world=world;this.race=race;this.seed=0x7c491;this.states=[];this.seenWater=new Set();this.projectiles=new Map();this.free={};
      this.factory=world.kartFactory;this.time=0;this.disposed=false;
      this.spark=world.createParticlePool(Math.ceil(160*world.effectDensity),true);
      this.puff=world.createParticlePool(Math.ceil(80*world.effectDensity),false);
      this.spark.mesh.name='item-sparks';this.puff.mesh.name='item-puffs';
      for(const pool of [this.spark,this.puff])pool.owner=new Int16Array(pool.count).fill(-1);
      this.tint=new T.Color();this.direction=new T.Vector3();this.up=new T.Vector3(0,1,0);
      this.createBoxes();
      for(let i=0;i<8;i++)this.pool('banana').push(this.createBanana());
      for(let i=0;i<12;i++)this.pool('water').push(this.createWater());
      for(let i=0;i<12;i++)this.pool('missile').push(this.createMissile());
      race.cars.forEach((car,i)=>this.states.push(this.createState(world.carModels[i])));
    }
    rand(){this.seed^=this.seed<<13;this.seed^=this.seed>>>17;this.seed^=this.seed<<5;return(this.seed>>>0)/4294967296;}
    pool(kind){return this.free[kind]||(this.free[kind]=[]);}
    basic(color,opacity=1){return new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1,toneMapped:false});}
    group(parent,name){const g=new T.Group();g.name=name;parent.add(g);return g;}
    noShadow(group){group.traverse(o=>{o.castShadow=o.receiveShadow=false;});return group;}
    membrane(color,grid=false){
      if(!grid)return this.waterMembrane(color);
      return new T.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,
        uniforms:{tint:{value:new T.Color('#ffca4f')},alpha:{value:1},clock:{value:0}},
        vertexShader:`varying vec3 n;varying vec3 eye;varying vec3 local;
          void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=normalize(-p.xyz);local=position;gl_Position=projectionMatrix*p;}`,
        fragmentShader:`uniform vec3 tint;uniform float alpha;uniform float clock;varying vec3 n;varying vec3 eye;varying vec3 local;
          float hexEdge(vec2 p){vec2 r=vec2(1.,1.73205);vec2 a=mod(p,r)-r*.5;vec2 b=mod(p-r*.5,r)-r*.5;vec2 h=abs(dot(a,a)<dot(b,b)?a:b);return .5-max(dot(h,vec2(.5,.866025)),h.x);}
          void main(){vec3 v=normalize(local);float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),2.1);
            vec2 p=vec2(atan(v.z,v.x)*4.2,asin(clamp(v.y,-1.,1.))*4.2);
            float lines=1.-smoothstep(.012,.05,hexEdge(p));
            float sweep=pow(.5+.5*sin(v.y*5.-clock*.8),12.);
            float a=(.052+rim*.72+lines*(.17+rim*.12)+sweep*.035)*alpha;
            gl_FragColor=vec4(tint+vec3(.12,.18,.22)*(rim+lines*.18),min(.88,a));
            #include <colorspace_fragment>
          }`});
    }
    jagged(points,radius,material,parent){
      const path=new T.CurvePath();
      for(let i=1;i<points.length;i++)path.add(new T.LineCurve3(new T.Vector3(...points[i-1]),new T.Vector3(...points[i])));
      return this.factory.mesh(new T.TubeGeometry(path,points.length*3,radius,5,false),material,[0,0,0],[1,1,1],parent);
    }
    enhanceState(s){
      const f=this.factory;
      s.block.material.color.set('#ffe39a');
      s.shieldRibs=this.group(s.shield,'shield-energy-ribs');
      s.ribMaterial=this.basic('#ffe39a',.62);
      for(let i=0;i<3;i++){
        const ring=f.ring(s.ribMaterial,2.125,.016,[0,0,0],s.shieldRibs,Math.PI*1.62);
        ring.rotation.set(Math.PI/2+i*.42,i*TAU/3,.28);
      }
      f.batch(s.shieldRibs);
      s.arcCore=this.basic('#e3f5ff',1);s.arcHalo=this.basic('#458dff',.24);
      const count=this.world.effectDensity<1?4:6;
      for(let i=0;i<count;i++){
        const a=i*TAU/count,points=[];
        for(let j=0;j<9;j++){
          const b=a+j*.12+(j%2?.095:-.095),r=1.31+(j%2?.16:-.08);
          points.push([Math.cos(b)*r,.38+j*.25,Math.sin(b)*r]);
        }
        this.jagged(points,.038,s.arcCore,s.zap);this.jagged(points,.085,s.arcHalo,s.zap);
      }
      // An additional low arc reads well from the chase camera and ties the hit to the whole car.
      const axle=[[-1.4,.58,-1.16],[-.8,.81,-1.45],[-.3,.56,-1.39],[.25,.80,-1.48],[.85,.52,-1.35],[1.4,.70,-1.06]];
      this.jagged(axle,.037,s.arcCore,s.zap);this.jagged(axle,.075,s.arcHalo,s.zap);f.batch(s.zap);
      s.boltCore=this.basic('#e6f5ff');s.boltHalo=this.basic('#4770ff',.55);
      for(const material of [s.arcCore,s.boltCore]){material.transparent=true;material.depthWrite=false;}
      const branches=[
        [[.5,7,0],[-.3,5.5,.1],[.32,4.8,0],[-.3,3.85,.05],[.25,3.35,0],[0,2.22,0]],
        [[-.3,5.5,.1],[-1.15,4.7,.4],[-.72,4.1,.2],[-1.40,3.2,.35]],
        [[.32,4.8,0],[1.1,4.35,0],[.8,3.8,.4],[1.4,2.8,.5]]
      ];
      branches.forEach((points,i)=>{this.jagged(points,i?.05:.10,s.boltCore,s.bolt);this.jagged(points,i?.11:.19,s.boltHalo,s.bolt);});f.batch(s.bolt);
      s.impact=f.ring(this.basic('#9ccaff',.75),1.65,.035,[0,.15,0],s.bolt);s.impact.rotation.x=Math.PI/2;s.impact.name='electric-impact-ring';
      this.noShadow(s.g);return s;
    }
    updatePresentation(s,car,far) {
      // A bubble or newly activated shield follows the presentation lift during a stacked hit.
      const lift=s.model.pose==='missile'?Math.max(0,s.model.visual.position.y+1.05*Math.cos(s.model.visual.rotation.x)-1.05):0;
      s.shield.position.y=1.25+lift;s.bubble.position.y=1.35+lift;
      s.ribMaterial.opacity=s.shield.material.uniforms.alpha.value*.62;
      s.shieldRibs.visible=!far&&this.world.effectDensity===1;
      const fade=Math.min(1,car.zap/.18);
      s.arcCore.opacity=fade;
      s.arcHalo.opacity=.24*fade;s.arcHalo.visible=!far&&this.world.effectDensity===1;
      const strike=Math.min(1,(s.timers.lightning||0)/.20);
      s.boltCore.opacity=strike;s.boltHalo.opacity=.55*strike;
      s.impact.material.opacity=.75*strike;
      s.impact.scale.setScalar(this.world.reducedMotion?1:.55+(1-(s.timers.lightning||0)/.36)*.65);
      s.impact.visible=!this.world.reducedMotion&&!far;
    }
    waterMembrane(color,grid=false) {
      return new T.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,
        uniforms:{tint:{value:new T.Color(color)},alpha:{value:1},clock:{value:0},grid:{value:grid?1:0}},
        vertexShader:`varying vec3 n; varying vec3 eye; varying vec3 local;
          void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=normalize(-p.xyz);local=position;gl_Position=projectionMatrix*p;}`,
        fragmentShader:`uniform vec3 tint;uniform float alpha;uniform float clock;uniform float grid;varying vec3 n;varying vec3 eye;varying vec3 local;
          void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),2.6);
            float bands=pow(.5+.5*sin(local.y*14.+clock*1.3),18.);
            float cells=pow(.5+.5*sin(local.x*15.+local.z*10.),22.)*bands;
            float a=mix(.028+rim*.62,.045+rim*.42+cells*.2,grid)*alpha;
            vec3 c=tint+vec3(.14,.18,.2)*rim;gl_FragColor=vec4(c,a);
            #include <colorspace_fragment>
          }`});
    }
    createState(model) {
      const f=this.factory,g=this.group(model.group,'item-status'),timers={},previous={};
      const shield=f.mesh(f.geo('shield-sphere',()=>new T.SphereGeometry(2.12,24,16)),this.membrane('#69ffd0',true),[0,1.25,0],[1,.88,1],g);
      const bubble=f.mesh(f.geo('bubble-sphere',()=>new T.SphereGeometry(2.03,24,16)),this.membrane('#86dcff'),[0,1.35,0],[1,.98,1],g);
      shield.name='energy-shield';bubble.name='water-membrane';
      const shine=this.group(bubble,'water-reflection');
      for(const [r,x,y,z,a]of [[1.82,-.1,.06,.24,.65],[1.9,.22,.03,-.12,.4]]){const m=f.ring(this.basic('#d8f8ff',.7),r,.025,[x,y,z],shine,a);m.rotation.set(.32,1.15,1.1);}
      const zap=this.group(g,'lightning-arcs'),bolt=this.group(g,'lightning-strike');
      const ufo=this.group(g,'ufo-saucer');
      f.egg(this.world.material('#768f9f',{metalness:.65,roughness:.3}),[0,0,0],[1.09,.24,1.09],ufo);
      f.egg(this.world.material('#293d59',{roughness:.36,metalness:.25}),[0,.23,0],[.5,.38,.5],ufo);
      f.ring(this.basic('#80ffe0'),.9,.032,[0,-.07,0],ufo).rotation.x=Math.PI/2;
      for(let i=0;i<8;i++){const a=i*TAU/8;f.egg(this.basic(i%2?'#d1a6ff':'#86ffe6'),[Math.sin(a)*.96,-.09,Math.cos(a)*.96],[.075,.055,.075],ufo);}
      f.batch(ufo);
      const beam=f.mesh(f.geo('beam',()=>new T.CylinderGeometry(.22,1.45,3.3,24,1,true)),this.membrane('#72f8c8'),[0,2.3,0],[1,1,1],g);beam.name='ufo-tractor-beam';
      const beamRings=[];
      for(let i=0;i<3;i++){const r=f.ring(this.basic('#a0ffe6',.3),1,.016,[0,1,0],g);r.rotation.x=Math.PI/2;beamRings.push(r);}
      const block=f.ring(this.basic('#c2ffdf',.8),1,.055,[0,1.2,1],g);block.name='shield-impact';
      const nitro=f.ring(this.basic('#ffdc91',.85),.55,.045,[0,2.8,-.7],g);nitro.name='nitro-refill';nitro.rotation.x=Math.PI/2;
      const linkGeometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(18*3),3).setUsage(T.DynamicDrawUsage));
      const link=new T.Line(linkGeometry,this.basic('#ffb0ae',.72));this.world.effectsGroup.add(link);link.name='magnet-tether';link.frustumCulled=false;
      const magnet=this.group(g,'magnet-direction');
      for(const side of [-1,1]){const m=f.ring(this.basic(side>0?'#ff9d92':'#89dcff'),.6,.065,[side*.72,1.15,1.1],magnet,Math.PI*1.35);m.rotation.z=side*.6;}
      f.batch(magnet);
      this.noShadow(g);
      for(const obj of [shield,bubble,zap,bolt,ufo,beam,block,nitro,link,magnet,...beamRings])obj.visible=false;
      return this.enhanceState({g,model,timers,previous,shield,bubble,shine,zap,bolt,ufo,beam,beamRings,block,nitro,link,magnet,emission:0});
    }
    createBoxes() {
      this.boxes=this.race.boxes.map(box=>{
        const g=this.group(this.world.itemsGroup,'item-box');g.position.set(box.x,1.1,box.z);
        this.world.rounded(1.1,1.1,1.1,'#4a90d9',0,0,0,g);
        const mat=this.world.textMaterial('?','#4a90d9','#fff7e3',128,128);
        for(const side of [-.56,.56]){const m=this.world.mesh(new T.PlaneGeometry(.8,.8),mat,0,0,side,g);m.rotation.y=side<0?Math.PI:0;m.castShadow=false;}
        return g;
      });
    }
    createBanana() {
      const g=this.group(this.world.itemsGroup,'banana-peel'),f=this.factory;
      const mat=this.world.material('#f2c23d',{roughness:.85});
      for(let i=0;i<3;i++) {
        const a=i*TAU/3,points=[[0,.6,0],[Math.sin(a)*.27,.27,Math.cos(a)*.27],[Math.sin(a)*.68,.1,Math.cos(a)*.68],[Math.sin(a)*.83,.14,Math.cos(a)*.83]];
        f.tube(mat,points,.14,g);
      }
      f.egg(this.world.material('#805a32'),[0,.62,0],[.075,.17,.075],g);f.batch(g);g.visible=false;return g;
    }
    createWater() {
      const g=this.group(this.world.itemsGroup,'water-bomb'),f=this.factory;
      const orb=f.mesh(f.geo('water-orb',()=>new T.SphereGeometry(.58,16,12)),this.membrane('#57d0ff'),[0,0,0],[1,1,1],g);
      const ring=f.ring(this.basic('#b0eaff',.55),1,.055,[0,.03,0],g);ring.rotation.x=Math.PI/2;
      this.noShadow(g);g.userData={orb,ring};g.visible=false;return g;
    }
    createMissile() {
      const g=this.group(this.world.itemsGroup,'homing-missile'),f=this.factory;
      f.egg(this.world.material('#cb5542',{roughness:.45,metalness:.18}),[0,0,0],[.24,.24,.7],g);
      f.egg(f.white,[0,0,.58],[.23,.23,.27],g);
      for(const side of [-1,1]){const fin=f.egg(f.dark,[side*.27,0,-.35],[.2,.05,.3],g);fin.rotation.y=side*-.3;}
      f.batch(g);
      const flame=f.mesh(f.geo('missile-flame',()=>new T.ConeGeometry(.18,.85,8)),this.basic('#ffda88',.8),[0,0,-1],[1,1,1],g);flame.rotation.x=-Math.PI/2;flame.castShadow=false;
      g.userData.flame=flame;g.visible=false;return g;
    }
    burst(car,kind,amount=14) {
      if(this.world.reducedMotion)return;
      const color={lightning:'#b9ccff',water:'#86e7ff',ufo:'#89ffd2',missile:'#ffbf68',banana:'#f4da8a',shield:'#ffda82',nitro:'#ffd788',magnet:'#ffa3a4'}[kind]||'#fff4d6';
      this.tint.set(color);
      for(let j=0;j<Math.ceil(amount*this.world.effectDensity);j++) {
        const pool=kind==='missile'&&j%3===0?this.puff:this.spark,i=pool.cursor++%pool.count,a=pool.mesh.geometry.attributes;
        const angle=this.rand()*TAU,speed=1.3+this.rand()*3;
        pool.owner[i]=car.id;pool.life[i]=pool.duration[i]=.3+this.rand()*.55;pool.size[i]=pool.spark?.14+this.rand()*.22:.7;pool.opacity[i]=pool.spark?.85:.35;
        a.position.array.set([car.x,kind==='water'?1.2:.9,car.z],i*3);
        a.aTint.array.set([this.tint.r,this.tint.g,this.tint.b],i*3);a.aSize.array[i]=pool.size[i];a.aOpacity.array[i]=pool.opacity[i];a.aRotation.array[i]=angle;
        pool.velocity.set([Math.sin(angle)*speed,1+this.rand()*3,Math.cos(angle)*speed],i*3);
      }
    }
    exhaustTrail(car) {
      const pool=this.spark,a=pool.mesh.geometry.attributes,hx=Math.sin(car.heading),hz=Math.cos(car.heading);
      this.tint.set('#84e4ff');
      for(const side of [-1,1]) {
        const i=pool.cursor++%pool.count;pool.owner[i]=car.id;
        pool.life[i]=pool.duration[i]=.26;pool.size[i]=.22;pool.opacity[i]=.65;
        a.position.array.set([car.x-hx*2.2+hz*side*.66,.55,car.z-hz*2.2-hx*side*.66],i*3);
        a.aTint.array.set([this.tint.r,this.tint.g,this.tint.b],i*3);a.aSize.array[i]=.22;a.aOpacity.array[i]=.65;a.aRotation.array[i]=0;
        pool.velocity.set([-hx*4,.45,-hz*4],i*3);
      }
    }
    handle(event) {
      if(this.disposed)return;
      if(event.type==='finish'){this.reset();return;}
      const state=this.states[event.id],car=this.race.cars[event.id];if(!state||!car)return;
      if(event.type==='reset'){this.reset(event.id);return;}
      if(this.race.state!=='racing')return;
      if(event.type==='itemHit') {
        state.timers[event.item]=.36;
        // Mark the edge now, so one hit does not also trigger an activation burst next frame.
        state.previous[STATUS[event.item]]=car[STATUS[event.item]];
        this.burst(car,event.item,event.item==='missile'?24:14);
      } else if(event.type==='itemBlock') {
        state.timers.block=.5;state.previous.shield=0;this.burst(car,'shield',18);
        const source=this.race.cars[event.sourceId],angle=source?Math.atan2(source.x-car.x,source.z-car.z)-car.heading:0;
        state.block.position.set(Math.sin(angle)*1.6,1.2,Math.cos(angle)*1.6);state.block.rotation.y=angle;
      }
      else if(event.type==='itemUse'){state.timers['use-'+event.item]=.4;if(event.item==='nitro')this.burst(car,'nitro',8);}
    }
    reset(id) {
      for(const [i,s]of this.states.entries())if(id===undefined||id===i){s.timers={};s.previous={};s.emission=0;s.g.visible=false;s.link.visible=false;}
      for(const pool of [this.spark,this.puff]) {
        for(let i=0;i<pool.count;i++)if(id===undefined||pool.owner[i]===id){pool.life[i]=0;pool.mesh.geometry.attributes.aOpacity.array[i]=0;}
        pool.mesh.geometry.attributes.aOpacity.needsUpdate=true;
      }
      if(id===undefined){this.seenWater.clear();for(const [key,p]of this.projectiles){p.model.visible=false;this.pool(p.kind).push(p.model);}this.projectiles.clear();}
    }
    updateProjectiles(dt) {
      const active=new Set(), reduced=this.world.reducedMotion;
      this.boxes.forEach((m,i)=>{m.visible=this.race.boxes[i].respawn<=0;if(!reduced){m.rotation.y=this.time*1.4;m.position.y=1.1+Math.sin(this.time*2+i)*.12;}});
      for(const h of [...this.race.hazards,...this.race.missiles]) {
        const kind=h.kind||'missile',key=h.visualId??h;active.add(key);
        let p=this.projectiles.get(key);
        if(!p){const model=this.pool(kind).pop();if(!model)continue;p={model,kind,carry:0};this.projectiles.set(key,p);}
        const m=p.model;m.visible=true;
        if(kind==='banana'){m.position.set(h.x,.2,h.z);continue;}
        if(kind==='water') {
          const {orb,ring}=m.userData,u=C.clamp(1-h.arm/.8,0,1);
          m.position.set(h.x,.22,h.z);orb.visible=h.arm>0;ring.visible=h.arm<=0;
          if(h.arm>0){orb.position.set(C.lerp(h.originX??h.x,h.x,u)-h.x,.65+Math.sin(u*Math.PI)*5.2,C.lerp(h.originZ??h.z,h.z,u)-h.z);ring.scale.setScalar(.01);}
          else {ring.scale.setScalar(7*C.clamp((.5-h.blast)/.5,0,1));ring.material.opacity=.55*C.clamp(h.blast/.5,0,1);if(!this.seenWater.has(key)){this.seenWater.add(key);this.burst({x:h.x,z:h.z,id:h.from},'water',22);}}
        } else {
          const pos=C.sample(this.race.track,h.progress,h.lateral);m.position.set(pos.x,.8,pos.z);m.rotation.y=pos.heading;
          m.userData.flame.scale.y=reduced?1:1+Math.sin(this.time*25)*.13;
          p.carry+=dt;
          if(!reduced&&p.carry>.075){p.carry=0;this.burst({x:pos.x-Math.sin(pos.heading),z:pos.z-Math.cos(pos.heading),id:h.from},'missile',2);}
        }
      }
      for(const [key,p]of this.projectiles)if(!active.has(key)){p.model.visible=false;this.pool(p.kind).push(p.model);this.projectiles.delete(key);this.seenWater.delete(key);}
    }
    update(dt) {
      if(this.disposed)return;
      if(this.race.state==='paused')dt=0;
      const active=this.race.state==='racing'||this.race.state==='paused';
      if(!active&&this.wasActive)this.reset();
      this.wasActive=active;
      this.time+=dt;
      if(active)this.updateProjectiles(dt);
      const reduced=this.world.reducedMotion;
      for(let id=0;id<this.states.length;id++) {
        const s=this.states[id],car=this.race.cars[id];s.g.visible=active&&car.finishTime===null;s.link.visible=false;
        if(!s.g.visible)continue;
        for(const key of Object.keys(s.timers))s.timers[key]=Math.max(0,s.timers[key]-dt);
        for(const [kind,field]of Object.entries(STATUS)){
          if((s.previous[field]||0)>0&&car[field]<=0){s.timers['end-'+kind]=kind==='ufo'?.5:.32;if(kind==='water')this.burst(car,'water',22);}
          s.previous[field]=car[field];
        }
        const far=Math.hypot(car.x-this.race.player.x,car.z-this.race.player.z)>55;
        const visualTime=reduced?0:this.time;
        s.zap.visible=car.zap>0;s.bolt.visible=(s.timers.lightning||0)>0;
        s.bolt.scale.setScalar(reduced?1:.97+Math.min(.03,(s.timers.lightning||0)*.1));
        s.shield.visible=car.shield>0||(s.timers['end-shield']||0)>0;
        s.shield.material.uniforms.alpha.value=car.shield>0?Math.min(1,car.shield/.35):(s.timers['end-shield']||0)/.32;
        s.shield.material.uniforms.clock.value=visualTime;
        const opening=reduced?1:1-(s.timers['use-shield']||0)/.4;
        s.shield.scale.set(0.9+opening*.1,(0.9+opening*.1)*.88,0.9+opening*.1);
        s.bubble.visible=car.bubble>0;s.shine.visible=!far&&this.world.effectDensity===1;
        s.bubble.scale.set(1+Math.sin(visualTime*3)*.025,.98+Math.cos(visualTime*4)*.025,1);
        s.bubble.material.uniforms.clock.value=visualTime;
        s.ufo.visible=car.ufo>0||(s.timers['end-ufo']||0)>0;
        const depart=car.ufo>0?0:1-(s.timers['end-ufo']||0)/.5;
        const arrive=reduced?1:C.clamp((3-car.ufo)/.18,0,1);
        s.ufo.position.set(0,4.05+(reduced?0:Math.sin(this.time*2)*.055+depart*2.2+(1-arrive)*.3),0);
        s.ufo.rotation.y=visualTime*2;s.ufo.scale.setScalar(car.ufo>0?.8+arrive*.2:Math.max(.001,1-depart));
        s.beam.visible=car.ufo>0;s.beam.material.uniforms.clock.value=visualTime;
        s.beamRings.forEach((r,i)=>{r.visible=car.ufo>0&&!far&&(i===0||this.world.effectDensity===1);const u=reduced?i/3:(this.time*.7+i/3)%1;r.position.y=.7+u*3.1;r.scale.setScalar(1.3-u);});
        s.block.visible=(s.timers.block||0)>0;const blockAge=1-(s.timers.block||0)/.5;s.block.scale.setScalar(.4+blockAge*1.7);s.block.material.opacity=.8*(1-blockAge);
        s.nitro.visible=(s.timers['use-nitro']||0)>0;const refill=1-(s.timers['use-nitro']||0)/.4;s.nitro.position.y=2.8-(reduced?0:refill*1.5);s.nitro.scale.setScalar(1-refill*.7);s.nitro.material.opacity=1-refill;
        const target=this.race.cars[car.magnetTarget];s.magnet.visible=car.magnet>0&&!!target&&target.finishTime===null;
        if(s.magnet.visible) {
          s.link.visible=true;const a=s.link.geometry.attributes.position;
          for(let j=0;j<a.count;j++){const u=j/(a.count-1);a.setXYZ(j,C.lerp(car.x,target.x,u),1+Math.sin(u*Math.PI)*.8+(reduced?0:Math.sin(u*TAU*3-this.time*8)*.1),C.lerp(car.z,target.z,u));}
          a.needsUpdate=true;
        }
        this.updatePresentation(s,car,far);
        if(!reduced&&!far&&dt>0&&(car.zap>0||car.ufo>0||car.slip>0||car.boost>0)){
          s.emission+=dt;if(s.emission>.15){s.emission=0;if(car.zap>0||car.ufo>0||car.slip>0)this.burst(car,car.zap>0?'lightning':car.ufo>0?'ufo':'banana',2);else this.exhaustTrail(car);}
        }
      }
      for(const pool of [this.spark,this.puff]) {
        this.world.ageParticles(pool,dt);pool.active=0;
        for(let i=0;i<pool.count;i++)if(pool.life[i]>0)pool.active++;
        pool.mesh.visible=active&&!reduced&&pool.active>0;
        pool.mesh.material.uniforms.uScale.value=this.world.canvas.height/(2*Math.tan(this.world.camera.fov*Math.PI/360));
        for(const a of Object.values(pool.mesh.geometry.attributes))a.needsUpdate=true;
      }
    }
    stats(){return {particles:this.spark.active+this.puff.active,capacity:this.spark.count+this.puff.count,projectiles:this.projectiles.size,states:this.states.map(s=>({pose:s.model.pose,lightning:s.zap.visible,bolt:s.bolt.visible,bubble:s.bubble.visible,ufo:s.ufo.visible,beam:s.beam.visible,shield:s.shield.visible,block:s.block.visible,magnet:s.link.visible,refill:s.nitro.visible}))};}
    dispose(){this.reset();this.disposed=true;this.states=[];this.free={};}
  }
  root.KartItemEffects=KartItemEffects;
})(globalThis);
