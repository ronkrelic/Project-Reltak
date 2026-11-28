// Reltak HUD. Pure view layer: game.js pushes state in, this never reaches back.
const MAX_CHAT_LINES=10;
const MAP_PIXELS=168,MAP_WORLD_RADIUS=30,CELL=2,REVEAL_RADIUS=7;
const BAR_COLORS={health:'#a1332e',mana:'#2f5fa3',stamina:'#5d8a3a',hunger:'#b06a1f',thirst:'#2f8fa3'};
const CHAT_TAGS={SESSION:'#cfc4a6',COMBAT:'#d9a05b',ASSET:'#8fa0b8'};
let root=null,bars={},chat=null,mapCanvas=null,mapCtx=null;
const pending=[],revealed=new Set();
const style=document.createElement('style');
style.textContent=`
#hud-root{position:fixed;inset:0;z-index:5;pointer-events:none;font-family:Cinzel,Georgia,serif;color:var(--ui-text,#e8dcc0)}
#hud-root p{margin:0}
#hud-char{position:absolute;top:16px;left:16px;display:flex;gap:10px;align-items:flex-start}
#hud-portrait{width:64px;height:64px;border-radius:50%;background:#000;border:2px solid var(--ui-accent,#c8a24a);box-shadow:0 2px 8px #000;flex:none}
#hud-name{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ui-subtitle,#cfc4a6);text-shadow:0 2px 4px #000;margin:0 0 5px}
#hud-bars{display:flex;flex-direction:column;gap:5px}
.hud-bar{width:172px;height:9px;background:var(--ui-panel-mid,rgba(10,14,22,.75));border:1px solid var(--ui-accent,#c8a24a)}
.hud-bar>div{height:100%;width:100%;transition:width .25s}
html[data-reduce-motion="true"] .hud-bar>div{transition:none}
#hud-map{position:absolute;top:16px;right:16px;padding:3px;background:rgba(6,9,15,.6);border:1px solid var(--ui-accent,#c8a24a);box-shadow:0 2px 8px #000}
#hud-map-canvas{display:block}
#hud-chat{position:absolute;left:16px;bottom:16px;width:340px;height:130px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;padding:8px 10px;background:rgba(6,9,15,.55);border:1px solid var(--ui-accent,#c8a24a)}
.hud-chat-line{font-size:12px;line-height:1.45;text-shadow:0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hud-hotbar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:6px}
.hud-slot{width:44px;height:44px;background:var(--ui-panel-mid,rgba(10,14,22,.75));border:1px solid var(--ui-accent,#c8a24a);box-shadow:0 2px 6px #000;position:relative}
.hud-slot[data-state="spent"],.hud-slot[data-state="unavailable"]{opacity:.4}
.hud-slot b{display:block;margin:14px 2px 0;font-size:8px;line-height:1.1;font-weight:normal;overflow-wrap:anywhere}
#hud-focus{position:absolute;bottom:66px;left:50%;transform:translateX(-50%);font-size:12px;color:var(--ui-accent,#c8a24a)}
.hud-slot span{position:absolute;top:2px;left:4px;font-size:10px;color:var(--ui-subtitle,#cfc4a6)}
#hud-help{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(4,7,12,.65);pointer-events:auto}
#hud-help.open{display:flex}
#hud-help-box{min-width:340px;max-width:420px;padding:18px 22px;background:var(--ui-panel-mid,rgba(10,14,22,.92));border:1px solid var(--ui-accent,#c8a24a);box-shadow:0 6px 24px #000}
#hud-help-title{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:var(--ui-accent-bright,#e4c76a);text-align:center;margin:0 0 14px}
.hud-help-row{display:flex;justify-content:space-between;gap:24px;font-size:13px;line-height:1.9}
.hud-help-key{color:var(--ui-accent-bright,#e4c76a)}
#hud-help-foot{font-size:11px;color:var(--ui-subtitle,#cfc4a6);text-align:center;margin:14px 0 0}
#hint{bottom:96px}
#hint:empty{display:none}
#death-veil{position:fixed;inset:0;background:#080f22;opacity:0;transition:opacity 1.2s;pointer-events:none;z-index:9}
#death-veil.fallen{opacity:1}
html[data-reduce-motion="true"] #death-veil{transition:none}
`;
function barHtml(id){
 return '<div class="hud-bar"><div id="hud-bar-'+id+'" style="background:'+BAR_COLORS[id]+'"></div></div>';
}
function drawMap(px,pz){
 const s=MAP_PIXELS/(MAP_WORLD_RADIUS*2),c=MAP_PIXELS/2;
 mapCtx.clearRect(0,0,MAP_PIXELS,MAP_PIXELS);
 mapCtx.fillStyle='#04060a';mapCtx.fillRect(0,0,MAP_PIXELS,MAP_PIXELS);
 mapCtx.fillStyle='rgba(96,140,112,.5)';
 const half=CELL*s;
 for(const key of revealed){
  const parts=key.split(','),wx=Number(parts[0])*CELL+CELL/2,wz=Number(parts[1])*CELL+CELL/2;
  if(Math.abs(wx)>MAP_WORLD_RADIUS||Math.abs(wz)>MAP_WORLD_RADIUS)continue;
  mapCtx.fillRect(c+wx*s-half,c+wz*s-half,half*2+0.5,half*2+0.5);
 }
 mapCtx.fillStyle='#e4c76a';
 mapCtx.beginPath();mapCtx.arc(c+px*s,c+pz*s,3,0,Math.PI*2);mapCtx.fill();
}
export const HUD={
 build(name,className){
  document.head.append(style);
  root=document.createElement('div');root.id='hud-root';
  let hotbar='';
  for(let i=0;i<10;i++)hotbar+='<div class="hud-slot"><span>'+((i+1)%10)+'</span></div>';
  root.innerHTML='<div id="hud-char"><div id="hud-portrait"></div><div><p id="hud-name"></p><div id="hud-bars">'
   +barHtml('health')+barHtml('mana')+barHtml('stamina')+barHtml('hunger')+barHtml('thirst')
   +'</div></div></div>'
   +'<div id="hud-map"><canvas id="hud-map-canvas" width="'+MAP_PIXELS+'" height="'+MAP_PIXELS+'"></canvas></div>'
   +'<div id="hud-chat"></div>'
   +'<div id="hud-hotbar">'+hotbar+'</div>';
  document.body.append(root);
  document.getElementById('hud-name').textContent=name+' - '+className;
  for(const id of Object.keys(BAR_COLORS))bars[id]=document.getElementById('hud-bar-'+id);
  chat=document.getElementById('hud-chat');
  mapCanvas=document.getElementById('hud-map-canvas');mapCtx=mapCanvas.getContext('2d');
  for(const m of pending)HUD.message(m.text,m.tag);
  pending.length=0;
  const help=document.createElement('div');help.id='hud-help';
  let rows='';
  const keys=[['1 / 2 / 3','Class abilities'],['WASD','Move'],['Hold Shift','Run'],['Click or F','Attack'],['Drag','Orbit camera'],['Scroll','Zoom'],['L','Save session log'],['F1','This help'],['Escape','Title screen']];
  for(const pair of keys)rows+='<div class="hud-help-row"><span class="hud-help-key">'+pair[0]+'</span><span>'+pair[1]+'</span></div>';
  help.innerHTML='<div id="hud-help-box"><p id="hud-help-title">Controls</p>'+rows+'<p id="hud-help-foot">Press F1 or Escape to close</p></div>';
  help.addEventListener('click',function(){if(helpOpen)toggleHelp();});
  root.append(help);
  drawMap(0,0);
 },
 setAbilities(abilities){
  const slots=root.querySelectorAll('.hud-slot');
  for(const ability of abilities){const slot=slots[ability.key-1],label=document.createElement('b');label.textContent=ability.name;slot.append(label);slot.title=ability.name+' — '+ability.cost;}
 },
 setAbilityState(key,state){
  const slot=root?.querySelectorAll('.hud-slot')[key-1];
  if(slot){slot.dataset.state=state;slot.setAttribute('aria-label',slot.textContent+' — '+state);}
 },
 setFocus(value){
  let node=document.getElementById('hud-focus');
  if(!node){node=document.createElement('p');node.id='hud-focus';root.append(node);}
  node.textContent='Focus '+('◆'.repeat(value))+('◇'.repeat(2-value));
 },
 message(text,tag){
  if(!chat){pending.push({text,tag});return;}
  const line=document.createElement('p');
  line.className='hud-chat-line';
  line.style.color=CHAT_TAGS[tag]||'var(--ui-text,#e8dcc0)';
  line.textContent=text;
  chat.append(line);
  while(chat.children.length>MAX_CHAT_LINES)chat.firstElementChild.remove();
 },
 setHealth(hp,max){
  if(bars.health)bars.health.style.width=Math.max(0,Math.min(1,hp/max))*100+'%';
 },
 setPlayerPosition(x,z){
  if(!mapCtx)return;
  const cx=Math.floor(x/CELL),cz=Math.floor(z/CELL),r=REVEAL_RADIUS/CELL,r2=r*r;
  for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++){
   if(dx*dx+dz*dz<=r2)revealed.add((cx+dx)+','+(cz+dz));
  }
  drawMap(x,z);
 }
};
let helpOpen=false;
function toggleHelp(){
 helpOpen=!helpOpen;
 const el=document.getElementById('hud-help');
 if(el)el.classList.toggle('open',helpOpen);
}
window.addEventListener('keydown',function(e){
 if(e.code==='F1'){e.preventDefault();toggleHelp();}
 else if(e.code==='Escape'&&helpOpen){e.preventDefault();e.stopPropagation();toggleHelp();}
},true);
