import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSettings} from './settings.js';
import {applyTheme} from './theme.js';

// Simulation owns world-space movement. Only the input adapter knows view yaw.
const WALK_SPEED=3, RUN_SPEED=6, TURN_RESPONSE=12, CLEARING_RADIUS=23;
const CHARACTER_HEIGHT=2, MAX_FRAME_DELTA=0.05, ANIMATION_FADE=0.18;
// Player-owned view: no camera code writes to the simulation.
const CAMERA_MIN_DISTANCE=0.2, CAMERA_MAX_DISTANCE=20, CAMERA_DEFAULT_DISTANCE=6;
const CAMERA_DEFAULT_YAW=0, CAMERA_DEFAULT_PITCH=0.3;
const CAMERA_MIN_PITCH=-0.15, CAMERA_MAX_PITCH=1.3;
const CAMERA_HEAD_HEIGHT=1.65, CAMERA_HIDE_DISTANCE=1.2;
const CAMERA_ORBIT_SENSITIVITY=0.005, CAMERA_ZOOM_SENSITIVITY=0.0015;
const CAMERA_FOLLOW_RESPONSE=10, CAMERA_ZOOM_RESPONSE=14;
const INTRO_SECONDS=6;

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
const intro=document.getElementById('intro');
document.getElementById('tale').textContent='The tale of '+character.name+' the '+character.race+' '+character.class+' begins.';
const dismiss=()=>intro.classList.add('dismissed');
let introTimer;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080f22);scene.fog=new THREE.Fog(0x080f22,22,85);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setClearColor(0x080f22);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label','Moonlit clearing. WASD move, Shift run, drag orbit, scroll zoom, Escape title.');
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
export const ready=(async()=>{
 const path={Warrior:'Knight',Ranger:'Ranger',Mage:'Mage'}[character.class];
 const [body,general,movement]=await Promise.all([
  loader.loadAsync('assets/characters/adventurers/'+path+'.glb'),
  loader.loadAsync('assets/characters/adventurers/Rig_Medium_General.glb'),
  // Already vendored in the shared animation library; no download or asset change.
  loader.loadAsync('assets/animations/rig-medium/Rig_Medium_MovementBasic.glb')
 ]);
 model=fit(body.scene,CHARACTER_HEIGHT);actor.add(model);mixer=new THREE.AnimationMixer(model);
 for(const name of ['Idle_A','Walking','Running']){
  const clip=(name==='Idle_A'?general:movement).animations.find(c=>c.name===name);
  if(clip)actions[name]=mixer.clipAction(clip);else console.warn('Animation unavailable: '+name);
 }
 play('Idle_A');await loadScenery();introTimer=setTimeout(dismiss,INTRO_SECONDS*1000);
 return true;
})().catch(error=>{document.getElementById('hint').textContent='The clearing could not load. Escape returns to title.';console.error('World load failed',error);return false;});
const keys=new Set();let drag=null;
window.addEventListener('keydown',event=>{
 if(event.code==='Escape'){location.href='index.html';return;}
 if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(event.code)){event.preventDefault();keys.add(event.code);dismiss();}
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{keys.clear();drag=null;});
document.addEventListener('visibilitychange',()=>{keys.clear();drag=null;});
const canvas=renderer.domElement;
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);dismiss();});
canvas.addEventListener('pointermove',event=>{
 if(!drag||drag.id!==event.pointerId)return;
 view.yaw-=(event.clientX-drag.x)*CAMERA_ORBIT_SENSITIVITY;
 view.pitch=THREE.MathUtils.clamp(view.pitch+(event.clientY-drag.y)*CAMERA_ORBIT_SENSITIVITY,CAMERA_MIN_PITCH,CAMERA_MAX_PITCH);
 drag.x=event.clientX;drag.y=event.clientY;
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{drag=null;});
canvas.addEventListener('wheel',event=>{
 event.preventDefault();dismiss();
 const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
 view.targetDistance=THREE.MathUtils.clamp(view.targetDistance*Math.exp(pixels*CAMERA_ZOOM_SENSITIVITY),CAMERA_MIN_DISTANCE,CAMERA_MAX_DISTANCE);
},{passive:false});
function movementIntent(){
 const x=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),z=Number(keys.has('KeyS'))-Number(keys.has('KeyW'));
 // View-relative controls become a world vector here, never inside simulation.
 return new THREE.Vector3(x,0,z).applyAxisAngle(THREE.Object3D.DEFAULT_UP,view.yaw).normalize();
}
function simulate(direction,running,dt){
 if(!model)return;
 if(direction.lengthSq()){
  actor.position.addScaledVector(direction,(running?RUN_SPEED:WALK_SPEED)*dt);
  if(actor.position.length()>CLEARING_RADIUS)actor.position.setLength(CLEARING_RADIUS);
  const target=Math.atan2(direction.x,direction.z);
  const angle=Math.atan2(Math.sin(target-actor.rotation.y),Math.cos(target-actor.rotation.y));
  actor.rotation.y+=angle*(1-Math.exp(-TURN_RESPONSE*dt));play(running?'Running':'Walking');
 }else play('Idle_A');
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
 if(model)model.visible=view.distance>=CAMERA_HIDE_DISTANCE;
}
let last=performance.now(),frame;
function tick(now){
 const dt=Math.min(MAX_FRAME_DELTA,(now-last)/1000);last=now;
 simulate(movementIntent(),keys.has('ShiftLeft')||keys.has('ShiftRight'),dt);
 updateView(dt);renderer.render(scene,camera);frame=requestAnimationFrame(tick);
}
updateView(0);frame=requestAnimationFrame(tick);
// Read-only diagnostics for live verification; no simulation depends on this view.
export function snapshot(){return {character:{...character},position:actor.position.toArray(),rotation:actor.rotation.y,camera:{yaw:view.yaw,pitch:view.pitch,distance:view.distance,targetDistance:view.targetDistance},modelLoaded:!!model,modelVisible:model?.visible,animation:animationName,clips:Object.keys(actions),drawCalls:renderer.info.render.calls,pixelRatio:renderer.getPixelRatio(),theme:settings.theme};}
window.addEventListener('pagehide',()=>{
 cancelAnimationFrame(frame);clearTimeout(introTimer);mixer?.stopAllAction();
 const geometries=new Set(),materials=new Set(),textures=new Set();
 scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of (Array.isArray(object.material)?object.material:object.material?[object.material]:[])){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();
});
