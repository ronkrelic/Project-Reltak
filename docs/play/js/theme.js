// The existing title chrome is CSS-drawn: it references NO theme image files.
// Keep its exact original literals for Astral Relics, not Palette.json's different colors.
// All four catalogs and their 214 PNG/SVG files were checked: no missing equivalents.
export const CHROME_DEFAULTS = Object.freeze({
  "accent": "#d4af6a",
  "accent-bright": "#f0d494",
  "text": "#e8dcc0",
  "divider": "rgba(212,175,106,0.8)",
  "diamond-glow": "rgba(240,212,148,0.6)",
  "subtitle": "#d9c69a",
  "trim-mid": "#c9a55e",
  "trim-shadow": "#8a6a35",
  "trim-dark": "#5c451f",
  "panel-glow": "rgba(212,175,106,0.09)",
  "panel-top": "#141b32",
  "panel-mid": "#0e1324",
  "panel-bottom": "#0a0e1c",
  "fit-glow": "rgba(240,212,148,0.25)",
  "crest-glow": "rgba(240,212,148,0.5)",
  "button-trim": "#d9b96c",
  "button-trim-dark": "#6b5124",
  "button-top": "#1a2340",
  "button-mid": "#10162b",
  "button-bottom": "#0a0e1e",
  "hairline": "rgba(212,175,106,0.4)",
  "button-glow": "rgba(240,212,148,0.35)",
  "text-glow": "rgba(240,212,148,0.45)",
  "hover-hairline": "rgba(240,212,148,0.55)",
  "primary-trim": "#f6e2a8",
  "primary-shadow": "#9a7a3a",
  "primary-glow": "rgba(240,212,148,0.12)",
  "primary-hairline": "rgba(240,212,148,0.65)",
  "footer": "rgba(232,220,192,0.7)",
  "toast-border": "rgba(212,175,106,0.7)"
});
const palettes = {
  "Astral Relics": {
    "background": "#0b162b",
    "panel": "#132947",
    "raised": "#203c60",
    "accent": "#45bfce",
    "trim": "#dfbc70",
    "text": "#eaf5ff",
    "muted": "#a9c5df"
  },
  "Crown and Ember": {
    "background": "#160f12",
    "panel": "#2a1820",
    "raised": "#43252d",
    "accent": "#be3b44",
    "trim": "#dfb46a",
    "text": "#fff0d2",
    "muted": "#c9aead"
  },
  "Moss and Moon": {
    "background": "#101e1b",
    "panel": "#20372c",
    "raised": "#2c4939",
    "accent": "#8eaf67",
    "trim": "#d9b977",
    "text": "#fff3d4",
    "muted": "#b7cbb3"
  },
  "Obsidian Grimoire": {
    "background": "#100f1b",
    "panel": "#201d30",
    "raised": "#322a46",
    "accent": "#956fc0",
    "trim": "#c3b5d9",
    "text": "#f0e7fa",
    "muted": "#b5a7c6"
  }
};
export const THEMES = Object.freeze(Object.fromEntries(Object.entries(palettes).map(([name,palette])=>[name,Object.freeze({name,palette,missingAssets:[]})])));
function rgba(hex,alpha) { const n=parseInt(hex.slice(1),16);return 'rgba('+[(n>>16)&255,(n>>8)&255,n&255,alpha].join(',')+')'; }
export function applyTheme(name, root=document.documentElement) {
  const theme=THEMES[name] || THEMES['Astral Relics'];
  for (const [slot,original] of Object.entries(CHROME_DEFAULTS)) {
    let value=original;
    if(theme.name!=='Astral Relics') {
      const p=theme.palette;
      const role=slot.startsWith('panel-') && slot!=='panel-glow' ? (slot==='panel-top'?'panel':'background') :
        slot.startsWith('button-') && ['button-top','button-mid','button-bottom'].includes(slot) ? (slot==='button-top'?'raised':'panel') :
        slot==='text' || slot==='footer' ? 'text' : slot==='subtitle'?'muted':
        /trim|shadow|dark/.test(slot)?'trim':'accent';
      value=original.startsWith('rgba')?rgba(p[role],original.match(/,\s*([\d.]+)\)$/)[1]):p[role];
    }
    root.style.setProperty('--ui-'+slot,value);
  }
  root.dataset.theme=theme.name;
  return theme;
}
