// Spotify loop pads. Runs as a Morse mod; all audio stays in Spotify.
const state = { a: 0, b: 8, active: -1, song: '', pads: [], loops: 0, seeking: 0 };
const el = (tag, attrs, ...children) => morse.el(tag, attrs, ...children);
const fmt = n => `${Math.floor(Math.max(0,n)/60)}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
const seconds = text => String(text||'').split(':').reduce((n,x)=>n*60+Number(x),0)||0;
const position = () => seconds(document.querySelector('[data-testid="playback-position"]')?.textContent);
const duration = () => seconds(document.querySelector('[data-testid="playback-duration"]')?.textContent);
const songName = () => document.querySelector('[data-testid="context-item-info-title"]')?.textContent?.trim() || document.querySelector('.main-trackInfo-name a')?.textContent?.trim() || document.title.replace(/ • .*/, '').replace(/Spotify.*/, '').trim() || 'Play a song in Spotify';
const songKey = () => document.querySelector('[data-testid="context-item-info-title"]')?.getAttribute('href') || document.querySelector('.main-trackInfo-name a')?.getAttribute('href') || songName();
function seek(to) {
  to=Math.max(0,Math.min(duration()||1e5,to));
  if(window.Spicetify?.Player?.seek){window.Spicetify.Player.seek(to*1000);return true;}
  const slider=document.querySelector('input[type="range"][aria-label="Change progress"], [data-testid="playback-progressbar"] input[type="range"], .playback-bar input[type="range"]');
  if(slider){
    const max=Number(slider.max)||duration()*1000;
    const value=max<=1?to/(duration()||1):max>duration()*10?to*1000:to;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,String(value));
    const key=Object.keys(slider).find(k=>k.startsWith('__reactProps$'));
    const props=key&&slider[key];
    if(props?.onChange)props.onChange({target:slider,currentTarget:slider,type:'change',nativeEvent:new Event('change'),preventDefault(){},stopPropagation(){}});
    else {slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));}
    return true;
  }
  const track=document.querySelector('[data-testid="playback-progressbar"], .playback-bar .progress-bar');
  if(!track)return false;
  const rect=track.getBoundingClientRect(),x=rect.left+rect.width*to/(duration()||1),y=rect.top+rect.height/2;
  for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])track.dispatchEvent(type.startsWith('pointer')?new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1,pointerType:'mouse',isPrimary:true}):new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0}));
  return true;
}
const panel=el('section',{class:'mls-panel',hidden:true,'aria-label':'Loop Station'});
const status=el('span',{class:'mls-status',text:'Ready to loop'});
const title=el('h2',{text:'Loop Station'}), trackTitle=el('p',{class:'mls-track'});
const live=el('span',{class:'mls-clock',text:'0:00'});
const inputA=el('input',{type:'number',min:'0',step:'1',value:'0','aria-label':'Loop IN seconds'});
const inputB=el('input',{type:'number',min:'1',step:'1',value:'8','aria-label':'Loop OUT seconds'});
const name=el('input',{type:'text',maxlength:'24',placeholder:'Name this section','aria-label':'Loop name'});
const pads=el('div',{class:'mls-pads'}), timeline=el('div',{class:'mls-timeline'}),region=el('div',{class:'mls-region'}),playhead=el('div',{class:'mls-playhead'});
timeline.append(region,playhead);
function resetSong(){const key=songKey();if(key===state.song)return;state.song=key;state.active=-1;state.loops=0;state.pads=morse.store.get('pads:'+key)||[];renderPads();status.textContent='Ready to loop';}
function stop(){state.active=-1;state.loops=0;status.textContent='Loop stopped';renderPads();}
function trigger(i){const p=state.pads[i];if(!p)return;state.active=i;state.a=p.a;state.b=p.b;state.loops=0;inputA.value=p.a;inputB.value=p.b;name.value=p.name;state.seeking=Date.now();if(!seek(p.a)){stop();status.textContent='Open a song with a seek bar first';return;}const play=document.querySelector('[data-testid="control-button-playpause"][aria-label="Play"]');play?.click();status.textContent='Looping '+p.name;renderPads();}
function renderPads(){pads.replaceChildren(...Array.from({length:8},(_,i)=>{const p=state.pads[i];const b=el('button',{type:'button',class:'mls-pad'+(p?' has-loop':'')+(state.active===i?' is-active':''),'aria-label':p?`Pad ${i+1}: ${p.name}, ${fmt(p.a)} to ${fmt(p.b)}`:`Pad ${i+1}: empty`,on:{click:()=>p?trigger(i):save(i)}});b.append(el('span',{class:'mls-pad-number',text:String(i+1)}),el('strong',{text:p?p.name:'Save here'}),el('small',{text:p?`${fmt(p.a)} — ${fmt(p.b)}`:'Mark IN and OUT first'}));return b;}));}
function readPoints(){state.a=Math.max(0,Number(inputA.value)||0);state.b=Math.min(duration()||1e5,Number(inputB.value)||0);}
function save(slot){readPoints();if(state.b<=state.a){status.textContent='OUT must be after IN';return;}let i=Number.isInteger(slot)?slot:state.pads.findIndex(p=>!p);if(i<0)i=state.pads.length<8?state.pads.length:state.active>=0?state.active:0;state.pads[i]={a:state.a,b:state.b,name:name.value.trim()||`Section ${i+1}`};morse.store.set('pads:'+state.song,state.pads);status.textContent=`Saved to pad ${i+1}`;renderPads();}
const button=(text,fn,cls='')=>el('button',{type:'button',class:cls,text,on:{click:fn}});
panel.append(el('header',{class:'mls-head'},el('div',{},el('span',{class:'mls-eyebrow',text:'MORSE / SPOTIFY MOD'}),title,trackTitle),button('Close',()=>panel.hidden=true)),el('div',{class:'mls-readout'},live,status),timeline,el('div',{class:'mls-controls'},el('label',{},'IN ',inputA),button('Mark IN',()=>inputA.value=Math.floor(position())),el('label',{},'OUT ',inputB),button('Mark OUT',()=>inputB.value=Math.floor(position())),name,button('Save to pad',()=>save(),'mls-save'),button('Stop loop',stop)),pads,el('p',{class:'mls-help',text:'Choose a section. Save it to a pad. Press 1–8 to jump and loop. Spotify still plays the music.'}));
document.body.append(panel);
const launch=button('Loop Station',()=>{panel.hidden=!panel.hidden;resetSong()},'mls-launch');launch.setAttribute('aria-label','Open Loop Station');
morse.watch('[data-testid="player-controls"], .player-controls',root=>{if(!launch.isConnected)root.append(launch)},{live:true});
morse.every(120,()=>{
 if(!launch.isConnected){const root=document.querySelector('[data-testid="now-playing-bar"], footer');root?.append(launch);}
 resetSong();const pos=position(),len=duration()||1;
 trackTitle.textContent=songName();live.textContent=`${fmt(pos)} / ${fmt(len)}`;
 readPoints();region.style.left=(state.a/len*100)+'%';region.style.width=(Math.max(0,state.b-state.a)/len*100)+'%';playhead.style.left=(pos/len*100)+'%';
 if(state.active>=0&&pos>=state.b&&Date.now()-state.seeking>700){state.seeking=Date.now();state.loops++;seek(state.a);status.textContent=`Looping ${state.pads[state.active]?.name} · ${state.loops} repeat${state.loops===1?'':'s'}`;}
});
morse.on(document,'keydown',e=>{if(panel.hidden||e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable)return;const i=Number(e.key)-1;if(i>=0&&i<8){e.preventDefault();trigger(i)}});
renderPads();resetSong();
return ()=>{panel.remove();launch.remove()};
