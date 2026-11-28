import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSettings} from './settings.js';
import {applyTheme} from './theme.js';
import {resolveAttack} from './combat.js';
import {ABILITIES} from './data/abilities.js';
import {CREATURES} from './data/creatures.js';
import {initCapture,log as coreLog,downloadLog} from './log.js';
import {HUD} from './hud.js';

initCapture();
const log=(tag,...args)=>{HUD.message(args.join(' '),tag);coreLog(tag,...args);};
log('SESSION','RELTAK session log active. Press L in game to save it.');

// Simulation owns world-space movement. Only the input adapter knows view yaw.
const WALK_SPEED=3, RUN_SPEED=6, TURN_RESPONSE=12, CLEARING_RADIUS=23;
const CHARACTER_HEIGHT=2, MAX_FRAME_DELTA=0.05, ANIMATION_FADE=0.18;
// Player-owned view: no camera code writes to the simulation.
const CAMERA_MIN_DISTANCE=0.2, CAMERA_MAX_DISTANCE=20, CAMERA_DEFAULT_DISTANCE=6;
const CAMERA_DEFAULT_YAW=0, CAMERA_DEFAULT_PITCH=0.3;
const CAMERA_MIN_PITCH=-0.15, CAMERA_MAX_PITCH=1.3;
const CAMERA_HEAD_HEIGHT=1.65, CAMERA_HIDE_DISTANCE=1.2;
const CAMERA_LOCK_DISTANCE=CAMERA_HIDE_DISTANCE, CAMERA_LOOK_SENSITIVITY=0.003;
const CAMERA_ORBIT_SENSITIVITY=0.005, CAMERA_ZOOM_SENSITIVITY=0.0015;
const CAMERA_FOLLOW_RESPONSE=10, CAMERA_ZOOM_RESPONSE=14;
const INTRO_SECONDS=6;
// Combat staging only: dice live in combat.js, numbers in data/creatures.js.
const GOBLIN_SPAWN={x:0,z:-12};
const PLAYER_STAGGER_SECONDS=0.35, PLAYER_DEATH_RETURN_SECONDS=2.8, GOBLIN_FADE_SECONDS=3;
const PROJECTILE_FORWARD=new THREE.Vector3(0,0,1);
const PROJECTILE_CONNECT_RADIUS=0.4, PROJECTILE_MISS_OFFSET=2.6, PROJECTILE_GRAVITY=9.8;

const settings=loadSettings();
applyTheme(settings.theme);
document.documentElement.dataset.reduceMotion=String(settings.reduceMotion);
const fallback={name:'Wanderer',race:'Human',class:'Ranger'};
function loadCharacter(){
 try{
  const c=JSON.parse(localStorage.getItem('reltak.character'));
  return {name:typeof c?.name==='string'&&c.name.trim()?c.name.trim().slice(0,24):fallback.name,
   race:['Human','Elf','Orc'].includes(c?.race)?c.race:fallback.race,
   class:['Warrior','Ranger','Mage'].includes(c?.class)?c.class:fallback.class};
 }catch{return {...fallback};}
}
const character=loadCharacter();
const stats=CREATURES[character.class],goblinData=CREATURES.Goblin;
log('SESSION',character.name+' the '+character.race+' '+character.class+' wakes in the inn.');
const intro=document.getElementById('intro');
document.getElementById('tale').textContent='The tale of '+character.name+' the '+character.race+' '+character.class+' begins.';
const dismiss=()=>intro.classList.add('dismissed');
let introTimer;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080f22);scene.fog=new THREE.Fog(0x080f22,22,85);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setClearColor(0x080f22);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label','The inn, square and clearing. WASD move, Shift run, click attack, drag orbit, scroll zoom, L save log, Escape title.');
document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(55,1,0.05,160);
function resize(){
 const cap=settings.quality==='performance'?1:settings.quality==='balanced'?1.5:Infinity;
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,cap));
 renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
}
resize();window.addEventListener('resize',resize);
scene.add(new THREE.HemisphereLight(0xb9d2ff,0x25302b,1.4));
const moonlight=new THREE.DirectionalLight(0xc4d8ff,2.5);moonlight.position.set(-25,40,-30);scene.add(moonlight);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(220,220),new THREE.MeshStandardMaterial({color:0x253c38,roughness:1}));
ground.rotation.x=-Math.PI/2;scene.add(ground);
const moon=new THREE.Mesh(new THREE.SphereGeometry(3,16,12),new THREE.MeshBasicMaterial({color:0xe4edff,fog:false}));
moon.position.set(-30,45,-65);scene.add(moon);
const actor=new THREE.Group();scene.add(actor);
const view={yaw:CAMERA_DEFAULT_YAW,pitch:CAMERA_DEFAULT_PITCH,distance:CAMERA_DEFAULT_DISTANCE,targetDistance:CAMERA_DEFAULT_DISTANCE,anchor:new THREE.Vector3(0,CAMERA_HEAD_HEIGHT,0)};
const loader=new GLTFLoader();let model,mixer,activeAction,animationName='none';const actions={};
function play(name){
 const next=actions[name]||actions.Idle_A;if(!next||next===activeAction)return;
 activeAction?.fadeOut(ANIMATION_FADE);next.reset().fadeIn(ANIMATION_FADE).play();activeAction=next;animationName=next.getClip().name;
}
function fit(object,height){
 const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
 const scale=height/(size.y||1);object.scale.multiplyScalar(scale);
 object.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);return object;
}

// Curated painted maps; pack archives are not vendored. Metres per texture tile.
const surfaceLoader=new THREE.TextureLoader(),surfaceMaterials=new Map();
const surfaceKinds=new Map([
 [0x343039,['plaster-timber-wall',3,0xb8aa8c]],
 ...[0x3a3030,0x47372f,0x594435,0x4d302b,0x77523c,0x231c21,0x563b2d,0x684b34,0x392b2b].map(c=>[c,['dark-oak-floorboards',2,0x594435]]),
 ...[0x56505a,0x4a444d,0x69616a].map(c=>[c,['interior-stone-wall',2,0x69616a]])
]);
function innSurface(geometry,color){
 const spec=surfaceKinds.get(color);if(!spec)return new THREE.MeshStandardMaterial({color,roughness:.92});
 const [name,metres,fallbackColor]=spec;
 if(!surfaceMaterials.has(name)){
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.92});
  const texture=surfaceLoader.load('assets/textures/painted/'+name+'.jpg',()=>log('ASSET','Texture ready: '+name),undefined,()=>{
   material.map=null;material.color.setHex(fallbackColor);material.needsUpdate=true;log('ERROR','Texture unavailable: '+name);
  });
  texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());material.map=texture;
  surfaceMaterials.set(name,material);
 }
 // Local box-space projection preserves tile scale on walls, floors and narrow beams.
 const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
 for(let i=0;i<p.count;i++){
  if(Math.abs(n.getY(i))>.5)uv.setXY(i,p.getX(i)/metres,p.getZ(i)/metres);
  else if(Math.abs(n.getX(i))>.5)uv.setXY(i,p.getZ(i)/metres,p.getY(i)/metres);
  else uv.setXY(i,p.getX(i)/metres,p.getY(i)/metres);
 }
 uv.needsUpdate=true;return surfaceMaterials.get(name);
}

// The inn: roofless, camera-aware cutaway; dimensions in metres, no place names.
const innRoot=new THREE.Group(),innUpper=new THREE.Group(),innWalls=[],innSolids=[];
innRoot.position.x=40;scene.add(innRoot);innRoot.add(innUpper);
let inInn=true;const innAssets=[];
function innBox(x,y,z,w,h,d,color,group=innRoot,solid=false){
 const geometry=new THREE.BoxGeometry(w,h,d);
 const m=new THREE.Mesh(geometry,innSurface(geometry,color));
 m.position.set(x,y,z);group.add(m);
 if(solid)innSolids.push({x,z,w,d,y:y-h/2,top:y+h/2});return m;
}
function innWall(x,y,z,w,h,d,group=innRoot){const m=innBox(x,y,z,w,h,d,0x343039,group,true);innWalls.push(m);return m;}
function innLamp(x,y,z,color=0xffb36a,power=16){const light=new THREE.PointLight(color,power,8,2);light.position.set(x,y,z);innRoot.add(light);return light;}
function innProp(file,x,y,z,height,turn=0,w=.9,d=.9){
 innAssets.push(async()=>{const gltf=await loader.loadAsync('assets/environment/dungeon/'+file+'.gltf');
 const g=new THREE.Group();g.add(fit(gltf.scene.clone(true),height));g.position.set(x,y,z);g.rotation.y=turn;
 (y>=3?innUpper:innRoot).add(g);});
 innSolids.push({x,z,w,d,y,top:y+height});
}
innBox(0,-.15,0,12,.3,12,0x3a3030);
innBox(-1.5,3.05,0,9,.3,12,0x47372f,innUpper);
innBox(4.5,3.05,-5,3,.3,2,0x47372f,innUpper);
for(let i=0;i<16;i++){const h=3.2*(16-i)/16;innBox(4.4,h/2,-3.75+i*.5,2.5,h,.5,0x594435);}
for(const y of [1.5,4.7]){
 const g=y>3?innUpper:innRoot;
 innWall(-6,y,0,.25,3,12,g);innWall(6,y,0,.25,3,12,g);
 innWall(0,y,-6,12,3,.25,g);
 if(y<3){innWall(-3.7,y,6,4.6,3,.25,g);innWall(3.7,y,6,4.6,3,.25,g);innBox(0,2.85,6,2.8,.3,.3,0x563b2d);}
 else innWall(0,y,6,12,3,.25,g);
 for(const x of [-5.8,0,5.8])innBox(x,y, -5.8,.22,3,.3,0x231c21,g);
}
// Bedroom door into a short landing; the stairwell is open to the common room.
innWall(1,4.7,-3.5,.18,3,5,innUpper);innWall(1,4.7,3,.18,3,6,innUpper);
innBox(1,6,-.5,.26,.3,1,0x684b34,innUpper);
// Window opening is set into the west wall as a luminous inset with open shutters.
innBox(-5.83,4.9,-2,.08,1.25,1.65,0xc6b895,innUpper);
for(const z of [-3.05,-.95]){const shutter=innBox(-5.45,4.9,z,.1,1.5,.65,0x392b2b,innUpper);shutter.rotation.y=z<-2?-.6:.6;}
innLamp(-5.1,5,-2,0xffddb0,22);
innProp('bed_decorated',-3.9,3.2,-3.3,1.05,0,1.7,2.8);
innProp('chest',-4.6,3.2,1,.7,0,1.3,.8);
innProp('table_small',-3.8,3.2,4.7,.85,0,1.3,.8);
const basin=new THREE.Mesh(new THREE.TorusGeometry(.3,.08,8,20),new THREE.MeshStandardMaterial({color:0xaaa698}));basin.rotation.x=Math.PI/2;basin.position.set(-3.8,4.1,4.7);innUpper.add(basin);
innBox(-2,3.215,0,2.8,.025,3.2,0x5e2734,innUpper);
// Bar, shelves, bottles and three seating clusters leave a clear central aisle.
innBox(-3.9,.6,-3.5,3.3,1.2,.8,0x4d302b,innRoot,true);
innBox(-3.9,1.24,-3.5,3.6,.12,1,0x77523c);
innProp('shelf_large',-4.2,0,-5.35,2.3,0,2.4,.65);
for(let i=0;i<6;i++)innProp(i%2?'bottle_A_green':'bottle_B_brown',-5+i*.43,1.32,-3.5,.3,0,.1,.1);
for(const [x,z] of [[-3,0],[-3,3.5],[1,-2.4]]){
 innProp('table_medium',x,0,z,.85,0,1.6,1.2);
 for(const dz of [-1.1,1.1])innProp('chair',x,0,z+dz,1.1,dz<0?0:Math.PI,.65,.65);
 innLamp(x,2.5,z,0xffb36a,12);
}
innProp('barrel_large',5,0,-5,1.1);innProp('barrel_small_stack',4,0,-5,1.2);
// Built masonry hearth and flames: architectural geometry, not a borrowed building sprite.
innBox(-5.45,.14,2.2,1,.28,2.3,0x56505a,innRoot,true);
for(const z of [1.2,3.2])innBox(-5.45,1,z,1,1.8,.3,0x4a444d,innRoot,true);
innBox(-5.45,1.9,2.2,1.2,.3,2.5,0x69616a);
for(let i=0;i<5;i++){const f=new THREE.Mesh(new THREE.ConeGeometry(.14,.5+i%2*.25,6),new THREE.MeshBasicMaterial({color:i%2?0xffd47d:0xf27436}));f.position.set(-5.2,.5,1.6+i*.3);innRoot.add(f);}
const innFire=innLamp(-4.9,.9,2.2,0xff8a43,28);
innBox(0,.012,2.2,1.8,.025,4,0x622e3a);
innBox(0,-.04,7.1,3,.15,2.2,0x655c65);
// Exterior slice: neutral architecture, world-space collision, no camera assumptions.
const squareRoot=new THREE.Group(),squareSolids=[],squareRoofs=[];
squareRoot.position.x=80;scene.add(squareRoot);let inSquare=false;
const squareMaterials=new Map();
function squareBox(x,y,z,w,h,d,color,solid=false){
 if(!squareMaterials.has(color))squareMaterials.set(color,new THREE.MeshStandardMaterial({color,roughness:.95}));
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),squareMaterials.get(color));
 mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;squareRoot.add(mesh);
 if(solid)squareSolids.push({x,z,w,d});return mesh;
}
// Staggered cobbles, continuous low walk surface, and a narrow road through the southern gap.
squareBox(0,-.12,0,32,.2,38,0x4e5358);
const cobbles=[[],[],[]];
for(let row=0;row<34;row++)for(let col=0;col<27;col++){
 const x=-13+col*.98+(row%2)*.47,z=-12+row*.85;
 if(z>13&&Math.abs(x)>2.6)continue;
 cobbles[(row*7+col*3+col%2)%3].push([x,z]);
}
// Three instanced draws rather than hundreds of separate paving meshes.
cobbles.forEach((positions,i)=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.89,.025,.75),new THREE.MeshStandardMaterial({color:[0x64616a,0x706b70,0x595a64][i],roughness:1}),positions.length);
 const matrix=new THREE.Matrix4();positions.forEach(([x,z],index)=>mesh.setMatrixAt(index,matrix.makeTranslation(x,-.008,z)));
 mesh.receiveShadow=true;squareRoot.add(mesh);
});
for(const x of [-3,3])squareBox(x,.06,16,.22,.22,10,0x79717a);
function squareBuilding(x,z,w,d,h,front=false){
 squareBox(x,h/2,z,w,h,d,0x504650,true);
 squareBox(x,.35,z,w+.12,.7,d+.12,0x69636b);
 for(const dx of [-w/2+.12,0,w/2-.12]){
  squareBox(x+dx,h/2,z+d/2+.04,.18,h,.18,0x29242b);
  squareBox(x+dx,h/2,z-d/2-.04,.18,h,.18,0x29242b);
 }
 for(const y of [.8,2.9,h-.1])squareBox(x,y,z,w+.16,.16,d+.16,0x302832);
 // Two sloped roof planes form a real gable from both sides, not a billboard.
 for(const side of [-1,1]){
  const roof=squareBox(x+side*w/4,h+.65,z,w*.58,.18,d+.65,0x302e3c);
  roof.rotation.z=-side*.48;squareRoofs.push(roof);
 }
 const fz=z+(front?1:-1)*(d/2+.1);
 squareBox(x,1.12,fz,1.55,2.24,.16,0x302a31);
 squareBox(x,2.3,fz,1.8,.16,.24,0x81716b);
 for(const dx of [-w*.31,w*.31]){
  squareBox(x+dx,2.05,fz,1.1,1.15,.15,0x211e2b);
  for(const sx of [-.3,.3])squareBox(x+dx+sx,2.05,fz+.03,.48,1.2,.16,0x4b383d);
  squareBox(x+dx,3.8,fz,.85,.9,.13,0xb9a084);
  squareBox(x+dx,3.8,fz+.08,.08,1,.16,0x302832);
 }
 squareBox(x+w*.3,h+.8,z-d*.22,.65,2,.7,0x625761);
}
// Inn frontage has an open doorway; its interior remains the original separate cutaway.
squareBox(-4,2.7,-15,5,5.4,5,0x51444c,true);squareBox(4,2.7,-15,5,5.4,5,0x51444c,true);
squareBox(0,4.05,-15,3,2.7,5,0x51444c);
squareBox(0,1.3,-17.4,3,2.6,.2,0x211e29);
for(const x of [-6.4,-1.55,1.55,6.4])squareBox(x,2.7,-12.4,.2,5.4,.22,0x29242b);
for(const x of [-4,4]){squareBox(x,3.8,-12.4,1.3,1.4,.15,0xc6b895);squareBox(x,3.8,-12.25,.1,1.4,.18,0x302832);}
for(const side of [-1,1]){const r=squareBox(side*3.25,6.3,-15,7.5,.2,5.7,0x302e3c);r.rotation.z=-side*.4;squareRoofs.push(r);}
squareBox(0,.03,-11.8,3,.08,1.8,0x91858a);
squareBuilding(-11,-7,6,6,5.2,true);squareBuilding(11,-6,6,7,5.8,true);
squareBuilding(-10,9,7,6,4.8);squareBuilding(10,10,7,6,5.4);
// Well: hollow masonry ring, dark water, posts, winding beam and rope.
const well=new THREE.Mesh(new THREE.CylinderGeometry(1.25,1.35,.85,16,1,true),new THREE.MeshStandardMaterial({color:0x79717b,side:THREE.DoubleSide,roughness:1}));
well.position.set(-3,.43,1);well.castShadow=true;well.receiveShadow=true;squareRoot.add(well);squareSolids.push({x:-3,z:1,w:2.8,d:2.8});
const water=new THREE.Mesh(new THREE.CircleGeometry(1.2,20),new THREE.MeshStandardMaterial({color:0x253d4b,roughness:.25}));water.rotation.x=-Math.PI/2;water.position.set(-3,.18,1);squareRoot.add(water);
for(const x of [-4.5,-1.5])squareBox(x,1.5,1,.16,3,.18,0x46323a);
squareBox(-3,2.85,1,3.4,.22,.3,0x46323a);squareBox(-3,1.5,1,.035,2.6,.035,0x9c8970);
// Closed stalls, a few forgotten wares, benches and a blank notice board.
for(const [x,z] of [[-9,1],[9,2]]){
 squareBox(x,.65,z,3,1.3,1.4,0x594049,true);
 for(const dx of [-1.5,1.5])for(const dz of [-.7,.7])squareBox(x+dx,1.35,z+dz,.12,2.7,.12,0x302832);
 const awning=squareBox(x,2.65,z,3.5,.12,2.2,x<0?0x655467:0x5b665f);awning.rotation.x=.15;
 for(let i=0;i<5;i++)squareBox(x-1.2+i*.6,1.3,z,.5,.09,1.4,0x745b51);
}
for(const [x,z] of [[-5,8],[5,-6]]){
 squareBox(x,.5,z,2.6,.16,.7,0x6b5147,true);
 for(const dx of [-1,1])squareBox(x+dx,.24,z,.16,.48,.6,0x302832);
 squareBox(x,.98,z+.3,2.6,.6,.12,0x59434a);
}
for(const x of [4.3,6.7])squareBox(x,1.25,7,.14,2.5,.18,0x302832);
squareBox(5.5,1.8,7,2.7,1.5,.2,0x59434a,true);
for(let i=0;i<3;i++)squareBox(4.8+i*.65,1.8+(i%2)*.2,6.88,.43,.6,.02,0xb8ad93);
const squareGlow=new THREE.MeshStandardMaterial({color:0xffcd83,emissive:0xffa84f,emissiveIntensity:1.2});
for(const [x,z] of [[-6,-9],[6,-9],[-5,12],[5,12]]){
 squareBox(x,1.65,z,.13,3.3,.13,0x2a2830,true);
 const lantern=new THREE.Mesh(new THREE.BoxGeometry(.38,.6,.38),squareGlow);lantern.position.set(x,3,z);squareRoot.add(lantern);
 squareBox(x,3.36,z,.6,.12,.6,0x302832);
 const light=new THREE.PointLight(0xffb86c,12,6,2);light.position.set(x,3,z);squareRoot.add(light);
}
// An unlettered hanging sign marks the inn without inventing a place name.
squareBox(2.3,3,-11.8,1.7,.12,.12,0x29242b);squareBox(2.9,2.5,-11.8,.8,.8,.14,0x79614d);
const squareReady=Promise.all([['barrel_large',-8,4,1.1],['barrel_small_stack',8,-1,1.3],['crates_stacked',10,5,1.2]].map(async([file,x,z,height])=>{
 const gltf=await loader.loadAsync('assets/environment/dungeon/'+file+'.gltf');
 const g=fit(gltf.scene.clone(true),height);g.position.add(new THREE.Vector3(x,0,z));g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});squareRoot.add(g);squareSolids.push({x,z,w:1.5,d:1.5});
}));
const morning=new THREE.DirectionalLight(0xffcb91,3);morning.position.set(55,12,-25);morning.target.position.set(80,0,0);scene.add(morning,morning.target);
renderer.shadowMap.enabled=settings.quality!=='performance';renderer.shadowMap.type=THREE.PCFShadowMap;morning.castShadow=true;
morning.shadow.mapSize.set(1024,1024);Object.assign(morning.shadow.camera,{left:-28,right:28,top:28,bottom:-28,near:1,far:90});morning.shadow.bias=-.0005;morning.shadow.normalBias=.03;morning.shadow.radius=3;
function squareEnter(z){inInn=false;inSquare=true;actor.position.set(80,0,z);view.anchor.copy(actor.position).y+=CAMERA_HEAD_HEIGHT;log('SESSION','Morning in the square. The inn is north; the road south leads to the clearing.');}
function squareMove(direction,speed,dt){
 const p=actor.position;let x=p.x-80,z=p.z;
 const valid=(a,b)=>Math.abs(a)<14&&b>-12.5&&b<20.5&&(b<13||Math.abs(a)<2.5)&&!squareSolids.some(s=>Math.abs(a-s.x)<s.w/2+.25&&Math.abs(b-s.z)<s.d/2+.25);
 const nx=x+direction.x*speed*dt;if(valid(nx,z))x=nx;
 const nz=z+direction.z*speed*dt;if(valid(x,nz))z=nz;
 p.set(80+x,0,z);
 if(z<-11.8&&Math.abs(x)<1.25){inSquare=false;inInn=true;p.set(40,0,6.8);view.anchor.copy(p).y+=CAMERA_HEAD_HEIGHT;log('SESSION','Inside the inn.');}
 else if(z>19.5){inSquare=false;p.set(0,0,-21);view.anchor.copy(p).y+=CAMERA_HEAD_HEIGHT;log('SESSION','The road opens into the clearing.');}
}
function squareAtmosphere(){
 squareRoot.visible=inSquare;morning.visible=inSquare;moon.visible=!inSquare;moonlight.visible=!inSquare;innRoot.visible=inInn;
 scene.background.setHex(inSquare?0xaaaab4:0x080f22);scene.fog.color.copy(scene.background);scene.fog.near=inSquare?26:22;scene.fog.far=inSquare?65:85;
 // Fade only the overhead roof when orbiting high. Closed buildings retain all four sides.
 for(const roof of squareRoofs)roof.visible=view.distance<8||view.pitch<.6;
}

actor.position.set(37.5,3.2,-.5);view.anchor.copy(actor.position).y+=CAMERA_HEAD_HEIGHT;
function innBlocked(x,z,y){return innSolids.some(b=>y>=b.y-.1&&y<b.top-.15&&Math.abs(x-b.x)<b.w/2+.22&&Math.abs(z-b.z)<b.d/2+.22);}
function innMove(direction,speed,dt){
 const p=actor.position,upper=p.y>3.05;
 const valid=(x,z)=>{
  if(x<-5.6||x>5.6||z<-5.6||z>7.8)return false;
  if(upper&&x>3&&z>4.1)return false;
  return !innBlocked(x,z,p.y);
 };
 let x=p.x-40,z=p.z;
 const nx=x+direction.x*speed*dt;const crossStair=(x<=3&&nx>3||x>3&&nx<=3)&&p.y>.12&&z> -3.8;if(!crossStair&&valid(nx,z))x=nx;
 const nz=z+direction.z*speed*dt;if(valid(x,nz))z=nz;
 // The stair ramp is the walk surface; visible treads remain discrete.
 if(x>3&&z>=-4&&z<=4)p.y=3.2*(4-z)/8;
 else if(x>3&&z<-4)p.y=3.2;
 else if(p.y<.15)p.y=0;
 p.x=x+40;p.z=z;
 if(z>7.4){squareEnter(-10.7);}
}
function innCutaway(time){
 innUpper.visible=inInn&&actor.position.y>2.9;
 for(const m of innWalls){const local=m.position; m.visible=!(camera.position.x<34&&local.x< -5||camera.position.x>46&&local.x>5||camera.position.z>6&&local.z>5||camera.position.z< -6&&local.z< -5);}
 innFire.intensity=26+Math.sin(time*7)*2;
}
const innReady=Promise.all(innAssets.map(fn=>fn()));

const scenery=[
 ['nature/forest/Tree_1_A_Color1.gltf',[-12,0,-12],8],
 ['nature/forest/Tree_1_A_Color1.gltf',[14,0,-10],9],
 ['nature/forest/Tree_1_A_Color1.gltf',[-16,0,10],7],
 ['nature/forest/Rock_1_A_Color1.gltf',[9,0,7],1.7],
 ['nature/forest/Rock_1_A_Color1.gltf',[-8,0,-5],1.1],
 ['environment/Fantasy Seed Dungeon/crate.glb',[13,0,-6],1]
];
async function loadScenery(){
 const cache=new Map();
 await Promise.all(scenery.map(async([path,position,height])=>{
  try{
   if(!cache.has(path))cache.set(path,loader.loadAsync('assets/'+path));
   const gltf=await cache.get(path),object=fit(gltf.scene.clone(true),height);
   object.position.add(new THREE.Vector3(...position));scene.add(object);
  }catch(error){console.warn('Scenery unavailable: '+path,error);}
 }));
}
// The same road direction carries the player through both ends of the transition.
innBox(0,.015,-21.6,3,.03,2.8,0x655c65,scene);
// The duel. Everything here is game logic and staging; none of it knows the camera.
let playerHP=stats.hp,playerDead=false,playerStagger=0,attack=null,attackCooldown=0,arrowTemplate=null;
const projectiles=[],goblinMaterials=[];let goblin=null;
HUD.build(character.name,character.class);
function updateBars(){HUD.setHealth(playerHP,stats.hp);}
updateBars();
const kit=ABILITIES[character.class],spentCombat=new Set(),spentCamp=new Set();
let focus=2,guard=null,quarry=false,rootSeconds=0;
HUD.setAbilities(kit);
function abilityState(a){
 if(spentCombat.has(a.key)||spentCamp.has(a.key))return 'spent';
 if(playerDead||!model||a.type==='attack'&&(playerStagger>0||attack||attackCooldown>0)||guard?.ability===a||quarry&&a.type==='advantage'||a.cost.startsWith('focus')&&focus===0)return 'unavailable';
 return 'ready';
}
function refreshAbilities(){
 for(const a of kit)HUD.setAbilityState(a.key,abilityState(a));
 if(character.class==='Mage')HUD.setFocus(focus);
}
function useAbility(key){
 const a=kit[key-1];
 if(!a||abilityState(a)!=='ready')return;
 if(a.type==='attack'){beginAttack(a);return;}
 if(a.type==='guard'){guard={ability:a,seconds:1.5};}
 if(a.type==='heal'){playerHP=Math.min(stats.hp,playerHP+a.heal);spentCamp.add(a.key);updateBars();}
 if(a.type==='advantage'){quarry=true;spentCombat.add(a.key);}
 log('COMBAT',character.name+' '+a.flavor);refreshAbilities();
}
function playerRoll(){
 const a=attack?.ability,result=resolveAttack(a?.damage?{...stats,damage:a.damage}:stats,goblinData,{advantage:attack?.advantage||false});
 quarry=false;return result;
}
function logRoll(result){
 if(result.advantage)log('COMBAT','Advantage: d20 '+result.attackRolls.join(' / ')+' -> '+result.d20+'.');
 log('COMBAT','d20 '+result.d20+' + '+result.attackBonus+' = '+result.total+' vs defense '+result.defense+' -> '+(result.nat1?'automatic miss':result.crit?'CRITICAL HIT':result.hit?'hit':'miss'));
}
async function equipWeapon(){
 const weapon=stats.attack.weapon;if(!weapon)return;
 try{
  const gltf=await loader.loadAsync(weapon.path);
  const slot=model.getObjectByName(weapon.slot);
  if(!slot){log('ASSET','Hand slot missing: '+weapon.slot);return;}
  slot.add(gltf.scene);log('ASSET','Equipped '+weapon.path.split('/').pop()+' in '+weapon.slot);
 }catch(error){log('ASSET','Weapon unavailable: '+weapon.path);}
}
async function loadArrowTemplate(){
 if(!stats.attack.projectileAsset)return;
 try{arrowTemplate=await loader.loadAsync(stats.attack.projectileAsset);}catch(error){log('ASSET','Projectile unavailable: '+stats.attack.projectileAsset);}
}
function spawnGoblin(gltf){
 const group=new THREE.Group();
 const body=fit(gltf.scene,goblinData.model.height);
 group.add(body);group.position.set(GOBLIN_SPAWN.x,0,GOBLIN_SPAWN.z);scene.add(group);
 const goblinMixer=new THREE.AnimationMixer(body),acts={};
 for(const [key,suffix] of Object.entries(goblinData.model.clipSuffixes)){
  const clip=gltf.animations.find(a=>a.name.split('|').pop()===suffix);
  if(clip)acts[key]=goblinMixer.clipAction(clip);else console.warn('Goblin clip unavailable: '+key+' ('+suffix+')');
 }
 for(const key of ['attack','hit','death'])if(acts[key]){acts[key].setLoop(THREE.LoopOnce,1);acts[key].clampWhenFinished=true;}
 goblin={group,mixer:goblinMixer,actions:acts,activeAction:null,animName:'none',hp:goblinData.hp,alive:true,aggro:false,state:'idle',attackT:0,attackHit:false,attackCooldown:0,stagger:0,deadClock:null};
 playGoblin('idle');updateBars();
 log('SESSION','A goblin waits at the far edge of the clearing.');
}
function playGoblin(name){
 const next=goblin.actions[name]||goblin.actions.idle;
 if(!next||next===goblin.activeAction)return;
 goblin.activeAction?.fadeOut(ANIMATION_FADE);next.reset().fadeIn(ANIMATION_FADE).play();
 goblin.activeAction=next;goblin.animName=next.getClip().name;
}
function beginAttack(ability=kit[0]){
 if(!model||playerDead||attack||playerStagger>0||attackCooldown>0)return;
 dismiss();
 const a=stats.attack,first=a.clips.draw?'draw':'attack';
 if(!actions[first]){log('COMBAT','Attack clip not loaded: '+first);return;}
 if(!inInn&&!inSquare&&goblin&&goblin.alive&&actor.position.distanceTo(goblin.group.position)<=a.range){
  actor.rotation.y=Math.atan2(goblin.group.position.x-actor.position.x,goblin.group.position.z-actor.position.z);
 }
 if(ability.cost==='camp')spentCamp.add(ability.key);
 if(ability.cost==='focus'){focus--;if(focus===0)guard=null;}
 if(ability.flavor)log('COMBAT',character.name+' '+ability.flavor);
 attack={ability,steps:a.clips.draw?[{clip:'draw',fireAt:null},{clip:'release',fireAt:a.fireAt}]:[{clip:first,fireAt:a.fireAt}],index:0,t:0,fired:false};
 play(first);
 log('COMBAT',character.name+' '+(a.type==='melee'?'swings':a.projectile==='arrow'?'draws the bow':'weaves a spell')+'.');
}
function updateAttack(dt){
 if(!attack)return;
 const step=attack.steps[attack.index],action=actions[step.clip];
 if(!action){attack=null;return;}
 attack.t+=dt;
 const duration=action.getClip().duration;
 if(!attack.fired&&step.fireAt!==null&&attack.t>=duration*step.fireAt){attack.fired=true;fireAttack();}
 if(attack.t>=duration){
  if(attack.index<attack.steps.length-1){attack.index++;attack.t=0;attack.fired=false;play(attack.steps[attack.index].clip);}
  else{attack=null;attackCooldown=stats.attack.cooldown;}
 }
}
function fireAttack(){
 attack.advantage=quarry;quarry=false;
 const a=stats.attack;
 if(a.type==='melee'){
  if(!inInn&&!inSquare&&goblin&&goblin.alive){
   goblin.aggro=true;
   if(actor.position.distanceTo(goblin.group.position)<=a.range){
    const result=playerRoll();logRoll(result);
    if(result.hit)damageGoblin(result.damage,result.crit);
   }else log('COMBAT','The swing falls short.');
   updateBars();
  }else log('COMBAT','You swing at empty night.');
 }else spawnProjectile();
}
function spawnProjectile(){
 const a=stats.attack,origin=actor.position.clone();origin.y+=1.4;
 let mesh;
 if(a.projectile==='arrow'&&arrowTemplate)mesh=arrowTemplate.scene.clone(true);
 else{mesh=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8),new THREE.MeshBasicMaterial({color:0x9fd8ff}));mesh.add(new THREE.PointLight(0x9fd8ff,4,5));}
 if(attack?.ability.damage){mesh.scale.multiplyScalar(1.6);mesh.material.color.setHex(0xffb45b);}
 scene.add(mesh);mesh.position.copy(origin);
 let result=null,homing=false,target=null;
 if(!inInn&&!inSquare&&goblin&&goblin.alive){
  goblin.aggro=true;
  result=playerRoll();logRoll(result);
  const chest=goblin.group.position.clone();chest.y+=goblinData.model.height*0.6;
  if(result.hit){homing=true;target=chest;}
  else{
   const side=new THREE.Vector3().crossVectors(chest.clone().sub(origin),THREE.Object3D.DEFAULT_UP).normalize();
   target=chest.addScaledVector(side,PROJECTILE_MISS_OFFSET);target.y+=0.5;
  }
 }
 const direction=target?target.clone().sub(origin).normalize():new THREE.Vector3(Math.sin(actor.rotation.y),0,Math.cos(actor.rotation.y));
 projectiles.push({mesh,velocity:direction.multiplyScalar(a.speed),speed:a.speed,homing,target,result,root:attack?.ability.root||0,gravity:a.gravity,asset:a.projectile});
 log('COMBAT',(a.projectile==='arrow'?'An arrow':'A bolt of pale light')+(result===null?' leaps into the dark.':result.hit?' flies true.':' flies wide.'));
 updateBars();
}
function updateProjectiles(dt){
 for(let i=projectiles.length-1;i>=0;i--){
  const p=projectiles[i];
  if(p.homing){
   const chest=goblin&&goblin.alive?goblin.group.position.clone().setY(goblin.group.position.y+goblinData.model.height*0.6):p.target;
   p.velocity.lerp(chest.clone().sub(p.mesh.position).normalize().multiplyScalar(p.speed),Math.min(1,8*dt)).setLength(p.speed);
   if(p.mesh.position.distanceTo(chest)<=Math.max(PROJECTILE_CONNECT_RADIUS,p.speed*dt)){
    if(p.result&&p.result.hit){
     damageGoblin(p.result.damage,p.result.crit);
     if(p.root&&goblin?.alive){rootSeconds=p.root;log('COMBAT','Roots bind the goblin.');}
    }
    scene.remove(p.mesh);projectiles.splice(i,1);continue;
   }
  }else if(p.gravity)p.velocity.y-=PROJECTILE_GRAVITY*dt;
  p.mesh.position.addScaledVector(p.velocity,dt);
  if(p.asset==='arrow')p.mesh.quaternion.setFromUnitVectors(PROJECTILE_FORWARD,p.velocity.clone().normalize());
  if(p.mesh.position.y<=0||p.mesh.position.length()>CLEARING_RADIUS+15){scene.remove(p.mesh);projectiles.splice(i,1);log('COMBAT','The shot is swallowed by the dark.');}
 }
}
function damageGoblin(amount,crit){
 if(!goblin||!goblin.alive)return;
 goblin.hp-=amount;updateBars();
 log('COMBAT','Goblin takes '+amount+(crit?', a critical blow!':'')+' -> '+Math.max(0,goblin.hp)+' of '+goblinData.hp+' hp');
 if(goblin.hp<=0){killGoblin();return;}
 goblin.stagger=goblinData.ai.staggerSeconds;
 if(goblin.state==='attack')goblin.state='chase';
 playGoblin('hit');
}
function killGoblin(){
 spentCombat.clear();quarry=false;guard=null;rootSeconds=0;refreshAbilities();
 goblin.alive=false;goblin.state='dead';goblin.deadClock=0;
 playGoblin('death');
 goblinMaterials.length=0;
 goblin.group.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:object.material?[object.material]:[])){material.transparent=true;goblinMaterials.push(material);}});
 log('COMBAT','The goblin falls.');updateBars();
}
function goblinStrike(){
 if(playerDead)return;
 if(actor.position.distanceTo(goblin.group.position)>goblinData.ai.attackReach+0.6){log('COMBAT','The goblin slashes empty air.');return;}
 const result=resolveAttack(goblinData,stats);logRoll(result);
 if(result.hit)damagePlayer(result.damage,result.crit);
}
function damagePlayer(amount,crit){
 if(playerDead)return;
 if(guard){
  const a=guard.ability;amount=Math.max(0,amount-a.reduction);
  if(a.cost==='combat')spentCombat.add(a.key);else focus--;
  guard=null;log('COMBAT','The blow glances off '+character.name+"'s guard.");
 }
 playerHP-=amount;updateBars();
 log('COMBAT',character.name+' takes '+amount+(crit?', a critical blow!':'')+' -> '+Math.max(0,playerHP)+' of '+stats.hp+' hp');
 if(playerHP<=0){playerDeath();return;}
 playerStagger=PLAYER_STAGGER_SECONDS;play('Hit_A');
}
function playerDeath(){
 playerDead=true;attack=null;
 play('Death_A');
 log('COMBAT',character.name+' falls. The tale ends here.');
 const veil=document.createElement('div');veil.id='death-veil';document.body.append(veil);
 void veil.offsetWidth;veil.classList.add('fallen');
 setTimeout(()=>{location.href='index.html';},PLAYER_DEATH_RETURN_SECONDS*1000);
}
function updateGoblin(dt){
 if(!goblin||inInn||inSquare)return;
 goblin.mixer.update(dt);
 if(!goblin.alive){
  if(goblin.deadClock!==null){
   goblin.deadClock+=dt;
   const fade=Math.max(0,1-goblin.deadClock/GOBLIN_FADE_SECONDS);
   for(const material of goblinMaterials)material.opacity=fade;
   if(goblin.deadClock>=GOBLIN_FADE_SECONDS){scene.remove(goblin.group);goblin.deadClock=null;log('COMBAT','The goblin fades into the night.');}
  }
  return;
 }
 if(goblin.stagger>0){goblin.stagger-=dt;return;}
 if(goblin.attackCooldown>0)goblin.attackCooldown-=dt;
 if(playerDead){goblin.state='idle';playGoblin('idle');return;}
 const toPlayer=actor.position.clone().sub(goblin.group.position),distance=toPlayer.length();
 if(!goblin.aggro){
  if(distance<=goblinData.ai.aggroRadius){goblin.aggro=true;log('COMBAT','The goblin bristles and charges.');updateBars();}
  else{playGoblin('idle');return;}
 }
 if(goblin.state==='attack'){
  goblin.attackT+=dt;
  const duration=goblin.actions.attack?goblin.actions.attack.getClip().duration:1;
  if(!goblin.attackHit&&goblin.attackT>=duration*goblinData.ai.impactAt){goblin.attackHit=true;goblinStrike();}
  if(goblin.attackT>=duration){goblin.state='chase';goblin.attackCooldown=goblinData.ai.attackCooldown;playGoblin('run');}
  return;
 }
 if(distance>goblinData.ai.attackReach){
  if(rootSeconds>0){playGoblin('idle');return;}
  const step=toPlayer.normalize();
  goblin.group.position.addScaledVector(step,goblinData.ai.runSpeed*dt);
  if(goblin.group.position.length()>CLEARING_RADIUS)goblin.group.position.setLength(CLEARING_RADIUS);
  goblin.group.rotation.y=Math.atan2(step.x,step.z);
  goblin.state='chase';playGoblin('run');
 }else if(goblin.attackCooldown<=0){
  goblin.state='attack';goblin.attackT=0;goblin.attackHit=false;
  goblin.group.rotation.y=Math.atan2(toPlayer.x,toPlayer.z);
  playGoblin('attack');log('COMBAT','The goblin lunges!');
 }else{goblin.state='chase';playGoblin('idle');}
}
export const ready=(async()=>{
 const path={Warrior:'Knight',Ranger:'Ranger',Mage:'Mage'}[character.class];
 const rig={Warrior:'Rig_Medium_CombatMelee',Ranger:'Rig_Medium_CombatRanged',Mage:'Rig_Medium_CombatRanged'}[character.class];
 const [body,general,movement,combat,goblinGltf]=await Promise.all([
  loader.loadAsync('assets/characters/adventurers/'+path+'.glb'),
  loader.loadAsync('assets/characters/adventurers/Rig_Medium_General.glb'),
  // Already vendored in the shared animation library; no download or asset change.
  loader.loadAsync('assets/animations/rig-medium/Rig_Medium_MovementBasic.glb'),
  loader.loadAsync('assets/animations/rig-medium/'+rig+'.glb'),
  loader.loadAsync(goblinData.model.path)
 ]);
 model=fit(body.scene,CHARACTER_HEIGHT);actor.add(model);mixer=new THREE.AnimationMixer(model);
 for(const name of ['Idle_A','Walking','Running']){
  const clip=(name==='Idle_A'?general:movement).animations.find(c=>c.name===name||c.name===name+'_A');
  if(clip)actions[name]=mixer.clipAction(clip);else console.warn('Animation unavailable: '+name);
 }
 for(const name of ['Hit_A','Death_A']){
  const clip=general.animations.find(c=>c.name===name);
  if(clip)actions[name]=mixer.clipAction(clip);else console.warn('Animation unavailable: '+name);
 }
 for(const [key,clipName] of Object.entries(stats.attack.clips)){
  const clip=combat.animations.find(c=>c.name===clipName);
  if(clip)actions[key]=mixer.clipAction(clip);else console.warn('Attack clip unavailable: '+key+' ('+clipName+')');
 }
 for(const key of [...Object.keys(stats.attack.clips),'Hit_A','Death_A']){
  const action=actions[key];
  if(action){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}
 }
 play('Idle_A');
 await Promise.all([loadScenery(),equipWeapon(),loadArrowTemplate(),innReady,squareReady]);
 spawnGoblin(goblinGltf);
 introTimer=setTimeout(dismiss,INTRO_SECONDS*1000);
 log('SESSION','You wake upstairs. Through the bedroom door, turn left along the landing to the stairs. The front door below leads to the square; the southern road leads to the clearing.');
 return true;
})().catch(error=>{document.getElementById('hint').textContent='The clearing could not load. Escape returns to title.';console.error('World load failed',error);return false;});
const keys=new Set();let drag=null;
// This hint and pointer input belong only to the view layer.
const lookHint=document.createElement('p');lookHint.id='look-hint';
lookHint.textContent='Click to look around';lookHint.setAttribute('role','status');
const lookStyle=document.createElement('style');
lookStyle.textContent=`#look-hint{position:fixed;bottom:48px;left:50%;transform:translateX(-50%);margin:0;padding:8px 14px;border:1px solid var(--ui-accent);background:var(--ui-panel-mid);color:var(--ui-text);font-size:12px;text-align:center;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .2s,visibility .2s}#look-hint.visible{opacity:1;visibility:visible}@media(prefers-reduced-motion:reduce){#look-hint{transition:none}}html[data-reduce-motion="true"] #look-hint{transition:none}`;
document.head.append(lookStyle);document.body.append(lookHint);
let lockPending=false;
const inLookRange=()=>view.distance<=CAMERA_LOCK_DISTANCE;
const isLocked=()=>document.pointerLockElement===canvas;
function updateLookHint(){lookHint.classList.toggle('visible',inLookRange()&&!isLocked());}
function releaseDrag(){
 if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);
 drag=null;
}
async function requestLook(){
 if(lockPending||!inLookRange()||document.pointerLockElement||!canvas.requestPointerLock)return;
 lockPending=true;
 try{
  try{await canvas.requestPointerLock({unadjustedMovement:true});}
  catch{
   // Both legacy void-returning and modern Promise-returning APIs are valid.
   if(inLookRange()&&!document.pointerLockElement)await canvas.requestPointerLock();
  }
 }catch{updateLookHint();}finally{lockPending=false;}
}
function lockChanged(){
 releaseDrag();
 // A request may finish after the wheel has already moved back out.
 if(isLocked()&&(!inLookRange()||view.targetDistance>CAMERA_LOCK_DISTANCE))document.exitPointerLock();
 updateLookHint();
}
document.addEventListener('pointerlockchange',lockChanged);
document.addEventListener('pointerlockerror',()=>{releaseDrag();updateLookHint();});
document.addEventListener('mousemove',event=>{
 if(!isLocked())return;
 view.yaw-=event.movementX*CAMERA_LOOK_SENSITIVITY;
 view.pitch=THREE.MathUtils.clamp(view.pitch+event.movementY*CAMERA_LOOK_SENSITIVITY,CAMERA_MIN_PITCH,CAMERA_MAX_PITCH);
});
window.addEventListener('keydown',event=>{
 if(event.code==='Escape'){if(!document.pointerLockElement)location.href='index.html';return;}
 if(/^Digit[1-3]$/.test(event.code)){event.preventDefault();if(!event.repeat)useAbility(Number(event.code.slice(-1)));return;}
 if(event.code==='KeyF'){event.preventDefault();beginAttack();return;}
 if(event.code==='KeyL'){event.preventDefault();downloadLog();return;}
 if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(event.code)){event.preventDefault();keys.add(event.code);dismiss();}
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{keys.clear();drag=null;});
document.addEventListener('visibilitychange',()=>{keys.clear();drag=null;});
const canvas=renderer.domElement;
canvas.addEventListener('contextmenu',event=>event.preventDefault());
// One trigger, two meanings: locked in, LMB swings at what you face; unlocked, a true click on the goblin swings at it.
const CLICK_MOVE_PX=6,CLICK_HOLD_MS=500;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
let clickArmed=false;
function clickAttack(event){
 if(!goblin||!goblin.alive)return false;
 const rect=canvas.getBoundingClientRect();
 pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
 raycaster.setFromCamera(pointer,camera);
 if(!raycaster.intersectObject(goblin.group,true).length)return false;
 if(actor.position.distanceTo(goblin.group.position)>stats.attack.range+0.5){log('COMBAT','Too far to strike.');return true;}
 beginAttack();
 return true;
}
canvas.addEventListener('click',event=>{
 if(!clickArmed)return;
 clickArmed=false;
 if(event.button!==0)return;
 if(clickAttack(event))return;
 if(inLookRange())void requestLook();
});
canvas.addEventListener('pointerdown',event=>{
 clickArmed=false;
 if(isLocked()){if(event.button===0)beginAttack();return;}
 drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:0,downAt:performance.now()};
 canvas.setPointerCapture(event.pointerId);dismiss();
});
canvas.addEventListener('pointermove',event=>{
 if(isLocked()||!drag||drag.id!==event.pointerId)return;
 drag.moved+=Math.abs(event.clientX-drag.x)+Math.abs(event.clientY-drag.y);
 view.yaw-=(event.clientX-drag.x)*CAMERA_ORBIT_SENSITIVITY;
 view.pitch=THREE.MathUtils.clamp(view.pitch+(event.clientY-drag.y)*CAMERA_ORBIT_SENSITIVITY,CAMERA_MIN_PITCH,CAMERA_MAX_PITCH);
 drag.x=event.clientX;drag.y=event.clientY;
});
canvas.addEventListener('pointerup',event=>{
 if(drag&&drag.id===event.pointerId&&event.button===0&&drag.moved<CLICK_MOVE_PX&&performance.now()-drag.downAt<CLICK_HOLD_MS)clickArmed=true;
 drag=null;
});
canvas.addEventListener('pointercancel',()=>{drag=null;clickArmed=false;});
canvas.addEventListener('lostpointercapture',()=>{drag=null;});
canvas.addEventListener('wheel',event=>{
 event.preventDefault();dismiss();
 const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
 view.targetDistance=THREE.MathUtils.clamp(view.targetDistance*Math.exp(pixels*CAMERA_ZOOM_SENSITIVITY),CAMERA_MIN_DISTANCE,CAMERA_MAX_DISTANCE);
 if(view.targetDistance>CAMERA_LOCK_DISTANCE&&isLocked())document.exitPointerLock();
},{passive:false});
function movementIntent(){
 const x=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),z=Number(keys.has('KeyS'))-Number(keys.has('KeyW'));
 // View-relative controls become a world vector here, never inside simulation.
 return new THREE.Vector3(x,0,z).applyAxisAngle(THREE.Object3D.DEFAULT_UP,view.yaw).normalize();
}
function simulate(direction,running,dt){
 if(!model)return;
 if(playerDead)direction=new THREE.Vector3();
 const animLocked=playerDead||attack||playerStagger>0;
 if(direction.lengthSq()){
  if(inInn)innMove(direction,running?RUN_SPEED:WALK_SPEED,dt);
  else if(inSquare)squareMove(direction,running?RUN_SPEED:WALK_SPEED,dt);
  else {actor.position.addScaledVector(direction,(running?RUN_SPEED:WALK_SPEED)*dt);if(actor.position.length()>CLEARING_RADIUS)actor.position.setLength(CLEARING_RADIUS);
   if(actor.position.z< -22&&Math.abs(actor.position.x)<1.3){squareEnter(18.3);}}
  const target=Math.atan2(direction.x,direction.z);
  const angle=Math.atan2(Math.sin(target-actor.rotation.y),Math.cos(target-actor.rotation.y));
  actor.rotation.y+=angle*(1-Math.exp(-TURN_RESPONSE*dt));
  if(!animLocked)play(running?'Running':'Walking');
 }else if(!animLocked)play('Idle_A');
 mixer?.update(dt);
}
const offset=new THREE.Vector3(),anchorTarget=new THREE.Vector3();
function updateView(dt){
 anchorTarget.copy(actor.position).y+=CAMERA_HEAD_HEIGHT;
 view.anchor.lerp(anchorTarget,1-Math.exp(-CAMERA_FOLLOW_RESPONSE*dt));
 view.distance=THREE.MathUtils.lerp(view.distance,view.targetDistance,1-Math.exp(-CAMERA_ZOOM_RESPONSE*dt));
 offset.set(Math.sin(view.yaw)*Math.cos(view.pitch),Math.sin(view.pitch),Math.cos(view.yaw)*Math.cos(view.pitch));
 camera.position.copy(view.anchor).addScaledVector(offset,view.distance);
 // The same forward vector works at every arm length, including first person.
 camera.lookAt(new THREE.Vector3().copy(camera.position).sub(offset));
 if(model)model.visible=view.distance>CAMERA_HIDE_DISTANCE;
 updateLookHint();
}
let last=performance.now(),frame;
function tick(now){
 const dt=Math.min(MAX_FRAME_DELTA,(now-last)/1000);last=now;
 HUD.setPlayerPosition(actor.position.x,actor.position.z);
 if(attackCooldown>0)attackCooldown-=dt;
 if(playerStagger>0)playerStagger-=dt;
 if(guard){guard.seconds-=dt;if(guard.seconds<=0)guard=null;}
 rootSeconds=Math.max(0,rootSeconds-dt);
 refreshAbilities();
 updateAttack(dt);
 simulate(movementIntent(),keys.has('ShiftLeft')||keys.has('ShiftRight'),dt);
 updateGoblin(dt);
 updateProjectiles(dt);
 updateView(dt);innCutaway(performance.now()/1000);squareAtmosphere();renderer.render(scene,camera);frame=requestAnimationFrame(tick);
}
updateView(0);frame=requestAnimationFrame(tick);
// Read-only diagnostics for live verification; no simulation depends on this view.
export function snapshot(){return {location:inInn?'inn':inSquare?'square':'clearing',square:{buildings:5,solids:squareSolids.length,models:3},innAssets:innAssets.length,character:{...character},hp:{player:Math.max(0,playerHP),max:stats.hp},goblin:goblin?{hp:Math.max(0,goblin.hp),max:goblinData.hp,alive:goblin.alive,aggro:goblin.aggro,state:goblin.state,animation:goblin.animName}:null,projectiles:projectiles.length,position:actor.position.toArray(),rotation:actor.rotation.y,camera:{yaw:view.yaw,pitch:view.pitch,distance:view.distance,targetDistance:view.targetDistance},modelLoaded:!!model,modelVisible:model?.visible,animation:animationName,clips:Object.keys(actions),drawCalls:renderer.info.render.calls,pixelRatio:renderer.getPixelRatio(),theme:settings.theme};}
window.addEventListener('pagehide',()=>{
 cancelAnimationFrame(frame);clearTimeout(introTimer);mixer?.stopAllAction();goblin?.mixer.stopAllAction();
 const geometries=new Set(),materials=new Set(),textures=new Set();
 scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of (Array.isArray(object.material)?object.material:object.material?[object.material]:[])){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();
});
