// Session log: captures everything the game says, console output and page
// errors included, so a run can be sent as a file and read back later.
// Press L in game to download the buffer as reltak-session.txt.
const buffer=[];
const MAX_LINES=4000;
const nativeLog=console.log.bind(console);
function format(value){
  if(typeof value==='string')return value;
  if(value instanceof Error)return value.name+': '+value.message;
  try{return JSON.stringify(value);}catch{return String(value);}
}
function push(tag,args){
  const line='['+(performance.now()/1000).toFixed(3)+'s] ['+tag+'] '+Array.from(args,format).join(' ');
  buffer.push(line);
  if(buffer.length>MAX_LINES)buffer.shift();
  return line;
}
export function log(tag,...args){
  nativeLog(push(tag,args));
}
export function initCapture(){
  for(const level of ['log','info','warn','error']){
    const original=console[level];
    console[level]=(...args)=>{original(...args);push(level.toUpperCase(),args);};
  }
  window.addEventListener('error',event=>push('PAGE',['Unhandled error: '+(event.message||'?')+' at '+(event.filename||'')+':'+(event.lineno||0)]));
  window.addEventListener('unhandledrejection',event=>push('PAGE',['Unhandled rejection: '+format(event.reason)]));
  log('LOG','Console capture active');
}
export function downloadLog(){
  log('LOG','Downloading session log ('+buffer.length+' lines)');
  const header='RELTAK session log\nGenerated: '+new Date().toISOString()+'\nURL: '+location.href+'\n\n';
  const blob=new Blob([header+buffer.join('\n')+'\n'],{type:'text/plain'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='reltak-session.txt';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}