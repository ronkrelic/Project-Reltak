import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSettings} from './settings.js';
import {applyTheme} from './theme.js';
import {resolveAttack} from './combat.js';
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
log('SESSION',character.name+' the '+character.race+' '+character.class+' enters the clearing.');
const intro=document.getElementById('intro');
document.getElementById('tale').textContent='The tale of '+character.name+' the '+character.race+' '+character.class+' begins.';
const dismiss=()=>intro.classList.add('dismissed');
let introTimer;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080f22);scene.fog=new THREE.Fog(0x080f22,22,85);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setClearColor(0x080f22);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label','Moonlit clearing. WASD move, Shift run, click attack, drag orbit, scroll zoom, L save log, Escape title.');
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
// The duel. Everything here is game logic and staging; none of it knows the camera.
let playerHP=stats.hp,playerDead=false,playerStagger=0,attack=null,attackCooldown=0,arrowTemplate=null;
const projectiles=[],goblinMaterials=[];let goblin=null;
HUD.build(character.name,character.class);
function updateBars(){HUD.setHealth(playerHP,stats.hp);}
updateBars();
function logRoll(result){
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
function beginAttack(){
 if(!model||playerDead||attack||playerStagger>0||attackCooldown>0)return;
 dismiss();
 const a=stats.attack,first=a.clips.draw?'draw':'attack';
 if(!actions[first]){log('COMBAT','Attack clip not loaded: '+first);return;}
 if(goblin&&goblin.alive&&actor.position.distanceTo(goblin.group.position)<=a.range){
  actor.rotation.y=Math.atan2(goblin.group.position.x-actor.position.x,goblin.group.position.z-actor.position.z);
 }
 attack={steps:a.clips.draw?[{clip:'draw',fireAt:null},{clip:'release',fireAt:a.fireAt}]:[{clip:first,fireAt:a.fireAt}],index:0,t:0,fired:false};
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
 const a=stats.attack;
 if(a.type==='melee'){
  if(goblin&&goblin.alive){
   goblin.aggro=true;
   if(actor.position.distanceTo(goblin.group.position)<=a.range){
    const result=resolveAttack(stats,goblinData);logRoll(result);
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
 scene.add(mesh);mesh.position.copy(origin);
 let result=null,homing=false,target=null;
 if(goblin&&goblin.alive){
  goblin.aggro=true;
  result=resolveAttack(stats,goblinData);logRoll(result);
  const chest=goblin.group.position.clone();chest.y+=goblinData.model.height*0.6;
  if(result.hit){homing=true;target=chest;}
  else{
   const side=new THREE.Vector3().crossVectors(chest.clone().sub(origin),THREE.Object3D.DEFAULT_UP).normalize();
   target=chest.addScaledVector(side,PROJECTILE_MISS_OFFSET);target.y+=0.5;
  }
 }
 const direction=target?target.clone().sub(origin).normalize():new THREE.Vector3(Math.sin(actor.rotation.y),0,Math.cos(actor.rotation.y));
 projectiles.push({mesh,velocity:direction.multiplyScalar(a.speed),speed:a.speed,homing,target,result,gravity:a.gravity,asset:a.projectile});
 log('COMBAT',(a.projectile==='arrow'?'An arrow':'A bolt of pale light')+(result===null?' leaps into the dark.':result.hit?' flies true.':' flies wide.'));
 updateBars();
}
function updateProjectiles(dt){
 for(let i=projectiles.length-1;i>=0;i--){
  const p=projectiles[i];
  if(p.homing){
   const chest=goblin&&goblin.alive?goblin.group.position.clone().setY(goblin.group.position.y+goblinData.model.height*0.6):p.target;
   p.velocity.lerp(chest.clone().sub(p.mesh.position).normalize().multiplyScalar(p.speed),Math.min(1,8*dt)).setLength(p.speed);
   if(p.mesh.position.distanceTo(chest)<=PROJECTILE_CONNECT_RADIUS){
    if(p.result&&p.result.hit)damageGoblin(p.result.damage,p.result.crit);
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
 if(!goblin)return;
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
 await Promise.all([loadScenery(),equipWeapon(),loadArrowTemplate()]);
 spawnGoblin(goblinGltf);
 introTimer=setTimeout(dismiss,INTRO_SECONDS*1000);
 log('SESSION','World loaded. The duel awaits.');
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
  actor.position.addScaledVector(direction,(running?RUN_SPEED:WALK_SPEED)*dt);
  if(actor.position.length()>CLEARING_RADIUS)actor.position.setLength(CLEARING_RADIUS);
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
 updateAttack(dt);
 simulate(movementIntent(),keys.has('ShiftLeft')||keys.has('ShiftRight'),dt);
 updateGoblin(dt);
 updateProjectiles(dt);
 updateView(dt);renderer.render(scene,camera);frame=requestAnimationFrame(tick);
}
updateView(0);frame=requestAnimationFrame(tick);
// Read-only diagnostics for live verification; no simulation depends on this view.
export function snapshot(){return {character:{...character},hp:{player:Math.max(0,playerHP),max:stats.hp},goblin:goblin?{hp:Math.max(0,goblin.hp),max:goblinData.hp,alive:goblin.alive,aggro:goblin.aggro,state:goblin.state,animation:goblin.animName}:null,projectiles:projectiles.length,position:actor.position.toArray(),rotation:actor.rotation.y,camera:{yaw:view.yaw,pitch:view.pitch,distance:view.distance,targetDistance:view.targetDistance},modelLoaded:!!model,modelVisible:model?.visible,animation:animationName,clips:Object.keys(actions),drawCalls:renderer.info.render.calls,pixelRatio:renderer.getPixelRatio(),theme:settings.theme};}
window.addEventListener('pagehide',()=>{
 cancelAnimationFrame(frame);clearTimeout(introTimer);mixer?.stopAllAction();goblin?.mixer.stopAllAction();
 const geometries=new Set(),materials=new Set(),textures=new Set();
 scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of (Array.isArray(object.material)?object.material:object.material?[object.material]:[])){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();
});