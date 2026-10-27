import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
import {readFile,writeFile} from 'node:fs/promises';
import {runMorse} from '../../core/engine.js';
import {wrapModCode,settleMs} from '../../core/kit.js';
import '../../daemon/harness.js';
import EN from '../../core/locales/en.js';
const out=fileURLToPath(new URL('.',import.meta.url));
const b=await chromium.connectOverCDP(process.env.SPOTIFY_CDP || 'http://127.0.0.1:9333');const p=b.contexts()[0].pages().find(p=>p.url().includes('xpui.app.spotify.com'));await p.bringToFront();
await p.evaluate(()=>{globalThis.__morseReliabilityKit?.__off('morse-reliability-generated');delete globalThis.__morseReliabilityKit;document.querySelector('#morse-reliability-style')?.remove();});
const source=await readFile(new URL('../../runtime/src/20-context.js',import.meta.url),'utf8');
await p.evaluate(`(()=>{const S={app:'spotify',target:document.querySelector('.player-controls')||document.querySelector('[data-testid="control-button-playpause"]').parentElement};const getLanguage=()=> 'en',live=()=>true;const en=${JSON.stringify(EN)};const t=(id,v={})=>String(en[id]??id).replace(/\\{(\\w+)\\}/g,(m,k)=>v[k]??m);${source};window.__morseReliabilityContext={context,probe:effectProbe};})()`);
const context=await p.evaluate(()=>__morseReliabilityContext.context());
await writeFile(`${out}/spotify-context.json`,JSON.stringify(context,null,2));
const request='Add compact −15s and +15s buttons beside Spotify’s playback controls. They must seek the actual song backward or forward by 15 seconds, clamp to the song limits, preserve play/pause state, and match Spotify’s existing player controls and theme. Use real labeled keyboard-accessible buttons. No separate panel.';
let applied=Promise.resolve();const events=[];const modId='morse-reliability-generated';
const exec=async js=>{await applied;try{const code=wrapModCode(modId,js).replaceAll('globalThis.morse','globalThis.__morseReliabilityKit').replace('\nmorse.__run(', '\n__morseReliabilityKit.__run(');const r=await p.evaluate(code);if(!r.ok)return r;await p.waitForTimeout(settleMs(r));return p.evaluate(id=>__morseReliabilityKit.__ready(id),modId);}catch(e){return {ok:false,error:e.message};}};
try {
 console.log('Generating Spotify feature with the real engine and Claude Code…');
 const res=await runMorse({settings:{provider:'claude-code',model:'sonnet',pinned:true,effort:'medium',timeoutMs:120000},request,context,
 exec,emit:e=>{if(e.type!=='token')events.push(e);if(e.type==='phase')console.log(e.phase,e.error||'');if(e.type==='css')applied=applied.then(()=>p.evaluate(css=>{let s=document.querySelector('#morse-reliability-style');if(!s){s=document.createElement('style');s.id='morse-reliability-style';document.head.append(s);}s.textContent=css;},e.css));},
 probe:async(sels,opts)=>{await applied;return p.evaluate(({sels,opts})=>__morseReliabilityContext.probe(null,sels,opts),{sels,opts});},
 look:async()=>({mediaType:'image/png',data:(await p.screenshot()).toString('base64')}),polish:true,
 review:async()=>{await applied;return {mediaType:'image/png',data:(await p.screenshot()).toString('base64')};}
 });
 await applied;
 await writeFile(`${out}/spotify-generated-result.json`,JSON.stringify({request,result:res,events},null,2));
 if(!res.ok)throw new Error(res.error);
 await p.screenshot({path:`${out}/spotify-generated.png`});
 console.log(JSON.stringify({ok:res.ok,title:res.title,attempts:res.attempts,polish:res.polish,js:res.js}));
} finally {await b.close();}
