// ─── CONFIG ───
const JSON_URL = 'https://cdn.jsdelivr.net/gh/bugsfreeweb/LiveTVCollector@main/LiveTV/Bangladesh/LiveTV.json';
const CACHE_KEY = 'xtra_tv_channels_v2';
const CACHE_TS_KEY = 'xtra_tv_cache_ts_v2';
const CACHE_TTL = 5 * 60 * 1000;

const GROUP_ICONS = {
  'news':'📰','বাংলা':'🇧🇩','sports':'⚽','entertainment':'🎬',
  'music':'🎵','kids':'👶','movies':'🎥','religious':'🕌',
  'documentary':'🎞️','business':'💼','tech':'💻','lifestyle':'🌿',
  'default':'📡'
};
function getGroupIcon(n){
  if(!n) return GROUP_ICONS.default;
  const l=n.toLowerCase();
  for(const [k,v] of Object.entries(GROUP_ICONS)) if(l.includes(k)) return v;
  return GROUP_ICONS.default;
}

// ─── Obfuscation ───
const _K=[0x4c,0x53,0x42,0x44,0x37,0x29,0x5a,0x71,0x1f,0x3e,0x88,0xa2,0x5c,0x17,0x63,0x4b];
function _enc(s){
  // FIX: Use TextEncoder so Unicode/non-ASCII URLs encode safely
  const b=new TextEncoder().encode(s);
  const x=b.map((c,i)=>c^_K[i%_K.length]);
  // Safe base64 via Uint8Array → string
  let bin='';
  x.forEach(byte=>{ bin+=String.fromCharCode(byte); });
  return btoa(bin).replace(/=/g,'').split('').reverse().join('');
}
function _dec(s){
  try{
    const r=s.split('').reverse().join('');
    const p=r+'='.repeat((4-r.length%4)%4);
    const bin=atob(p);
    const b=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i)^_K[i%_K.length];
    return new TextDecoder().decode(b);
  }catch(e){ return ''; }
}
function xe(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}

// ─── State ───
let channels=[], filtered_=[], currentChannel=null, currentEnc=null,
    hlsObj=null, currentCat='all', searchQ='',
    retryCount=0, autoRetryTimer=null, _muted=false, _ctrlTimer=null,
    fitMode='contain', _curSpeed=1, _isVod=false, _isDirectPlay=false,
    _stalledTimer=null, _tt=null, _progressTimer=null,
    _searchDebounce=null, _moveThrottle=false, _watchdogTimer=null,
    _rafLoopRunning=false,
    // FIX: track user volume preference so safePlay() doesn't reset it
    _userVolume=0.3,
    _preloadHls=null, _preloadTimer=null;
const gridElMap=new Map();

// ─── DOM refs ───
const video       = document.getElementById('videoPlayer');
const pw          = document.getElementById('playerWrapper');
const $ovEmpty    = document.getElementById('ovEmpty');
const $ovLoad     = document.getElementById('ovLoad');
const $ovErr      = document.getElementById('ovErr');
const $loadNm     = document.getElementById('loadNm');
const $errTitle   = document.getElementById('errTitle');
const $errBody    = document.getElementById('errBody');
const $progFill   = document.getElementById('progFill');
const $progBuf    = document.getElementById('progBuf');
const $timeLabel  = document.getElementById('timeLabel');
const $resBadge   = document.getElementById('resBadge');
const $qualSel    = document.getElementById('qualSel');
const $audioOver  = document.getElementById('audioOverlay');
const $audioTitle = document.getElementById('audioTitle');
const $livePill   = document.getElementById('livePill');
const $nowLogo    = document.getElementById('nowLogo');
const $nowName    = document.getElementById('nowName');
const $nowCat     = document.getElementById('nowCat');
const $hdrCount   = document.getElementById('hdrCount');
const $gridTitle  = document.getElementById('gridTitle');
const $gridCount  = document.getElementById('gridCount');
const $channelGrid= document.getElementById('channelGrid');
const $volSlider  = document.getElementById('volSlider');
const $btnPlay    = document.getElementById('btnPlay');
const $muteIcon   = document.getElementById('muteIcon');
const $toast      = document.getElementById('toast');
const $groupList  = document.getElementById('groupList');
const isMobile    = ()=>window.innerWidth<=700;

video.volume = _userVolume;
$volSlider.value = _userVolume;

// ─── Audio bars ───
(()=>{
  const bars=document.getElementById('audioBars');
  const frag=document.createDocumentFragment();
  for(let i=0;i<18;i++){
    const s=document.createElement('span');
    s.style.cssText=`--h:${20+Math.random()*80}%;--d:${(0.3+Math.random()*0.6).toFixed(2)}s`;
    frag.appendChild(s);
  }
  bars.appendChild(frag);
})();

// ─── HLS.js loader ───
let _hlsLoading=false, _hlsQueue=[];
function ensureHls(cb){
  if(typeof Hls!=='undefined'){cb();return;}
  _hlsQueue.push(cb);
  if(_hlsLoading) return;
  _hlsLoading=true;
  const s=document.createElement('script');
  s.src='https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.4.12/hls.min.js';
  s.onload=()=>{_hlsLoading=false;_hlsQueue.forEach(fn=>fn());_hlsQueue=[];};
  s.onerror=()=>{_hlsLoading=false;_hlsQueue=[];console.warn('HLS.js load failed');};
  document.head.appendChild(s);
}

// ─── FIX: Next channel preload — guarded against race conditions ───
function destroyPreload(){
  clearTimeout(_preloadTimer);
  if(_preloadHls){
    try{_preloadHls.destroy();}catch(e){}
    _preloadHls=null;
  }
}

function preloadNextChannel(){
  destroyPreload();
  if(!filtered_.length||!currentChannel) return;
  const idx=filtered_.findIndex(c=>c.id===currentChannel.id);
  if(idx===-1||idx>=filtered_.length-1) return;
  const next=filtered_[idx+1];
  if(!next||!next.enc) return;
  const snapChannel=currentChannel; // capture for closure guard
  _preloadTimer=setTimeout(()=>{
    // FIX: Don't preload if user already switched channel
    if(currentChannel!==snapChannel) return;
    ensureHls(()=>{
      if(!Hls.isSupported()) return;
      if(currentChannel!==snapChannel) return; // double-check after async ensureHls
      try{
        const url=_dec(next.enc);
        if(!url) return;
        _preloadHls=new Hls({
          maxBufferLength:4,
          startLevel:-1,
          fragLoadingTimeOut:8000,
          manifestLoadingTimeOut:6000,
        });
        _preloadHls.loadSource(url);
        const dummy=document.createElement('video');
        _preloadHls.attachMedia(dummy);
        setTimeout(()=>{
          if(_preloadHls){try{_preloadHls.destroy();}catch(e){} _preloadHls=null;}
        },30000);
      }catch(e){_preloadHls=null;}
    });
  },3000);
}

// ─── Toast ───
function toast(msg,dur=1600){
  clearTimeout(_tt);
  $toast.classList.remove('show');
  void $toast.offsetWidth;
  $toast.textContent=msg;
  $toast.classList.add('show');
  _tt=setTimeout(()=>$toast.classList.remove('show'),dur);
}

// ─── FIX: safePlay() respects user volume preference ───
function safePlay(){
  video.volume=_userVolume;
  $volSlider.value=_userVolume;
  video.muted=true;
  const p=video.play();
  if(p&&p.then){
    const cc=currentChannel, ce=currentEnc;
    p.then(()=>{
      setTimeout(()=>{
        if(currentChannel!==cc||currentEnc!==ce) return;
        video.muted=false;
        _muted=false;
        video.volume=_userVolume;
        $volSlider.value=_userVolume;
        updateMuteIcon(false);
      },200);
    }).catch(()=>{
      _muted=true;
      video.muted=true;
      video.volume=_userVolume;
      $volSlider.value=_userVolume;
      updateMuteIcon(true);
      toast('🔇 Tap 🔊 to unmute',2500);
    });
  }
}

function updateMuteIcon(m){
  $muteIcon.innerHTML=m
    ?'<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
    :'<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
}

function destroyStream(){
  clearTimeout(_stalledTimer);
  clearTimeout(_watchdogTimer);
  clearAuto();
  stopProgressTimer();
  destroyPreload();
  _isDirectPlay=false;
  // FIX: capture & compare hlsObj to avoid double-destroy on rapid switches
  const h=hlsObj;
  hlsObj=null;
  if(h){
    try{h.destroy();}catch(e){}
  } else {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  showLoad(false);
  showErr(false);
}

function showLoad(on,name){
  $ovLoad.classList.toggle('show',!!on);
  if(name) $loadNm.textContent='Loading '+name+'…';
  else if(!on) $loadNm.textContent='Loading…';
}
function showErr(on,body,title){
  $ovErr.classList.toggle('show',!!on);
  if(body)  $errBody.textContent=body;
  if(title) $errTitle.textContent=title;
}

// ─── URL Modal ───
const backdrop=document.getElementById('urlModalBackdrop');
function openUrlModal(){
  backdrop.classList.add('open');
  setTimeout(()=>document.getElementById('urlInput').focus(),80);
}
function closeUrlModal(){backdrop.classList.remove('open');}
backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeUrlModal();});
document.getElementById('umCancel').addEventListener('click',closeUrlModal);
document.getElementById('umPlay').addEventListener('click',playFromUrlModal);
document.getElementById('urlInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();playFromUrlModal();}});

function playFromUrlModal(){
  const url=document.getElementById('urlInput').value.trim();
  const title=document.getElementById('urlTitleInput').value.trim()||url.split('/').pop().split('?')[0]||'Stream';
  if(!url){toast('⚠️ Enter a URL');return;}
  closeUrlModal();
  document.getElementById('urlInput').value='';
  document.getElementById('urlTitleInput').value='';
  const isAudio=/\.(mp3|aac|flac|wav|ogg|m4a|opus)(\?|$)/i.test(url);
  playDirect(url,title,isAudio?'🎵':'🔗',isAudio?'Audio':'Network Stream',isAudio);
}

function playDirect(url,name,icon,cat,isAudio=false){
  if(!url||typeof url!=='string'||!url.trim()){toast('⚠️ Invalid URL');return;}
  url=url.trim();
  const prevId=currentChannel?currentChannel.id:null;
  currentChannel=null; currentEnc=null; retryCount=0; clearAuto();
  _isDirectPlay=true;
  document.title=name+' – Xtra TV';
  $ovEmpty.classList.remove('show');
  $livePill.style.display='none';
  $nowLogo.innerHTML=icon||'🎬';
  $nowName.textContent=name;
  $nowCat.textContent=cat||'Stream';
  updateActiveHighlight(prevId,null);
  loadStreamDirect(url,name,isAudio);
}

// FIX: loadStreamDirect — properly clean up dangling event listeners
function loadStreamDirect(url,name,isAudio){
  destroyStream();
  showLoad(true,name);
  $qualSel.innerHTML='<option value="-1">Auto</option>';
  $resBadge.style.display='none';
  setTimeMode(false);
  $audioOver.classList.toggle('show',isAudio);
  $audioTitle.textContent=name;

  let readyFired=false;
  let errorFired=false;

  _watchdogTimer=setTimeout(()=>{
    if(readyFired) return;
    showLoad(false);
    showErr(true,'No response from this URL (8s). It may require a specific Referer, be geo-restricted, or temporarily down.','Server not responding');
  },8000);

  const onReady=()=>{
    if(readyFired) return;
    readyFired=true;
    clearTimeout(_watchdogTimer);
    showLoad(false);safePlay();setPlayIcon(true);pw.classList.remove('paused');startProgressTimer();
  };
  const onFail=(reason)=>{
    if(errorFired) return;
    errorFired=true;
    clearTimeout(_watchdogTimer);
    showLoad(false);
    showErr(true,reason||'Cannot play this URL.','Unsupported format');
  };

  const isHls=/\.m3u8?(\?|$)/i.test(url);
  if(isHls){
    ensureHls(()=>{
      if(Hls.isSupported()){
        const h=new Hls({
          lowLatencyMode:false,
          maxBufferLength:8,
          maxMaxBufferLength:20,
          startLevel:-1,
        });
        hlsObj=h;
        h.loadSource(url);
        h.attachMedia(video);
        h.on(Hls.Events.MANIFEST_PARSED,()=>{
          if(h!==hlsObj) return;
          onReady();
          if(h.levels&&h.levels.length>1){
            const frag=document.createDocumentFragment();
            const autoOpt=document.createElement('option');
            autoOpt.value='-1'; autoOpt.textContent='Auto';
            frag.appendChild(autoOpt);
            h.levels.forEach((lv,i)=>{
              const opt=document.createElement('option');
              opt.value=String(i);
              opt.textContent=lv.height?(lv.height>=2160?'4K':lv.height+'p'):'L'+(i+1);
              frag.appendChild(opt);
            });
            $qualSel.innerHTML='';
            $qualSel.appendChild(frag);
          }
        });
        h.on(Hls.Events.ERROR,(e,d)=>{
          if(h!==hlsObj) return;
          if(d.fatal) onFail('Stream failed.');
        });
      } else if(video.canPlayType('application/vnd.apple.mpegurl')){
        // FIX: Use named handlers so they can be properly removed
        const onMeta=()=>{ cleanNative(); onReady(); };
        const onErr=()=>{ cleanNative(); onFail('Stream failed on this device.'); };
        const cleanNative=()=>{
          video.removeEventListener('loadedmetadata',onMeta);
          video.removeEventListener('error',onErr);
        };
        video.src=url;
        video.addEventListener('loadedmetadata',onMeta);
        video.addEventListener('error',onErr);
      } else {
        onFail('HLS not supported in this browser.');
      }
    });
    return;
  }
  // FIX: Named handlers to avoid dangling listeners
  const onMeta2=()=>{
    cleanDirect();
    onReady();
    if(video.duration&&isFinite(video.duration)) setTimeMode(true);
  };
  const onErr2=()=>{ cleanDirect(); onFail('Cannot play this URL.'); };
  const cleanDirect=()=>{
    video.removeEventListener('loadedmetadata',onMeta2);
    video.removeEventListener('error',onErr2);
  };
  video.src=url;
  video.addEventListener('loadedmetadata',onMeta2);
  video.addEventListener('error',onErr2);
}

// ─── JSON fetch with localStorage cache ───
function parseJSON(data){
  try{
    if(data.channels&&!Array.isArray(data.channels)&&typeof data.channels==='object'){
      const arr=[];
      for(const [cat,list] of Object.entries(data.channels)){
        if(!Array.isArray(list)) continue;
        for(const ch of list){
          try{arr.push({name:(ch.name||ch.title||'').trim(),url:(ch.url||ch.stream||ch.link||'').trim(),category:(ch.group||ch.category||ch.cat||cat).trim(),logo:(ch.logo||ch.image||ch.icon||'').trim()});}catch(e){}
        }
      }
      return arr;
    }
    const src=Array.isArray(data.channels)?data.channels:Array.isArray(data)?data:[];
    return src.map(ch=>{
      try{return{name:(ch.name||ch.title||'').trim(),url:(ch.url||ch.stream||ch.link||'').trim(),category:(ch.group||ch.category||ch.cat||'').trim(),logo:(ch.logo||ch.image||ch.icon||'').trim()};}
      catch(e){return null;}
    }).filter(Boolean);
  }catch(e){console.warn('[XtraTV] parseJSON error',e);return[];}
}

function processChannels(raw){
  return raw.filter(c=>c.url&&c.name).map((c,i)=>({
    id:'ch'+i,
    name:c.name,
    enc:_enc(c.url),
    category:c.category,
    logo:c.logo
  }));
}

function applyChannels(chs){
  if(!chs||!chs.length) return false;
  channels=chs;
  $hdrCount.textContent=channels.length+' Channels';
  if(document.pictureInPictureEnabled) document.getElementById('btnPip').style.display='flex';
  renderAll();
  return true;
}

async function fetchChannels(){
  $groupList.innerHTML='<div style="padding:6px;width:100%"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>';
  let cacheUsed=false;
  try{
    const cached=localStorage.getItem(CACHE_KEY);
    const cachedTs=parseInt(localStorage.getItem(CACHE_TS_KEY)||'0',10);
    if(cached&&cachedTs&&(Date.now()-cachedTs)<CACHE_TTL){
      const parsed=JSON.parse(cached);
      if(parsed&&parsed.length){
        applyChannels(parsed);
        cacheUsed=true;
        _bgRefresh();
        return;
      }
    }
  }catch(e){}
  await _fetchAndRender(true);
}

// FIX: Background refresh — preserve currentChannel reference after channel array replace
async function _bgRefresh(){
  try{
    const res=await fetch(JSON_URL);
    if(!res.ok) return;
    const text=await res.text();
    if(text.trim().startsWith('<')) return;
    let data;
    try{data=JSON.parse(text);}catch(e){return;}
    const raw=parseJSON(data);
    const chs=processChannels(raw);
    if(!chs.length) return;
    try{
      localStorage.setItem(CACHE_KEY,JSON.stringify(chs));
      localStorage.setItem(CACHE_TS_KEY,String(Date.now()));
    }catch(e){}
    if(Math.abs(chs.length-channels.length)>0){
      // FIX: Re-resolve currentChannel by name+category so it isn't orphaned
      const prevId=currentChannel?currentChannel.id:null;
      const prevName=currentChannel?currentChannel.name:null;
      const prevCat=currentChannel?currentChannel.category:null;
      channels=chs;
      if(prevName){
        const match=channels.find(c=>c.name===prevName&&c.category===prevCat);
        if(match){
          currentChannel=match;
          currentEnc=match.enc;
        } else {
          // Channel no longer exists — clear gracefully
          currentChannel=null;
          currentEnc=null;
        }
      }
      $hdrCount.textContent=channels.length+' Channels';
      renderAll();
    }
  }catch(e){}
}

async function _fetchAndRender(showError){
  try{
    const res=await fetch(JSON_URL);
    if(!res.ok) throw {type:'network',status:res.status};
    const text=await res.text();
    if(text.trim().startsWith('<')) throw {type:'notjson'};
    let data;
    try{data=JSON.parse(text);}catch(pe){throw{type:'json',detail:pe.message};}
    const raw=parseJSON(data);
    const chs=processChannels(raw);
    if(!chs.length) throw {type:'empty'};
    try{
      localStorage.setItem(CACHE_KEY,JSON.stringify(chs));
      localStorage.setItem(CACHE_TS_KEY,String(Date.now()));
    }catch(e){}
    applyChannels(chs);
  }catch(e){
    if(!showError) return;
    console.error('[XtraTV]',e);
    let icon='⚠️',title='Could not load channels',body='Check the JSON_URL in the config.';
    if(!navigator.onLine){icon='📡';title='No internet';body='You appear to be offline.';}
    else if(e.type==='network'){icon='🔗';title='File not found ('+e.status+')';body='Make sure the URL is public and correct.';}
    else if(e.type==='notjson'){icon='📄';title='Not a JSON file';body='Use the jsDelivr CDN link.';}
    else if(e.type==='json'){icon='🔧';title='JSON syntax error';body=e.detail||'Validate your JSON at jsonlint.com';}
    else if(e.type==='empty'){icon='📋';title='No channels found';body='Each entry needs name and url fields.';}
    $groupList.innerHTML=`<div style="padding:16px 10px;text-align:center">
      <div style="font-size:26px;margin-bottom:8px">${icon}</div>
      <div style="font-size:12px;font-weight:600;margin-bottom:5px">${xe(title)}</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.7;margin-bottom:10px">${xe(body)}</div>
      <button onclick="fetchChannels()" style="background:var(--accent);color:#fff;border:none;padding:6px 16px;border-radius:7px;font-size:11px;cursor:pointer;font-weight:600">↺ Retry</button>
    </div>`;
  }
}

// ─── Render ───
function renderAll(scrollSidebar=false){computeFiltered();renderGroupList(scrollSidebar);renderGrid();}

function computeFiltered(){
  filtered_=channels.filter(ch=>{
    const cOk=currentCat==='all'||(ch.category||'').toLowerCase()===currentCat.toLowerCase();
    const sOk=!searchQ||ch.name.toLowerCase().includes(searchQ)||(ch.category||'').toLowerCase().includes(searchQ);
    return cOk&&sOk;
  });
  if(!filtered_.length&&currentCat!=='all'&&searchQ){
    currentCat='all';
    filtered_=channels.filter(ch=>!searchQ||ch.name.toLowerCase().includes(searchQ)||(ch.category||'').toLowerCase().includes(searchQ));
  }
  $gridTitle.textContent=currentCat==='all'?'All Channels':currentCat;
  $gridCount.textContent=filtered_.length+' Channels';
}

function buildCounts(){
  const src=searchQ?channels.filter(ch=>ch.name.toLowerCase().includes(searchQ)||(ch.category||'').toLowerCase().includes(searchQ)):channels;
  const m={all:src.length};
  for(const ch of src){const c=ch.category||'';if(c)m[c]=(m[c]||0)+1;}
  return m;
}

function renderGroupList(scrollToActive=false){
  const cats=[...new Set(channels.map(c=>c.category).filter(Boolean))].sort();
  const counts=buildCounts();
  const frag=document.createDocumentFragment();

  function makeGroupItem(cat,icon,label,count){
    const el=document.createElement('div');
    el.className='group-item'+(currentCat===cat?' active':'');
    el.dataset.cat=cat;
    el.innerHTML=`<div class="group-icon">${icon}</div><div class="group-info"><div class="group-name">${xe(label)}</div></div><span class="group-badge">${count}</span>`;
    el.addEventListener('click',()=>filterCat(cat));
    frag.appendChild(el);
    return el;
  }

  makeGroupItem('all','🌐','All',counts.all);
  for(const c of cats){
    const cnt=counts[c]||0;
    if(searchQ&&cnt===0) continue;
    makeGroupItem(c,getGroupIcon(c),c,cnt);
  }
  $groupList.innerHTML='';
  $groupList.appendChild(frag);
  if(scrollToActive){
    const active=$groupList.querySelector('.group-item.active');
    if(active) active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
  }
}

function filterCat(c){
  if(currentCat===c) return;
  currentCat=c;
  renderAll(true);
}

function logoHTML(ch,size){
  return ch.logo
    ?`<img src="${xe(ch.logo)}" loading="lazy" decoding="async" width="${size}" height="${size}" onerror="this.style.display='none';this.parentNode.innerHTML='📺'">`
    :'📺';
}

// FIX: renderGrid uses DocumentFragment and avoids innerHTML+= for quality options
function renderGrid(){
  gridElMap.clear();
  if(!filtered_.length){
    $channelGrid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);font-size:11px">No channels found</div>';
    return;
  }
  const frag=document.createDocumentFragment();
  for(const ch of filtered_){
    const el=document.createElement('div');
    el.className='grid-ch'+(currentChannel&&currentChannel.id===ch.id?' active':'');
    el.dataset.id=ch.id;
    el.innerHTML=`<div class="grid-logo">${logoHTML(ch,34)}</div><div class="grid-name">${xe(ch.name||'')}</div>`;
    el.addEventListener('click',()=>pickChannel(el.dataset.id));
    gridElMap.set(ch.id,el);
    frag.appendChild(el);
  }
  $channelGrid.innerHTML='';
  $channelGrid.appendChild(frag);
  if(currentChannel){
    const activeEl=gridElMap.get(currentChannel.id);
    if(activeEl) requestAnimationFrame(()=>activeEl.scrollIntoView({block:'nearest',behavior:'smooth'}));
  }
}

function updateActiveHighlight(prevId,newId){
  if(prevId){const o=gridElMap.get(prevId);if(o)o.classList.remove('active');}
  if(newId){
    const n=gridElMap.get(newId);
    if(n){n.classList.add('active');requestAnimationFrame(()=>n.scrollIntoView({block:'nearest',behavior:'smooth'}));}
  }
}

function pickChannel(id){playChannel(id);}

function playChannel(id){
  const ch=channels.find(c=>c.id===id);
  if(!ch) return;
  // FIX: Guard against clicking the same channel twice
  if(currentChannel&&currentChannel.id===ch.id&&!$ovErr.classList.contains('show')&&!$ovLoad.classList.contains('show')) return;
  const prevId=currentChannel?currentChannel.id:null;
  currentChannel=ch; currentEnc=ch.enc;
  _isDirectPlay=false; retryCount=0; clearAuto();
  document.title=ch.name+' – Xtra TV';
  $ovEmpty.classList.remove('show');
  $audioOver.classList.remove('show');
  $livePill.style.display='flex';
  $nowLogo.innerHTML=ch.logo
    ?`<img src="${xe(ch.logo)}" width="28" height="28" decoding="async" onerror="this.style.display='none';this.parentNode.textContent='📺'" style="width:100%;height:100%;object-fit:cover;border-radius:5px">`
    :'📺';
  $nowName.textContent=ch.name;
  $nowCat.textContent=ch.category||'Live TV';
  updateActiveHighlight(prevId,ch.id);
  const url=_dec(ch.enc);
  if(!url){showErr(true,'Invalid stream URL.','Bad URL');return;}
  loadStream(url,ch.name);
}

function loadStream(url,name){
  destroyStream();
  showLoad(true,name);
  // FIX: Build quality options with fragment instead of innerHTML+=
  $qualSel.innerHTML='';
  const autoOpt=document.createElement('option');
  autoOpt.value='-1'; autoOpt.textContent='Auto';
  $qualSel.appendChild(autoOpt);
  $resBadge.style.display='none';
  $audioOver.classList.remove('show');
  setTimeMode(false);

  let readyFired=false;

  _watchdogTimer=setTimeout(()=>{
    if(readyFired) return;
    showLoad(false);
    showErr(true,'No response from the stream server (8s). It may be geo-restricted or temporarily down.','Server not responding');
  },8000);

  const onReady=()=>{
    if(readyFired) return;
    readyFired=true;
    clearTimeout(_watchdogTimer);
    showLoad(false);safePlay();setPlayIcon(true);pw.classList.remove('paused');startProgressTimer();
    preloadNextChannel();
  };

  ensureHls(()=>{
    if(Hls.isSupported()){
      const h=new Hls({
        enableWorker:true,
        lowLatencyMode:false,
        maxBufferLength:8,
        maxMaxBufferLength:20,
        startLevel:-1,
        maxBufferSize:20*1000*1000,
        fragLoadingTimeOut:10000,
        manifestLoadingTimeOut:8000,
        levelLoadingTimeOut:8000,
        abrBandWidthFactor:0.9,
        abrBandWidthUpFactor:0.7,
        startFragPrefetch:true,
        backBufferLength:5,
        nudgeMaxRetry:5,
        nudgeOffset:0.3,
      });
      hlsObj=h;
      h.loadSource(url);
      h.attachMedia(video);

      h.on(Hls.Events.MANIFEST_PARSED,(e,d)=>{
        if(h!==hlsObj) return;
        onReady();
        if(d.levels&&d.levels.length>0){
          // FIX: Build quality options with DocumentFragment
          const frag=document.createDocumentFragment();
          const aOpt=document.createElement('option');
          aOpt.value='-1'; aOpt.textContent='Auto'; frag.appendChild(aOpt);
          let has4k=false;
          d.levels.forEach((lv,i)=>{
            const opt=document.createElement('option');
            opt.value=String(i);
            const lbl=lv.height?(lv.height>=2160?'4K':lv.height+'p'):'L'+(i+1);
            opt.textContent=lbl;
            if(lv.height>=2160) has4k=true;
            frag.appendChild(opt);
          });
          $qualSel.innerHTML='';
          $qualSel.appendChild(frag);
          $resBadge.style.display=has4k?'flex':'none';
        }
      });

      h.on(Hls.Events.LEVEL_SWITCHED,(e,d)=>{
        if(h!==hlsObj) return;
        const lv=h.levels[d.level];
        $resBadge.style.display=(lv&&lv.height>=2160)?'flex':'none';
      });

      h.on(Hls.Events.ERROR,(ev,d)=>{
        if(h!==hlsObj) return;
        if(!d.fatal) return;
        clearTimeout(_watchdogTimer);
        showLoad(false);
        if(d.type===Hls.ErrorTypes.NETWORK_ERROR&&retryCount<2){
          retryCount++;
          setTimeout(()=>{if(h&&h===hlsObj)h.startLoad();},2500);
          showErr(true,'Reconnecting… ('+retryCount+'/2)','Connection interrupted');
        } else {
          let t='Stream unavailable',b='The channel may be offline or geo-restricted.';
          if(!navigator.onLine){t='No internet';b='Check your connection.';}
          else if(d.details==='manifestLoadError'||d.details==='manifestLoadTimeOut'){t='Server unreachable';b='Stream server did not respond — it may block this site or your network.';}
          showErr(true,b,t);
          scheduleAutoRetry();
        }
      });

    } else if(video.canPlayType('application/vnd.apple.mpegurl')){
      // FIX: Named handlers for Safari native HLS — no dangling listeners
      const onMeta=()=>{ cleanSafari(); onReady(); };
      const onErr=()=>{ cleanSafari(); showLoad(false); showErr(true,'Stream failed.','Playback error'); scheduleAutoRetry(); };
      const cleanSafari=()=>{
        video.removeEventListener('loadedmetadata',onMeta);
        video.removeEventListener('error',onErr);
      };
      video.src=url;
      video.addEventListener('loadedmetadata',onMeta);
      video.addEventListener('error',onErr);
    } else {
      video.src=url;
      // FIX: Named handlers
      const onCan=()=>{ cleanFallback(); onReady(); };
      const onErrF=()=>{ cleanFallback(); showLoad(false); showErr(true,'Format not supported.','Unsupported'); };
      const cleanFallback=()=>{
        video.removeEventListener('canplay',onCan);
        video.removeEventListener('error',onErrF);
      };
      video.addEventListener('canplay',onCan);
      video.addEventListener('error',onErrF);
    }
  });
}

// ─── Auto-retry ───
function scheduleAutoRetry(){
  clearAuto();
  if(retryCount>=3){$errBody.textContent='Max retries reached. Tap Retry.';return;}
  let s=8;
  const tick=()=>{
    if(retryCount>=3){$errBody.textContent='Max retries reached.';clearAuto();return;}
    $errBody.textContent=`Retrying in ${s}s… (${retryCount+1}/3)`;
    if(s<=0){
      retryCount++;
      clearAuto();
      if(currentEnc&&typeof currentEnc==='string'){
        const url=_dec(currentEnc);
        if(url) loadStream(url,currentChannel?.name||'Stream');
      }
      return;
    }
    s--;
    autoRetryTimer=setTimeout(tick,1000);
  };
  tick();
}
function clearAuto(){clearTimeout(autoRetryTimer);autoRetryTimer=null;}

function retryStream(){
  clearAuto(); retryCount=0;
  if(_isDirectPlay){toast('⚠️ Re-enter via Network Stream');}
  else if(currentEnc&&typeof currentEnc==='string'){
    const url=_dec(currentEnc);
    if(url) loadStream(url,currentChannel?.name||'Stream');
    else showErr(true,'Invalid stream URL.','Bad URL');
  }
}

function changeQuality(l){if(hlsObj)hlsObj.currentLevel=parseInt(l);}

// ─── Progress (rAF loop) ───
function startProgressTimer(){
  if(_rafLoopRunning) return;
  _rafLoopRunning=true;
  let lastSec=-1;
  const loop=()=>{
    if(!_rafLoopRunning) return;
    const nowSec=Math.floor(Date.now()/1000);
    if(nowSec!==lastSec){
      lastSec=nowSec;
      if(_isVod&&video.duration&&isFinite(video.duration)){
        $progFill.style.width=(video.currentTime/video.duration*100)+'%';
        if(video.buffered.length) $progBuf.style.width=(video.buffered.end(video.buffered.length-1)/video.duration*100)+'%';
        $timeLabel.textContent=fmtTime(video.currentTime)+' / '+fmtTime(video.duration);
      } else if(!video.paused){
        const cur=parseFloat($progFill.style.width)||0;
        $progFill.style.width=(cur>=100?0:cur+0.05)+'%';
        $timeLabel.textContent='● LIVE';
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function stopProgressTimer(){
  _rafLoopRunning=false;
  if(_progressTimer){clearInterval(_progressTimer);_progressTimer=null;}
}

function setTimeMode(vod){
  _isVod=vod;
  $timeLabel.textContent=vod?'0:00 / 0:00':'● LIVE';
  $progFill.style.width='0%';
  $progBuf.style.width='0%';
}
function fmtTime(s){
  if(!isFinite(s)||s<0) return '0:00';
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.floor(s%60);
  return (h?h+':':'')+(h?String(m).padStart(2,'0'):m)+':'+String(ss).padStart(2,'0');
}

// ─── Seek bar ───
const $progBar=document.getElementById('progBar');
let _seekDragging=false;
function seekTo(clientX){
  if(!_isVod||!video.duration||!isFinite(video.duration)) return;
  const r=$progBar.getBoundingClientRect();
  video.currentTime=Math.max(0,Math.min(1,(clientX-r.left)/r.width))*video.duration;
}
$progBar.addEventListener('mousedown',e=>{_seekDragging=true;seekTo(e.clientX);e.preventDefault();});
document.addEventListener('mousemove',e=>{if(_seekDragging)seekTo(e.clientX);});
document.addEventListener('mouseup',()=>{_seekDragging=false;});
// FIX: Use passive listeners for touch events to prevent scroll jank
$progBar.addEventListener('touchstart',e=>{_seekDragging=true;seekTo(e.touches[0].clientX);},{passive:true});
document.addEventListener('touchmove',e=>{if(_seekDragging)seekTo(e.touches[0].clientX);},{passive:true});
document.addEventListener('touchend',()=>{_seekDragging=false;},{passive:true});

// ─── Quality select ───
$qualSel.addEventListener('change',function(){changeQuality(this.value);});

// ─── Speed popup ───
const speedBtn=document.getElementById('speedBtn');
const speedPopup=document.getElementById('speedPopup');
speedBtn.addEventListener('click',e=>{e.stopPropagation();speedPopup.classList.toggle('open');document.getElementById('fitPopup').classList.remove('open');});
speedPopup.querySelectorAll('.speed-opt').forEach(el=>{
  el.addEventListener('click',()=>{
    const sp=parseFloat(el.dataset.sp);
    video.playbackRate=sp; _curSpeed=sp;
    speedBtn.textContent=sp===1?'1×':sp+'×';
    speedPopup.querySelectorAll('.speed-opt').forEach(o=>o.classList.toggle('active',o===el));
    speedPopup.classList.remove('open');
    toast('⏩ '+sp+'×');
  });
});

// ─── Fit popup ───
const fitBtn=document.querySelector('.fit-btn');
const fitPopup=document.getElementById('fitPopup');
fitBtn.addEventListener('click',e=>{e.stopPropagation();fitPopup.classList.toggle('open');speedPopup.classList.remove('open');});
fitPopup.querySelectorAll('.fit-opt').forEach(el=>{
  el.addEventListener('click',()=>{
    const mode=el.dataset.fit;
    fitMode=mode;
    pw.classList.remove('fit-contain','fit-cover','fit-fill');
    pw.classList.add('fit-'+mode);
    fitPopup.querySelectorAll('.fit-opt').forEach(o=>o.classList.toggle('active',o===el));
    fitPopup.classList.remove('open');
    toast(({contain:'📐 Fit Screen',cover:'✂️ Crop',fill:'↔️ Stretch'}[mode])||'✅ Applied');
  });
});

document.addEventListener('click',()=>{
  speedPopup.classList.remove('open');
  fitPopup.classList.remove('open');
});

// ─── Playback controls ───
function togglePlay(){
  if(video.paused){
    video.play().then(()=>{setPlayIcon(true);pw.classList.remove('paused');}).catch(()=>{setPlayIcon(false);pw.classList.add('paused');});
  } else {
    video.pause();setPlayIcon(false);pw.classList.add('paused');
  }
}
function setPlayIcon(p){
  $btnPlay.innerHTML=p
    ?'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
    :'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
}
function toggleMute(){
  _muted=!_muted;
  video.muted=_muted;
  updateMuteIcon(_muted);
  toast(_muted?'🔇 Muted':'🔊 Unmuted');
}

// FIX: setVolume — update _userVolume so safePlay() remembers user preference
function setVolume(v){
  const vol=Math.max(0,Math.min(1,parseFloat(v)||0));
  _userVolume=vol;
  video.volume=vol;
  $volSlider.value=vol;
  if(vol===0&&!_muted){_muted=true;video.muted=true;updateMuteIcon(true);}
  else if(vol>0&&_muted){_muted=false;video.muted=false;updateMuteIcon(false);}
}

// ─── Fullscreen ───
function toggleFullscreen(){
  if(document.fullscreenElement||document.webkitFullscreenElement){
    (document.exitFullscreen||document.webkitExitFullscreen).call(document);
  } else {
    const req=pw.requestFullscreen||pw.webkitRequestFullscreen;
    if(req) req.call(pw).catch(()=>{});
    else if(video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  }
}
function updateFsIcon(){
  const inFs=!!(document.fullscreenElement||document.webkitFullscreenElement);
  document.getElementById('fsIcon').innerHTML=inFs
    ?'<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>'
    :'<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
}
document.addEventListener('fullscreenchange',updateFsIcon);
document.addEventListener('webkitfullscreenchange',updateFsIcon);

// ─── PiP ───
async function togglePip(){
  try{
    if(document.pictureInPictureElement){await document.exitPictureInPicture();toast('⬛ Exited PiP');}
    else{await video.requestPictureInPicture();toast('⧉ PiP mode');}
  }catch{toast('PiP not supported');}
}
document.getElementById('btnPip').addEventListener('click',togglePip);
video.addEventListener('enterpictureinpicture',()=>document.getElementById('btnPip').style.color='var(--accent2)');
video.addEventListener('leavepictureinpicture',()=>document.getElementById('btnPip').style.color='');

// ─── Prev / Next ───
function nextChannel(){
  if(!filtered_.length) return;
  if(!currentChannel){pickChannel(filtered_[0].id);return;}
  const i=filtered_.findIndex(c=>c.id===currentChannel.id);
  const next=i===-1?filtered_[0]:filtered_[Math.min(i+1,filtered_.length-1)];
  if(next&&next.id!==currentChannel.id){pickChannel(next.id);toast('⏭ '+next.name);}
}
function prevChannel(){
  if(!filtered_.length) return;
  if(!currentChannel){pickChannel(filtered_[filtered_.length-1].id);return;}
  const i=filtered_.findIndex(c=>c.id===currentChannel.id);
  const prev=i<=0?null:filtered_[i-1];
  if(prev){pickChannel(prev.id);toast('⏮ '+prev.name);}
}
document.getElementById('btnNext').addEventListener('click',nextChannel);
document.getElementById('btnPrev').addEventListener('click',prevChannel);

// ─── Video events ───
video.addEventListener('pause',()=>{setPlayIcon(false);pw.classList.add('paused');});
video.addEventListener('play', ()=>{setPlayIcon(true); pw.classList.remove('paused');});
video.addEventListener('waiting',()=>{
  if(currentChannel||_isDirectPlay) showLoad(true,currentChannel?.name||$nowName.textContent||'');
});
video.addEventListener('playing',()=>{
  showLoad(false);
  clearTimeout(_stalledTimer);
  // FIX: Only restore volume if not muted by user
  if(!_muted){video.volume=_userVolume;$volSlider.value=_userVolume;}
});
video.addEventListener('ended',()=>{setPlayIcon(false);pw.classList.add('paused');stopProgressTimer();});

// FIX: Click on video (desktop) — don't fire if clicking on controls
video.addEventListener('click',e=>{
  if(isMobile()) return;
  togglePlay();
});
video.addEventListener('dblclick',toggleFullscreen);

// ─── Stall recovery ───
video.addEventListener('stalled',()=>{
  if(_isDirectPlay) return;
  clearTimeout(_stalledTimer);
  _stalledTimer=setTimeout(()=>{
    if(hlsObj){try{hlsObj.startLoad();}catch(e){}}
    else if(currentEnc&&typeof currentEnc==='string'&&retryCount<3){
      retryCount++;
      const url=_dec(currentEnc);
      if(url) loadStream(url,currentChannel?.name||'Stream');
    }
  },6000);
});

// ─── Controls auto-hide (desktop) ───
pw.addEventListener('mousemove',()=>{
  if(!pw.classList.contains('show-ctrl')) pw.classList.add('show-ctrl');
  if(_moveThrottle) return;
  _moveThrottle=true;
  clearTimeout(_ctrlTimer);
  _ctrlTimer=setTimeout(()=>{if(!video.paused)pw.classList.remove('show-ctrl');},3000);
  setTimeout(()=>{_moveThrottle=false;},150);
},{passive:true});
pw.addEventListener('mouseleave',()=>{if(!video.paused) pw.classList.remove('show-ctrl');});

// ─── Mobile touch — single tap = toggle controls, double tap = fullscreen ───
// FIX: Use passive:true for touchstart (no preventDefault) to prevent scroll jank warning
// We distinguish tap vs control-touch by checking if target is inside #controls
let _tapTimer=null, _tapCount=0;
pw.addEventListener('touchstart',(e)=>{
  // If touch is on a control element, don't intercept
  const ctrlEl=document.getElementById('controls');
  if(ctrlEl&&ctrlEl.contains(e.target)) return;
  if(!pw.contains(e.target)) return;
  // FIX: Passive listener — no preventDefault; avoids browser warning & scroll jank
  _tapCount++;
  if(_tapCount===1){
    _tapTimer=setTimeout(()=>{
      _tapCount=0;
      const isVisible=pw.classList.contains('show-ctrl');
      if(isVisible){
        pw.classList.remove('show-ctrl');
      } else {
        pw.classList.add('show-ctrl');
        clearTimeout(_ctrlTimer);
        _ctrlTimer=setTimeout(()=>{if(!video.paused)pw.classList.remove('show-ctrl');},3000);
      }
    },230);
  } else if(_tapCount===2){
    clearTimeout(_tapTimer);
    _tapCount=0;
    toggleFullscreen();
  }
},{passive:true});

// ─── Resize handle (desktop only) ───
(()=>{
  const h=document.getElementById('resizeHandle');
  if(!h) return;
  let dragging=false,sy=0,sh=0,rafPending=false,pendingH=null;
  function startDrag(cy){dragging=true;sy=cy;sh=pw.offsetHeight;pw.style.aspectRatio='unset';h.classList.add('dragging');document.body.style.userSelect='none';}
  function moveDrag(cy){
    if(!dragging) return;
    pendingH=Math.max(120,Math.min(sh+(cy-sy),window.innerHeight*0.82));
    if(!rafPending){rafPending=true;requestAnimationFrame(()=>{pw.style.height=pendingH+'px';pw.style.maxHeight='none';rafPending=false;});}
  }
  function endDrag(){if(dragging){dragging=false;h.classList.remove('dragging');document.body.style.userSelect='';}}
  h.addEventListener('mousedown',e=>{startDrag(e.clientY);e.preventDefault();});
  document.addEventListener('mousemove',e=>moveDrag(e.clientY));
  document.addEventListener('mouseup',endDrag);
  h.addEventListener('touchstart',e=>{startDrag(e.touches[0].clientY);},{passive:true});
  document.addEventListener('touchmove',e=>{if(dragging){moveDrag(e.touches[0].clientY);e.preventDefault();}},{passive:false});
  document.addEventListener('touchend',endDrag,{passive:true});
})();

// ─── Keyboard shortcuts ───
document.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  try{
    switch(e.key){
      case ' ':case 'k':e.preventDefault();togglePlay();break;
      case 'm':case 'M':toggleMute();break;
      case 'f':case 'F':toggleFullscreen();break;
      case 'p':case 'P':togglePip();break;
      case 's':case 'S':e.stopPropagation();speedBtn.click();break;
      case 'ArrowRight':
        e.preventDefault();
        if(_isVod&&video.duration){video.currentTime=Math.min(video.currentTime+10,video.duration);toast('⏩ +10s');}
        else nextChannel();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if(_isVod&&video.duration){video.currentTime=Math.max(video.currentTime-10,0);toast('⏪ −10s');}
        else prevChannel();
        break;
      case 'ArrowUp':{e.preventDefault();const nv=Math.min(1,parseFloat($volSlider.value||0)+.1);setVolume(nv);toast('🔊 '+Math.round(nv*100)+'%');break;}
      case 'ArrowDown':{e.preventDefault();const nv=Math.max(0,parseFloat($volSlider.value||0)-.1);setVolume(nv);toast('🔉 '+Math.round(nv*100)+'%');break;}
      case '1':fitPopup.querySelector('[data-fit="contain"]').click();break;
      case '2':fitPopup.querySelector('[data-fit="cover"]').click();break;
      case '3':fitPopup.querySelector('[data-fit="fill"]').click();break;
    }
  }catch(err){console.warn('[XtraTV] Keyboard handler:',err);}
});

// ─── Mobile search overlay ───
(()=>{
  const btn=document.getElementById('mobSearchBtn');
  const overlay=document.getElementById('mobSearchOverlay');
  const inp=document.getElementById('mobSearchInput');
  const close=document.getElementById('mobSearchClose');
  if(!btn) return;
  btn.addEventListener('click',()=>{
    overlay.classList.add('open');
    setTimeout(()=>inp.focus(),80);
  });
  function closeMobSearch(){
    overlay.classList.remove('open');
    inp.blur();
  }
  close.addEventListener('click',closeMobSearch);
  inp.addEventListener('input',function(){
    clearTimeout(_searchDebounce);
    const val=this.value;
    _searchDebounce=setTimeout(()=>{searchQ=val.trim().toLowerCase();renderAll();},150);
  });
  inp.addEventListener('keydown',e=>{
    if(e.key==='Escape'||e.key==='Enter') closeMobSearch();
  });
})();

// ─── Search (debounced) ───
document.getElementById('searchInput').addEventListener('input',function(){
  clearTimeout(_searchDebounce);
  const val=this.value;
  _searchDebounce=setTimeout(()=>{searchQ=val.trim().toLowerCase();renderAll();},150);
});

// ─── Page visibility ───
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    if(!video.paused&&video.readyState<3){
      if(hlsObj){try{hlsObj.startLoad();}catch(e){}}
      else if(currentEnc&&typeof currentEnc==='string'){
        const url=_dec(currentEnc);
        if(url) loadStream(url,currentChannel?.name||'Stream');
      }
    }
    if(!_rafLoopRunning&&(currentChannel||_isDirectPlay)&&!video.paused) startProgressTimer();
  } else {
    _rafLoopRunning=false;
  }
});

// ─── Online/offline ───
window.addEventListener('offline',()=>toast('📡 No internet connection',3000));
window.addEventListener('online',()=>{
  toast('✅ Back online',2000);
  if(currentEnc&&!_isDirectPlay&&video.paused){
    setTimeout(()=>{
      if(navigator.onLine){
        const url=_dec(currentEnc);
        if(url) loadStream(url,currentChannel?.name||'Stream');
      }
    },1000);
  }
});

// ─── Init ───
ensureHls(()=>{});
fetchChannels();

window.addEventListener('beforeunload',()=>{
  stopProgressTimer();
  clearTimeout(_searchDebounce);clearTimeout(_tt);clearTimeout(_ctrlTimer);
  clearTimeout(_stalledTimer);clearTimeout(_watchdogTimer);clearAuto();
  destroyPreload();
  if(hlsObj){try{hlsObj.destroy();}catch(e){}}
});