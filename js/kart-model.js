(function (root) {
  'use strict';
  const T = root.THREE, C = root.KartCore, TAU = Math.PI * 2;
  const signedPower = (x, power) => Math.sign(x) * Math.pow(Math.abs(x), power);

  // Procedural production model. Articulation stays below the physical race anchor.
  class KartModels {
    constructor(world) {
      this.world=world;this.geometry=new Map();
      this.white = world.material('#fff1d2', { roughness: .87, metalness: 0 });
      this.rubber = world.material('#222d3b', { roughness: 1 });
      this.dark = world.material('#233044', { roughness: .93 });
      this.yellow = world.material('#f3bf42', { roughness: .8 });
      this.faceTextures = new Set();
    }
    geo(key, make) { if (!this.geometry.has(key)) this.geometry.set(key, make()); return this.geometry.get(key); }
    mesh(g, mat, p, s, parent) {
      const m = new T.Mesh(g, mat); m.position.set(...p); m.scale.set(...s);
      m.castShadow = m.receiveShadow = true; parent.add(m); return m;
    }
    egg(mat, p, s, parent) {
      const extent=Math.max(...s), segments=extent<.2?10:extent<.5?14:20;
      return this.mesh(this.geo(`sphere:${segments}`, () => new T.SphereGeometry(1,segments,Math.max(6,segments/2))),mat,p,s,parent);
    }
    ring(mat, radius, width, p, parent, arc = TAU) {
      return this.mesh(this.geo(`ring:${radius}:${width}:${arc}`, () => new T.TorusGeometry(radius, width, 6, 24, arc)), mat, p, [1,1,1], parent);
    }
    tube(mat, points, radius, parent) {
      return this.mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))), 12, radius, 6, false), mat, [0,0,0], [1,1,1], parent);
    }
    // Merge each rigid assembly by material; joints remain independent draw groups.
    batch(group) {
      group.updateMatrixWorld(true);
      const inverse = group.matrixWorld.clone().invert(), batches = new Map(), originals = [];
      group.traverse(obj => {
        if (!obj.isMesh) return;
        const source = obj.geometry, g = source.index ? source.toNonIndexed() : source.clone();
        g.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, obj.matrixWorld));
        const key = obj.material.uuid;
        if (!batches.has(key)) batches.set(key, {material:obj.material, position:[],normal:[],uv:[]});
        const b=batches.get(key);
        for(const name of ['position','normal','uv']) if(g.attributes[name]) for(const v of g.attributes[name].array) b[name].push(v);
        g.dispose(); originals.push(obj);
        // Non-cached construction geometry must also be released after baking.
        if (![...this.geometry.values()].includes(source)) source.dispose();
      });
      originals.forEach(o=>o.removeFromParent());
      for(const b of batches.values()) {
        const g=new T.BufferGeometry();
        for(const [name,size] of [['position',3],['normal',3],['uv',2]]) if(b[name].length) g.setAttribute(name,new T.Float32BufferAttribute(b[name],size));
        const mesh=this.mesh(g,b.material,[0,0,0],[1,1,1],group); mesh.name='rigid-assembly';
      }
    }
    roundedOutline(width, length, radius, centerZ = 0) {
      const points = [];
      for (const [x,z,start] of [[width/2-radius,length/2-radius,0],[-width/2+radius,length/2-radius,Math.PI/2],[-width/2+radius,-length/2+radius,Math.PI],[width/2-radius,-length/2+radius,Math.PI*1.5]]) {
        for (let i=0;i<12;i++) {
          const a=start+i/11*Math.PI/2;
          points.push(new T.Vector3(x+Math.cos(a)*radius,0,centerZ+z+Math.sin(a)*radius));
        }
      }
      return points;
    }
    surface(rings, inward = false) {
      const positions=[],indices=[],count=rings[0].length;
      for(const ring of rings)for(const p of ring)positions.push(p.x,p.y,p.z);
      for(let r=0;r<rings.length-1;r++)for(let j=0;j<count;j++) {
        const a=r*count+j,b=(r+1)*count+j,c=(r+1)*count+(j+1)%count,d=r*count+(j+1)%count;
        indices.push(...(inward?[a,b,c,a,c,d]:[a,c,b,a,d,c]));
      }
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
    }
    deck(z) { return .95-.2*C.clamp((z-.7)/1.3,0,1)-.03*C.clamp((-z-.8)/.9,0,1); }
    hull() {
      const outer=this.roundedOutline(2.36,3.68,.24,.12),inner=this.roundedOutline(1.18,1.68,.3,-.37),rings=[];
      // One continuous annular deck wraps the actual open cockpit; the same vertices roll down into the sidewall.
      for(const s of [0,.06,.15,.3,.5,.7,.85,.94,1])rings.push(outer.map((p,j)=>{
        const x=C.lerp(inner[j].x,p.x,s),z=C.lerp(inner[j].z,p.z,s);
        const taper=1-.18*C.clamp((z-.7)/1.3,0,1);
        const shoulder=.065*Math.sin(s*Math.PI)*C.clamp(Math.abs(x)/.9,0,1);
        return new T.Vector3(x*taper,this.deck(z)+shoulder-.16*s**6,z);
      }));
      const rim=rings[rings.length-1];
      for(const s of [.25,.6,1])rings.push(rim.map(p=>new T.Vector3(p.x*(1+.015*Math.sin(s*Math.PI)-.025*s),C.lerp(p.y,.39,s),p.z)));
      return { geometry:this.surface(rings), lip:rings[0], bottom:rings[rings.length-1] };
    }
    helmet() {
      const positions=[],indices=[],uv=[],nx=48,ny=24;
      for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++) {
        const v=y/ny,u=x/nx,theta=v*Math.PI,phi=u*TAU;
        const s=Math.pow(Math.sin(theta),.77);
        positions.push(.69*s*signedPower(Math.cos(phi),.74),.65*signedPower(Math.cos(theta),.78),-.035+.61*s*signedPower(Math.sin(phi),.74));uv.push(u,v);
      }
      for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x,b=a+nx+1;indices.push(a,b,a+1,a+1,b,b+1);}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
      // Parameterization runs clockwise as seen from outside.
      const n=g.attributes.normal,p=g.attributes.position;let sign=0;
      for(let i=0;i<n.count;i++)sign+=n.getX(i)*p.getX(i)+n.getY(i)*p.getY(i)+n.getZ(i)*p.getZ(i);
      if(sign<0){for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];g.setIndex(indices);g.computeVertexNormals();}
      return g;
    }
    faceAtlas() {
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
      const ctx=canvas.getContext('2d');
      for(let frame=0;frame<4;frame++) {
        ctx.save();ctx.translate(frame*256,0);ctx.fillStyle='#ffe6bd';ctx.fillRect(0,0,256,256);
        ctx.strokeStyle=ctx.fillStyle='#1b3040';ctx.lineCap='round';ctx.lineJoin='round';
        for(const side of [-1,1]) {
          const x=128+side*48;
          if(frame===2){ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(x+side*14,100);ctx.lineTo(x-side*10,112);ctx.lineTo(x+side*14,126);ctx.stroke();}
          else {
            ctx.fillStyle='#1b3040';ctx.beginPath();ctx.ellipse(x,113,frame===1?15:13,frame===1?28:24,-side*.06,0,TAU);ctx.fill();
            ctx.fillStyle='#fff9ed';ctx.beginPath();ctx.ellipse(x-3,103,3.3,5,0,0,TAU);ctx.fill();
          }
          ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(x-18,frame===1?64:side<0?70:74);ctx.quadraticCurveTo(x,frame===1?53:side<0?62:72,x+18,frame===1?65:side<0?77:69);ctx.stroke();
        }
        ctx.lineWidth=5;ctx.beginPath();
        if(frame===1){ctx.ellipse(128,177,11,16,0,0,TAU);ctx.stroke();}
        else if(frame===2){ctx.moveTo(110,179);ctx.quadraticCurveTo(128,168,147,177);ctx.stroke();}
        else {ctx.moveTo(108,173);ctx.bezierCurveTo(119,185,141,185,152,167);ctx.stroke();}
        ctx.restore();
      }
      const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.repeat.set(.25,1);texture.anisotropy=4;this.faceTextures.add(texture);return texture;
    }
    helmetFront(x,y) {
      const s=Math.pow(Math.max(.001,1-Math.pow(Math.abs(y)/.65,2/.78)),.77/2);
      return -.035+.61*s*Math.pow(Math.max(.001,1-Math.pow(Math.abs(x)/(.69*s),2/.74)),.74/2);
    }
    faceOutline() {
      return Array.from({length:64},(_,i)=>{
        const a=i/64*TAU,v=Math.sin(a);
        return new T.Vector2(.55*signedPower(Math.cos(a),.8)*(1-.15*Math.max(0,-v)),-.075+.40*signedPower(v,.8));
      });
    }
    faceDepth(x,y) {return this.helmetFront(x,y)+.014;}
    faceGeometry(outline=this.faceOutline(),center=new T.Vector2(0,-.075),offset=0,depth=(x,y)=>this.faceDepth(x,y)) {
      const positions=[],uv=[],indices=[],n=outline.length;
      // Conform the whole face to the helmet, including the cheeks and tapered chin.
      // Rings add curvature across the interior instead of stretching a flat face card.
      for(let r=0;r<=10;r++)for(const edge of outline){
        const p=center.clone().lerp(edge,r/10);
        positions.push(p.x,p.y,depth(p.x,p.y)+offset);
        uv.push(p.x/1.1+.5,(p.y+.075)/.8+.5);
      }
      for(let r=0;r<10;r++)for(let i=0;i<n;i++){const a=r*n+i,b=(r+1)*n+i,c=(r+1)*n+(i+1)%n,d=r*n+(i+1)%n;indices.push(a,b,c,a,c,d);}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
    }
    contour(points,material,radius,parent,closed=true,segments=64) {
      const curve=new T.CatmullRomCurve3(points,closed);
      return this.mesh(new T.TubeGeometry(curve,segments,radius,6,closed),material,[0,0,0],[1,1,1],parent);
    }
    goggles(head) {
      const group=new T.Group();group.name='optional-racing-goggles';head.add(group);
      // A single swept lens with restrained, static emission; no bloom or flashing.
      const frame=new T.MeshStandardMaterial({color:'#263849',roughness:.42,metalness:.48});
      const light=new T.MeshBasicMaterial({color:'#70edff',toneMapped:false});
      const halo=new T.MeshBasicMaterial({color:'#37bfe8',transparent:true,opacity:.13,depthWrite:false,toneMapped:false});
      const depth=x=>.659-.40*x*x;
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
      const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,100,256);
      gradient.addColorStop(0,'#355476');gradient.addColorStop(.38,'#102a47');gradient.addColorStop(.75,'#081827');gradient.addColorStop(1,'#154853');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,512,256);
      ctx.fillStyle='#a3e8fa';ctx.globalAlpha=.24;ctx.beginPath();ctx.moveTo(20,60);ctx.lineTo(325,34);ctx.lineTo(445,59);ctx.lineTo(155,86);ctx.closePath();ctx.fill();ctx.globalAlpha=1;
      const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;this.faceTextures.add(texture);
      const lens=new T.MeshStandardMaterial({map:texture,roughness:.27,metalness:.22,emissive:'#7294bd',emissiveMap:texture,emissiveIntensity:.20});
      const control=[[-.63,.09],[-.56,.22],[-.29,.245],[0,.22],[.29,.245],[.56,.22],[.63,.09],[.53,-.13],[.30,-.17],[0,-.12],[-.30,-.17],[-.53,-.13]].reverse();
      const curve=new T.CatmullRomCurve3(control.map(p=>new T.Vector3(p[0],p[1],0)),true,'centripetal');
      const outline=curve.getSpacedPoints(96).slice(0,-1).map(p=>new T.Vector2(p.x,p.y));
      this.contour(outline.map(p=>new T.Vector3(p.x,p.y,depth(p.x))),frame,.023,group);
      const geometry=this.faceGeometry(outline,new T.Vector2(0,.035),0,depth),uv=geometry.attributes.uv,position=geometry.attributes.position;
      for(let i=0;i<uv.count;i++)uv.setXY(i,position.getX(i)/1.3+.5,(position.getY(i)+.19)/.46);
      const glass=this.mesh(geometry,lens,[0,0,0],[1,1,1],group);glass.name='sci-fi-single-visor';glass.castShadow=glass.receiveShadow=false;
      const line=(points,material,radius,offset=.01)=>{const mesh=this.contour(points.map(([x,y])=>new T.Vector3(x,y,depth(x)+offset)),material,radius,group,false,Math.max(6,points.length*3));mesh.castShadow=mesh.receiveShadow=false;return mesh;};
      const brow=[[-.595,.16],[-.52,.225],[-.29,.252],[0,.228],[.29,.252],[.52,.225],[.595,.16]];
      line(brow,halo,.024,.03);line(brow,light,.009,.033);
      for(const side of [-1,1]) {
        line([[side*.60,.045],[side*.52,-.125],[side*.34,-.167]],light,.006,.03);
        line([[side*.45,.085],[side*.39,.09],[side*.375,.045]],light,.004);
        for(let i=0;i<3;i++)line([[side*(.445-i*.025),-.065],[side*(.445-i*.025),-.047]],light,.003);
        this.world.rounded(.075,.16,.20,frame,side*.652,.055,.39,group);
        this.world.rounded(.018,.065,.1,light,side*.709,.055,.405,group);
      }
      const strap=[];
      for(let i=0;i<=56;i++){const a=.85+(TAU-1.7)*i/56;strap.push(new T.Vector3(.704*signedPower(Math.sin(a),.74),.015,-.035+.624*signedPower(Math.cos(a),.74)));}
      for(const side of [-1,1])this.tube(frame,[[side*.60,.015,depth(.60)],[side*.65,.015,.42],[side*strap[0].x,.015,strap[0].z]],.026,group);
      this.contour(strap,frame,.032,group,false);
      this.batch(group);group.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=false;});
      group.visible=false;return group;
    }
    band() {
      const positions=[],indices=[];
      for(let i=0;i<=48;i++) {
        const a=-Math.PI+.15+(Math.PI+.72)*i/48;
        for(const side of [-1,1])positions.push(side*.062,.659*signedPower(Math.cos(a),.78),-.035+.625*signedPower(Math.sin(a),.77));
      }
      for(let i=0;i<48;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
    }
    deckPart(points,y,height,material,parent) {
      const shape=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));
      const geometry=new T.ExtrudeGeometry(shape,{depth:height,bevelEnabled:true,bevelSize:.018,bevelThickness:.012,bevelSegments:2,steps:1});
      const mesh=this.mesh(geometry,material,[0,y,0],[1,1,1],parent);mesh.rotation.x=-Math.PI/2;return mesh;
    }
    create(color='#298fe0', options={}) {
      options={faceStyle:'goggles',...options};
      const group=new T.Group(),visual=new T.Group(),body=new T.Group();group.add(visual);visual.add(body);this.world.carsGroup.add(group);
      group.name='kart-physics-anchor';visual.name='kart-whole-vehicle';body.name='kart-suspension';
      const paint=new T.MeshStandardMaterial({color,roughness:.59,metalness:.08});
      const helmetPaint=new T.MeshStandardMaterial({color,roughness:.86,metalness:0});
      const suit=new T.MeshStandardMaterial({color,roughness:1});
      const {white,dark,rubber,yellow}=this;
      const pearl=new T.MeshStandardMaterial({color:'#dcebf1',roughness:.65,metalness:.12});
      const alloy=new T.MeshStandardMaterial({color:'#698398',roughness:.46,metalness:.48});
      const cyan=new T.MeshBasicMaterial({color:'#70edff',toneMapped:false});
      const tailLight=new T.MeshBasicMaterial({color:'#ff7868',toneMapped:false});
      const shell=this.hull();const shellMesh=this.mesh(shell.geometry,paint,[0,0,0],[1,1,1],body);shellMesh.name='continuous-cockpit-shell';
      const floor=shell.lip.map(p=>new T.Vector3(p.x*.82,.47,p.z));
      this.mesh(this.surface([shell.lip,floor],true),dark,[0,0,0],[1,1,1],body);
      const floorShape=new T.Shape();floor.forEach((p,i)=>i?floorShape.lineTo(p.x,-p.z):floorShape.moveTo(p.x,-p.z));floorShape.closePath();
      const floorMesh=this.mesh(new T.ShapeGeometry(floorShape),dark,[0,.47,0],[1,1,1],body);floorMesh.rotation.x=-Math.PI/2;
      // Narrow, tapered pearl insert sits on the continuous nose rather than replacing the shell.
      const positions=[],indices=[],columns=8;
      shellMesh.updateMatrixWorld(true);
      const ray=new T.Raycaster(new T.Vector3(),new T.Vector3(0,-1,0));
      for(let i=0;i<=24;i++) {
        const u=i/24,z=.68+u*1.14,w=.13+.17*Math.sin(u*Math.PI);
        for(let j=0;j<=columns;j++) {
          const x=(j/columns*2-1)*w;
          ray.ray.origin.set(x,3,z);
          const hit=ray.intersectObject(shellMesh,false)[0];
          positions.push(x,(hit?hit.point.y:this.deck(z))+.006,z);
        }
      }
      for(let i=0;i<24;i++)for(let j=0;j<columns;j++){const a=i*(columns+1)+j,b=a+columns+1;indices.push(a,b,a+1,a+1,b,b+1);}
      const inlay=new T.BufferGeometry();inlay.setAttribute('position',new T.Float32BufferAttribute(positions,3));inlay.setIndex(indices);inlay.computeVertexNormals();
      this.mesh(inlay,pearl,[0,0,0],[1,1,1],body);
      this.deckPart([[-.94,1.93],[0,2.03],[.94,1.93],[1.04,1.52],[.83,1.40],[-.83,1.40],[-1.04,1.52]],.34,.075,dark,body);
      this.world.rounded(.58,.095,.04,dark,0,.535,1.971,body);
      this.world.rounded(.15,.035,.025,cyan,0,.54,2.0,body);
      for(const side of [-1,1]) {
        const lamps=[[side*.42,.64,1.977],[side*.67,.67,1.951],[side*.87,.71,1.86]];
        this.contour(lamps.map(p=>new T.Vector3(...p)),dark,.054,body,false,12);
        this.contour(lamps.map(([x,y,z])=>new T.Vector3(x,y,z+.038)),cyan,.019,body,false,12);
        const hoodLine=[];
        for(let i=0;i<=12;i++){const z=.86+i/12*.70,x=side*(.50+.05*Math.sin(i/12*Math.PI));ray.ray.origin.set(x,3,z);const hit=ray.intersectObject(shellMesh,false)[0];hoodLine.push(new T.Vector3(x,(hit?hit.point.y:this.deck(z))+.012,z));}
        this.contour(hoodLine,alloy,.009,body,false,18);
        const ventPoints=[[side*1.202,.56,-.62],[side*1.205,.77,-.45],[side*1.205,.77,.40],[side*1.202,.56,.22]];
        const vent=new T.BufferGeometry();vent.setAttribute('position',new T.Float32BufferAttribute(ventPoints.flat(),3));vent.setIndex(side>0?[0,1,2,0,2,3]:[0,2,1,0,3,2]);vent.computeVertexNormals();
        this.mesh(vent,dark,[0,0,0],[1,1,1],body);
        for(let i=0;i<3;i++)this.tube(alloy,[[side*1.215,.59,-.37+i*.19],[side*1.215,.735,-.27+i*.19]],.012,body);
        this.tube(cyan,[[side*1.207,.50,-.56],[side*1.207,.50,.1],[side*1.19,.53,.27]],.011,body);
        this.world.rounded(.36,.065,.045,tailLight,side*.80,.76,-1.756,body);
        this.world.rounded(.075,.36,.1,dark,side*.8,1.03,-1.32,body);
        const pipe=this.mesh(this.geo('tech-thruster',()=>new T.CylinderGeometry(.19,.22,.36,8,1,true)),alloy,[side*.66,.49,-1.84],[1,1,1],body);pipe.rotation.x=Math.PI/2;
        const nozzle=this.mesh(this.geo('tech-nozzle',()=>new T.CircleGeometry(.17,16)),dark,[side*.66,.49,-2.025],[1,1,1],body);nozzle.rotation.y=Math.PI;
        this.ring(cyan,.139,.018,[side*.66,.49,-2.033],body).rotation.y=Math.PI;
        this.egg(alloy,[side*.66,.49,-2.036],[.062,.062,.012],body);
        this.world.rounded(.052,.24,.43,dark,side*1.025,1.29,-1.46,body);
        this.world.rounded(.018,.042,.21,cyan,side*1.063,1.29,-1.48,body);
      }
      this.deckPart([[-1.03,-1.67],[-.35,-1.53],[.35,-1.53],[1.03,-1.67],[1.03,-1.26],[.30,-1.15],[-.30,-1.15],[-1.03,-1.26]],1.20,.11,paint,body);
      this.tube(cyan,[[-.95,1.325,-1.64],[-.32,1.325,-1.51],[.32,1.325,-1.51],[.95,1.325,-1.64]],.01,body);
      this.deckPart([[-.15,-1.50],[.15,-1.50],[.15,-1.2],[-.15,-1.2]],1.322,.008,pearl,body);
      this.world.rounded(.94,.14,.13,dark,0,.365,-1.73,body);
      for(const x of [-.35,0,.35])this.world.rounded(.035,.16,.30,alloy,x,.365,-1.8,body);
      this.world.rounded(.83,.53,.18,dark,0,1.02,-.94,body);
      this.world.rounded(.64,.36,.035,white,0,1.06,-.83,body);
      this.batch(body);
      const wheels=[];
      for(const side of [-1,1])for(const z of [-1.04,1.10]) {
        const pivot=new T.Group(),roll=new T.Group();pivot.position.set(side*1.24,.49,z);pivot.add(roll);visual.add(pivot);
        const profile=[[.24,-.23],[.39,-.23],[.47,-.17],[.495,-.08],[.495,.08],[.47,.17],[.39,.23],[.24,.23]].map(([r,y])=>new T.Vector2(r,y));
        const tire=this.mesh(this.geo('classic-tire',()=>new T.LatheGeometry(profile,24)),rubber,[0,0,0],[1,1,1],roll);tire.rotation.z=Math.PI/2;
        const hub=this.mesh(this.geo('classic-hub',()=>new T.CylinderGeometry(.255,.255,.43,16)),dark,[0,0,0],[1,1,1],roll);hub.rotation.z=Math.PI/2;
        this.ring(alloy,.232,.021,[side*.234,0,0],roll).rotation.y=Math.PI/2;
        for(let i=0;i<5;i++){const a=i*TAU/5;this.tube(pearl,[[side*.24,Math.cos(a)*.07,Math.sin(a)*.07],[side*.24,Math.cos(a+.28)*.15,Math.sin(a+.28)*.15],[side*.24,Math.cos(a+.32)*.21,Math.sin(a+.32)*.21]],.03,roll);}
        this.egg(cyan,[side*.255,0,0],[.018,.055,.055],roll);
        this.batch(roll);wheels.push({pivot,roll,front:z>0});
      }
      const driver=new T.Group();driver.position.set(0,.84,-.37);body.add(driver);driver.name='classic-driver';
      this.egg(suit,[0,.23,0],[.31,.36,.255],driver);
      this.world.rounded(.13,.12,.028,yellow,0,.29,.255,driver);
      this.batch(driver);
      const legs=[];
      for(const side of [-1,1]) {
        const leg=new T.Group();leg.position.set(side*.175,.04,0);driver.add(leg);
        this.mesh(this.geo('classic-leg',()=>new T.CapsuleGeometry(.135,.25,4,10)),suit,[0,-.24,0],[1,1,1],leg);
        this.egg(white,[0,-.5,.1],[.19,.14,.245],leg);this.batch(leg);leg.rotation.x=options.characterOnly?0:-1.2;legs.push(leg);
      }
      const head=new T.Group();head.position.set(0,.90,0);driver.add(head);
      this.mesh(this.geo('classic-helmet',()=>this.helmet()),helmetPaint,[0,0,0],[1,1,1],head);
      const bandMaterial=new T.MeshStandardMaterial({color:'#fff1d2',roughness:.9,side:T.DoubleSide});
      this.mesh(this.geo('classic-helmet-band',()=>this.band()),bandMaterial,[0,0,0],[1,1,1],head);
      this.batch(head);
      const faceTexture=this.faceAtlas();
      const face=this.mesh(this.geo('classic-face',()=>this.faceGeometry()),new T.MeshStandardMaterial({map:faceTexture,roughness:1,metalness:0}),[0,0,0],[1,1,1],head);face.castShadow=false;
      face.receiveShadow=false;
      this.contour(this.faceOutline().map(p=>new T.Vector3(p.x,p.y,this.faceDepth(p.x,p.y))),dark,.014,head);
      const goggles=this.goggles(head);goggles.visible=options.faceStyle==='goggles';
      const eyes=new T.Group(),mouth=new T.Group(),visor=new T.Group(),brows=[];head.add(eyes,mouth,visor);
      const arms=[];
      for(const side of [-1,1]) {
        const arm=new T.Group();arm.position.set(side*.30,.4,.025);driver.add(arm);
        const points=options.characterOnly?[[0,0,0],[side*.065,-.23,.01],[side*.075,-.45,.065]]:[[0,0,0],[side*.08,-.15,.40],[-side*.015,-.19,.78]];
        this.tube(suit,points,.12,arm);const end=points[2];arm.userData.gripPoint=new T.Vector3(...end);this.egg(white,end,[.155,.15,.17],arm);this.batch(arm);arms.push(arm);
      }
      const steering=new T.Group();steering.position.set(0,1.045,.49);steering.rotation.x=-.55;body.add(steering);
      this.ring(dark,.32,.048,[0,0,0],steering);this.tube(white,[[-.27,0,0],[0,-.03,0],[.27,0,0]],.033,steering);this.batch(steering);
      const flames=[];
      for(const side of [-1,1]) {
        const flame=new T.Group();flame.position.set(side*.66,.47,-2.03);body.add(flame);flame.visible=false;flames.push(flame);
        for(const [r,len,col,alpha]of [[.19,1.4,'#25aef2',.6],[.09,.8,'#fff3c1',.95]]){
          const m=this.mesh(this.geo(`flame:${r}`,()=>new T.ConeGeometry(r,len,10)),new T.MeshBasicMaterial({color:col,transparent:true,opacity:alpha,depthWrite:false,toneMapped:false}),[0,0,-len/2],[1,1,1],flame);
          m.rotation.x=-Math.PI/2;m.castShadow=m.receiveShadow=false;
        }
      }
      if(options.characterOnly){visual.add(driver);driver.position.set(0,.65,0);body.visible=false;wheels.forEach(w=>w.pivot.visible=false);}
      if(options.vehicleOnly)driver.visible=false;
      return {group,visual,body,driver,head,eyes,brows,mouth,visor,face,faceTexture,goggles,legs,arms,steering,wheels,paint,helmetPaint,suit,flames,roll:0,lastSpeed:0,acceleration:0,pose:'drive',options};
    }
    color(model,color) {for(const key of ['paint','helmetPaint','suit']) model[key].color.set(color);}
    updatePose(model,car,dt,time,reduced,fx) {
      const running=this.world.race.state==='racing', active=running||this.world.race.state==='paused';
      const state=active ? car : { ...car, stun:0,bubble:0,zap:0,ufo:0,slip:0,boost:0,magnet:0 };
      const pose=state.stun>0?'missile':state.bubble>0?'water':state.zap>0?'lightning':state.ufo>0?'ufo':state.slip>0?'banana':'drive';
      model.pose=pose;
      const near=Math.hypot(car.x-this.world.race.player.x,car.z-this.world.race.player.z)<48;
      model.eyes.visible=model.visor.visible=model.mouth.visible=near;model.brows.forEach(b=>b.visible=near);
      model.group.position.set(car.x,.17,car.z);model.group.rotation.y=car.heading;
      if(dt>0) {model.acceleration=C.approach(model.acceleration,C.clamp((car.speed-model.lastSpeed)/dt,-30,30),dt,7);model.lastSpeed=car.speed;}
      model.roll=(model.roll+car.speed*dt/.49)%TAU;
      for(const w of model.wheels){w.pivot.rotation.y=w.front?car.steer*.34:0;w.roll.rotation.x=model.roll;}
      let yaw=0,lift=0,lean=0,pitch=0;
      if(!reduced) {
        if(pose==='missile'){const u=C.clamp(1-state.stun/1.1,0,1);yaw=TAU*(1-(1-u)**3);lift=Math.sin(Math.PI*u)*.3;}
        else if(pose==='water'){lift=.09+Math.sin(time*4)*.045;lean=Math.sin(time*5)*.07;}
        else if(pose==='lightning'){lean=Math.sin(time*27)*.035;pitch=Math.sin(time*19)*.025;}
        else if(pose==='ufo'){lift=.11;pitch=-.075;}
        else if(pose==='banana'){const u=C.clamp(1-state.slip/.9,0,1);yaw=car.slipDir*TAU*(u*u*(3-2*u));lean=Math.sin(u*Math.PI)*car.slipDir*.07;}
      }
      model.visual.rotation.set(pitch,yaw,lean);model.visual.position.y=lift;
      model.body.rotation.set(reduced?0:model.acceleration*.0018,0,reduced?0:-car.steer*Math.min(Math.abs(car.speed)/42,1)*.055);
      model.body.position.y=reduced?0:Math.sin(time*18)*Math.min(Math.abs(car.speed)*.00035,.012);
      model.driver.rotation.set(reduced?0:pose==='ufo'?-.13:state.boost>0||state.magnet>0?.09:0,0,reduced?0:-car.steer*.095-lean);
      model.head.rotation.set(reduced?0:pose==='lightning'?Math.sin(time*23)*.045:0,reduced?0:car.steer*.08,0);
      const hurt=pose!=='drive';model.eyes.scale.y=hurt?1.12:1;
      model.mouth.scale.y=.022*(hurt?3.2:1);model.brows.forEach((b,i)=>{b.rotation.z=hurt?(i?-.24:.24):(i?.09:-.09);b.position.y=hurt?.31:.285;});
      model.arms.forEach((arm,i)=>{arm.rotation.x=reduced?0:pose==='water'?Math.sin(time*6+i*Math.PI)*.22:pose==='lightning'?-.12:0;arm.rotation.z=reduced?0:car.steer*.12;});
      model.steering.rotation.z=car.steer*.42;
      model.flames.forEach((f,i)=>{f.visible=state.boost>0&&active;f.scale.z=reduced?1:1+Math.sin(time*25+i)*.12;});
    }
    update(model,car,dt,time,reduced) {
      this.updatePose(model,car,dt,time,reduced);
      model.face.visible=Math.hypot(car.x-this.world.race.player.x,car.z-this.world.race.player.z)<48;
      if(model.pose==='drive'&&!reduced&&!model.options.characterOnly)model.arms.forEach((arm,i)=>{arm.rotation.x=-(i===0?-1:1)*car.steer*.18;});
      model.visual.position.z=0;
      if(model.pose==='missile'&&!reduced){
        const u=C.clamp((1.1-car.stun)/.8,0,1),turn=u*u*(3-2*u);
        const angle=u<1?TAU*turn:0,centerY=1.05,lift=1.65*4*u*(1-u);
        // Rear impact lifts the tail first, pitching the nose down into one forward flip.
        // Rotate about the kart's center, so the driver and wheels follow the same airborne arc.
        // The physical anchor stays on the road; this never writes to the car simulation.
        model.visual.rotation.set(angle,0,0);
        model.visual.position.set(0,lift+centerY*(1-Math.cos(angle)),-centerY*Math.sin(angle));
      }
      const frame=model.pose==='drive'?0:model.pose==='water'||model.pose==='lightning'?2:1;
      model.faceTexture.offset.x=frame*.25;
      if(model.options.characterOnly){if(model.pose!=='missile')model.visual.position.y=0;model.driver.rotation.set(0,0,0);}
    }
    dispose(){for(const t of this.faceTextures)t.dispose();this.faceTextures.clear();for(const g of this.geometry.values())g.dispose();this.geometry.clear();}
  }
  root.KartModels=KartModels;
})(globalThis);
