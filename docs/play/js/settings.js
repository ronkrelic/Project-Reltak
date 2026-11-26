// Shared preferences. Creation-screen consumers will be wired separately.
export const STORAGE_KEY = 'reltak.settings';
export const DEFAULT_SETTINGS = Object.freeze({theme:'Astral Relics',turntableSpeed:1,reduceMotion:false,quality:'high'});
const themes = ["Astral Relics","Crown and Ember","Moss and Moon","Obsidian Grimoire"];
function normalize(value) {
  const s = value && typeof value === 'object' ? value : {};
  return {theme:themes.includes(s.theme)?s.theme:DEFAULT_SETTINGS.theme,
    turntableSpeed:typeof s.turntableSpeed==='number' && Number.isFinite(s.turntableSpeed)?Math.min(3,Math.max(0,s.turntableSpeed)):1,
    reduceMotion:typeof s.reduceMotion==='boolean'?s.reduceMotion:false,
    quality:['performance','balanced','high'].includes(s.quality)?s.quality:'high'};
}
export function loadSettings() {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return {...DEFAULT_SETTINGS}; }
}
export function saveSettings(value) {
  const settings = normalize(value);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); return true; }
  catch { return false; }
}
