// ─── CONFIG ───
const JSON_URL = 'https://cdn.jsdelivr.net/gh/bugsfreeweb/LiveTVCollector@main/LiveTV/Bangladesh/LiveTV.json';
const CACHE_KEY = 'xtra_tv_channels_v3';
const CACHE_TS_KEY = 'xtra_tv_cache_ts_v3';
const CACHE_TTL = 10 * 60 * 1000;
const VOL_KEY = 'xtra_tv_volume';
const LAST_CH_KEY = 'xtra_tv_last_channel';
const FIT_KEY = 'xtra_tv_fit';
const FAVS_KEY = 'xtra_tv_favs';
const HISTORY_KEY = 'xtra_tv_history';
const SORT_KEY = 'xtra_tv_sort';

const GROUP_ICONS = {
  'news':'📰','sports':'⚽','entertainment':'🎬',
  'music':'🎵','kids':'👶','movies':'🎥','religious':'🕌','islamic':'🕌',
  'documentary':'🎞️','business':'💼','tech':'💻','lifestyle':'🌿',
  'default':'📡'
};
const _GROUP_ICON_ENTRIES=Object.entries(GROUP_ICONS).filter(([k])=>k!=='default');
function getGroupIcon(n){
  if(!n) return GROUP_ICONS.default;
  const l=n.toLowerCase();
  for(const [k,v] of _GROUP_ICON_ENTRIES) if(l.includes(k)) return v;
  return GROUP_ICONS.default;
}

const _K=[0x4c,0x53,0x42,0x44,0x37,0x29,0x5a,0x71,0x1f,0x3e,0x88,0xa2,0x5c,0x17,0x63,0x4b];
function _enc(s){
  const b=new TextEncoder().encode(s);
  const x=new Uint8Array(b.length);
  for(let i=0;i<b.length;i++) x[i]=b[i]^_K[i%_K.length];
  // Use chunk approach to avoid stack overflow on large URLs with apply()
  let bin='';
  const CHUNK=8192;
  for(let i=0;i<x.length;i+=CHUNK) bin+=String.fromCharCode.apply(null,x.subarray(i,i+CHUNK));
  return btoa(bin).replace(/=/g,'').split('').reverse().join('');
}
function _dec(s){
  try{
    const arr=s.split('');arr.reverse();const r=arr.join('');
    const p=r+'='.repeat((4-r.length%4)%4);
    const bin=atob(p);
    const len=bin.length;
    const b=new Uint8Array(len);
    for(let i=0;i<len;i++) b[i]=bin.charCodeAt(i)^_K[i%_K.length];
    return new TextDecoder().decode(b);
  }catch(e){ return ''; }
}
function xe(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}

// Wrap _dec with a URL decode cache (LRU-lite: evict oldest entry when full)
const _decCached=(function(_decImpl){
  const _decCache=new Map();
  const MAX=400;
  return function(s){
    if(!s) return '';
    let r=_decCache.get(s);
    if(r!==undefined) return r;
    r=_decImpl(s);
    if(_decCache.size>=MAX){
      // Evict the oldest (first) entry
      _decCache.delete(_decCache.keys().next().value);
    }
    _decCache.set(s,r);
    return r;
  };
})(_dec);

// ─── State ───
let channels=[], filtered_=[], currentChannel=null, currentEnc=null,
    hlsObj=null, currentCat='all', searchQ='',
    retryCount=0, autoRetryTimer=null, _muted=false, _ctrlTimer=null,
    fitMode='contain', _curSpeed=1, _isVod=false, _isDirectPlay=false,
    _stalledTimer=null, _tt=null,
    _searchDebounce=null, _watchdogTimer=null,
    _rafLoopRunning=false, _userVolume=0.3,
    _preloadHls=null, _preloadTimer=null,
    _theaterMode=false, _userPaused=false, _endedTimer=null;
const gridElMap=new Map();
let channelsById=new Map();
function setChannels(chs){
  channels=chs;
  channelsById=new Map(chs.map(c=>[c.id,c]));
  _logoCache.clear();
}

// ─── Favourites ───
let _favs=new Set();
try{const f=JSON.parse(localStorage.getItem(FAVS_KEY)||'[]');if(Array.isArray(f))_favs=new Set(f);}catch(e){}
function isFav(uid){return _favs.has(uid);}
function toggleFav(ch){
  const uid=ch.uid;
  if(_favs.has(uid)){_favs.delete(uid);toast('☆ Removed from Favourites');}
  else{_favs.add(uid);toast('★ Added to Favourites');}
  try{localStorage.setItem(FAVS_KEY,JSON.stringify([..._favs]));}catch(e){}
  const card=gridElMap.get(ch.id)||$channelGrid.querySelector('[data-id="'+ch.id+'"]');
  if(card){
    let star=card.querySelector('.grid-fav-star');
    if(isFav(uid)){
      if(!star){star=document.createElement('div');star.className='grid-fav-star';star.textContent='★';card.appendChild(star);}
    } else {
      if(star) star.remove();
    }
  }
  if(currentCat==='__favs__'){
    renderAll();
  } else {
    _lastGroupRenderKey='';
    computeFiltered();
    renderGroupList(false);
  }
  _updateFavBtn();
}
let _favsMigrated=false;
function migrateFavs(chs){
  if(_favsMigrated||!_favs.size) return;
  _favsMigrated=true;
  const uidSet=new Set(chs.map(c=>c.uid));
  const byName=new Map();
  for(const c of chs){
    if(!byName.has(c.name)) byName.set(c.name,[]);
    byName.get(c.name).push(c);
  }
  let changed=false;
  const next=new Set();
  for(const entry of _favs){
    if(uidSet.has(entry)){ next.add(entry); continue; }
    const candidates=byName.get(entry);
    if(candidates&&candidates.length===1){ next.add(candidates[0].uid); changed=true; }
    else { next.add(entry); }
  }
  if(changed){
    _favs=next;
    try{localStorage.setItem(FAVS_KEY,JSON.stringify([..._favs]));}catch(e){}
  }
}
const $btnFav=document.getElementById('btnFav');
function _updateFavBtn(){
  if(!$btnFav) return;
  const isCurFav=currentChannel&&isFav(currentChannel.uid);
  $btnFav.title=isCurFav?'Remove from Favourites':'Add to Favourites';
  $btnFav.textContent=isCurFav?'★':'☆';
  $btnFav.style.color=isCurFav?'#fbbf24':'';
}

// ─── Sort ───
let _sortMode='default';
try{const s=localStorage.getItem(SORT_KEY);if(s&&['default','az','za'].includes(s))_sortMode=s;}catch(e){}

// ─── Watch History ───
const HISTORY_MAX=12;
let _history=[];
try{const h=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(Array.isArray(h))_history=h;}catch(e){}
function pushHistory(ch){
  _history=_history.filter(h=>h.uid!==ch.uid);
  _history.unshift({uid:ch.uid,name:ch.name,category:ch.category,logo:ch.logo});
  if(_history.length>HISTORY_MAX) _history=_history.slice(0,HISTORY_MAX);
  _histCacheLen=-1; // invalidate cache
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(_history));}catch(e){}
}
function clearHistory(){
  if(!_history.length) return;
  _history=[];
  _histCacheLen=-1; // invalidate cache
  try{localStorage.removeItem(HISTORY_KEY);}catch(e){}
  if(currentCat==='__history__') currentCat='all';
  renderAll(true);
  toast('🗑 Watch history cleared');
}

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
const $nowInfo    = document.querySelector('.now-info');
const $hdrCount   = document.getElementById('hdrCount');
const $gridTitle  = document.getElementById('gridTitle');
const $gridCount  = document.getElementById('gridCount');
const $clearHistoryBtn = document.getElementById('clearHistoryBtn');
const $channelGrid= document.getElementById('channelGrid');
const $volSlider  = document.getElementById('volSlider');
const $btnPlay    = document.getElementById('btnPlay');
const $muteIcon   = document.getElementById('muteIcon');
const $toast      = document.getElementById('toast');
const $groupList  = document.getElementById('groupList');
const $bufBadge   = document.getElementById('bufBadge');
let _isMobileCache=window.innerWidth<=700;
const isMobile=()=>_isMobileCache;
let _resizeRaf=false;
window.addEventListener('resize',()=>{
  if(_resizeRaf) return;
  _resizeRaf=true;
  requestAnimationFrame(()=>{_isMobileCache=window.innerWidth<=700;_resizeRaf=false;});
},{passive:true});

// Restore persisted settings
try{ const sv=parseFloat(localStorage.getItem(VOL_KEY)); if(!isNaN(sv)&&sv>=0&&sv<=1) _userVolume=sv; }catch(e){}
try{ const sf=localStorage.getItem(FIT_KEY); if(sf&&['contain','cover','fill'].includes(sf)){ fitMode=sf; pw.classList.remove('fit-contain','fit-cover','fit-fill'); pw.classList.add('fit-'+sf); } }catch(e){}
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

// ─── HLS.js loader (lazy, single load) ───
let _hlsLoading=false, _hlsQueue=[];
function ensureHls(cb){
  if(typeof Hls!=='undefined'){cb();return;}
  _hlsQueue.push(cb);
  if(_hlsLoading) return;
  _hlsLoading=true;
  const s=document.createElement('script');
  s.crossOrigin='anonymous';
  s.src='https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.6.13/hls.min.js';
  s.onload=()=>{_hlsLoading=false;_hlsQueue.forEach(fn=>fn());_hlsQueue=[];};
  s.onerror=()=>{_hlsLoading=false;_hlsQueue=[];console.warn('HLS.js load failed');};
  document.head.appendChild(s);
}

// ─── Next channel preload ───
let _preloadVideo=null;
function destroyPreload(){
  clearTimeout(_preloadTimer);
  if(_preloadHls){try{_preloadHls.destroy();}catch(e){} _preloadHls=null;}
  if(_preloadVideo){_preloadVideo.src='';_preloadVideo=null;}
}
function preloadNextChannel(){
  destroyPreload();
  if(!filtered_.length||!currentChannel) return;
  const idx=filtered_.findIndex(c=>c.id===currentChannel.id);
  if(idx===-1||idx>=filtered_.length-1) return;
  const next=filtered_[idx+1];
  if(!next||!next.enc) return;
  const snapChannel=currentChannel;
  _preloadTimer=setTimeout(()=>{
    if(currentChannel!==snapChannel) return;
    ensureHls(()=>{
      if(!Hls.isSupported()) return;
      if(currentChannel!==snapChannel) return;
      try{
        const url=_decCached(next.enc);
        if(!url) return;
        _preloadHls=new Hls({maxBufferLength:4,startLevel:-1,fragLoadingTimeOut:8000,manifestLoadingTimeOut:6000});
        _preloadHls.on(Hls.Events.ERROR,(_e,d)=>{
          if(d.fatal&&_preloadHls){try{_preloadHls.destroy();}catch(ex){} _preloadHls=null;}
        });
        _preloadHls.loadSource(url);
        _preloadVideo=document.createElement('video');
        _preloadVideo.muted=true;
        _preloadVideo.preload='none';
        _preloadHls.attachMedia(_preloadVideo);
        setTimeout(()=>{if(_preloadHls){try{_preloadHls.destroy();}catch(e){} _preloadHls=null;} if(_preloadVideo){_preloadVideo.src='';_preloadVideo=null;}},30000);
      }catch(e){_preloadHls=null;_preloadVideo=null;}
    });
  },3000);
}

// ─── Toast ───
function toast(msg,dur=1600){
  clearTimeout(_tt);
  $toast.textContent=msg;
  $toast.classList.remove('show');
  $toast.classList.add('reset');
  requestAnimationFrame(()=>{
    $toast.classList.remove('reset');
    $toast.classList.add('show');
    _tt=setTimeout(()=>$toast.classList.remove('show'),dur);
  });
}

// ─── safePlay ───
function safePlay(){
  video.volume=_userVolume;
  $volSlider.value=_userVolume;
  // Start muted to bypass autoplay policy, unmute after successful play
  video.muted=true;
  const cc=currentChannel, ce=currentEnc;
  const p=video.play();
  if(p&&typeof p.then==='function'){
    p.then(()=>{
      setTimeout(()=>{
        if(currentChannel!==cc||currentEnc!==ce) return;
        // Only unmute if user hasn't explicitly muted
        if(!_muted){
          video.muted=false;
          video.volume=_userVolume; $volSlider.value=_userVolume;
          updateMuteIcon(false);
        }
      },200);
    }).catch(err=>{
      // Only suppress autoplay-policy errors; re-flag anything else
      if(err&&err.name==='NotAllowedError'){
        _muted=true; video.muted=true;
        video.volume=_userVolume; $volSlider.value=_userVolume;
        updateMuteIcon(true);
        toast('🔇 Tap 🔊 to unmute',2500);
      } else if(err&&err.name!=='AbortError'){
        console.warn('[XtraTV] play() error:',err);
      }
    });
  } else {
    // play() returned undefined (old browsers) — assume success
    setTimeout(()=>{
      if(currentChannel!==cc||currentEnc!==ce) return;
      if(!_muted){
        video.muted=false;
        video.volume=_userVolume; $volSlider.value=_userVolume;
        updateMuteIcon(false);
      }
    },200);
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
  clearInterval(_loadStatusTimer); _loadStatusTimer=null; // stop any stale load-status cycle
  destroyPreload();
  const h=hlsObj; hlsObj=null;
  if(h){try{h.destroy();}catch(e){}}
  try{video.pause();video.removeAttribute('src');video.load();}catch(e){}
  // Reset direct-play state AFTER destroying HLS to keep values for error recovery
  _isDirectPlay=false; _directPlayUrl=''; _directPlayName=''; _directPlayIsAudio=false;
  $audioOver.classList.remove('show');
  $bufBadge.classList.remove('show');
  showLoad(false); showErr(false);
}

const _loadStatuses=['Connecting to stream…','Fetching manifest…','Buffering frames…','Almost there…'];
let _loadStatusTimer=null, _loadStatusIdx=0;

function _startLoadStatusCycle(){
  clearInterval(_loadStatusTimer);
  _loadStatusIdx=0;
  const $s=document.getElementById('loadStatus');
  const $p=document.getElementById('loadProgBar');
  if($s){$s.style.opacity='1';$s.style.transition='';$s.textContent=_loadStatuses[0];}
  if($p){$p.classList.remove('done');$p.style.animation='none';requestAnimationFrame(()=>{$p.style.animation='';});}
  _loadStatusTimer=setInterval(()=>{
    _loadStatusIdx=(_loadStatusIdx+1)%_loadStatuses.length;
    if($s){
      $s.style.transition='opacity .25s ease';
      $s.style.opacity='0';
      setTimeout(()=>{
        $s.textContent=_loadStatuses[_loadStatusIdx];
        $s.style.opacity='1';
      },260);
    }
  },2200);
}
function _stopLoadStatusCycle(success){
  clearInterval(_loadStatusTimer); _loadStatusTimer=null;
  const $s=document.getElementById('loadStatus');
  const $p=document.getElementById('loadProgBar');
  if(success){
    if($s) $s.textContent='Ready!';
    if($p){$p.classList.add('done');}
  } else {
    if($s){$s.style.opacity='';$s.textContent='';}
    if($p) $p.classList.remove('done');
  }
}

function showLoad(on,name){
  $ovLoad.classList.toggle('show',!!on);
  const $n=document.getElementById('loadNm');
  if(on){
    if($n) $n.textContent=name||'Loading…';
    _startLoadStatusCycle();
  } else {
    const success=!$ovErr.classList.contains('show');
    _stopLoadStatusCycle(success);
  }
}
function showErr(on,body,title){
  $ovErr.classList.toggle('show',!!on);
  if(on){
    if(body)  $errBody.textContent=body;
    if(title) $errTitle.textContent=title;
    const icon=$ovErr.querySelector('.err-icon');
    if(icon){icon.classList.remove('shake');requestAnimationFrame(()=>icon.classList.add('shake'));}
  } else {
    $errTitle.textContent='Stream unavailable';
    $errBody.textContent='The channel may be offline.';
  }
}

// ─── URL / Network Stream Modal ───
const urlBackdrop=document.getElementById('urlModalBackdrop');
function openUrlModal(){
  urlBackdrop.classList.add('open');
  setTimeout(()=>document.getElementById('urlInput').focus(),80);
}
function closeUrlModal(){urlBackdrop.classList.remove('open');}
urlBackdrop.addEventListener('click',e=>{if(e.target===urlBackdrop)closeUrlModal();});
document.getElementById('umCancel').addEventListener('click',closeUrlModal);
document.getElementById('umPlay').addEventListener('click',playFromUrlModal);
document.getElementById('urlInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();playFromUrlModal();}});
document.getElementById('urlTitleInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();playFromUrlModal();}});

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

let _directPlayUrl='', _directPlayName='', _directPlayIsAudio=false;

function playDirect(url,name,icon,cat,isAudio=false){
  if(!url||typeof url!=='string'||!url.trim()){toast('⚠️ Invalid URL');return;}
  url=url.trim();
  const prevId=currentChannel?currentChannel.id:null;
  currentChannel=null; currentEnc=null; retryCount=0; clearAuto();
  _isDirectPlay=true; _userPaused=false;
  _directPlayUrl=url; _directPlayName=name; _directPlayIsAudio=isAudio;
  resetSpeed();
  document.title=name+' – Xtra TV';
  $ovEmpty.classList.remove('show');
  $livePill.style.display='none';
  $nowLogo.textContent=icon||'🎬';
  $nowName.textContent=name;
  $nowCat.textContent=cat||'Stream';
  updateActiveHighlight(prevId,null);
  loadStreamDirect(url,name,isAudio);
}

function loadStreamDirect(url,name,isAudio){
  destroyStream();
  _setLoadLogo(null); // direct stream has no logo
  showLoad(true,name);
  $qualSel.innerHTML='<option value="-1">Auto</option>';
  $resBadge.style.display='none';
  setTimeMode(false);
  $audioOver.classList.toggle('show',isAudio);
  $audioTitle.textContent=name;

  let readyFired=false;
  _watchdogTimer=setTimeout(()=>{
    if(readyFired) return;
    showLoad(false);
    showErr(true,'No response from this URL (8s). It may require a specific Referer, be geo-restricted, or temporarily down.','Server not responding');
  },8000);

  const onReady=()=>{
    if(readyFired) return; readyFired=true;
    clearTimeout(_watchdogTimer);
    showLoad(false);safePlay();setPlayIcon(true);pw.classList.remove('paused');startProgressTimer();
  };
  const onFail=(reason)=>{
    clearTimeout(_watchdogTimer);
    showLoad(false);
    showErr(true,reason||'Cannot play this URL.','Unsupported format');
  };

  const isHls=/\.m3u8?(\?|$)/i.test(url);
  if(isHls){
    ensureHls(()=>{
      if(Hls.isSupported()){
        const h=new Hls({lowLatencyMode:false,maxBufferLength:8,maxMaxBufferLength:20,startLevel:-1});
        hlsObj=h;
        h.loadSource(url); h.attachMedia(video);
        h.on(Hls.Events.MANIFEST_PARSED,()=>{
          if(h!==hlsObj) return;
          onReady();
          if(h.levels&&h.levels.length>1){
            const frag=document.createDocumentFragment();
            const autoOpt=document.createElement('option');
            autoOpt.value='-1'; autoOpt.textContent='Auto'; frag.appendChild(autoOpt);
            h.levels.forEach((lv,i)=>{
              const opt=document.createElement('option');
              opt.value=String(i);
              opt.textContent=lv.height?(lv.height>=2160?'4K':lv.height+'p'):'L'+(i+1);
              frag.appendChild(opt);
            });
            $qualSel.innerHTML=''; $qualSel.appendChild(frag);
          }
        });
        h.on(Hls.Events.ERROR,(e,d)=>{
          if(h!==hlsObj) return;
          if(d.fatal) onFail('Stream failed. Check the URL and try again.');
        });
      } else if(video.canPlayType('application/vnd.apple.mpegurl')){
        const onMeta=()=>{ cleanNative(); onReady(); };
        const onErr=()=>{ cleanNative(); onFail('Stream failed on this device.'); };
        const cleanNative=()=>{ video.removeEventListener('loadedmetadata',onMeta); video.removeEventListener('error',onErr); };
        video.src=url;
        video.addEventListener('loadedmetadata',onMeta);
        video.addEventListener('error',onErr);
      } else {
        onFail('HLS not supported in this browser.');
      }
    });
    return;
  }
  const onMeta2=()=>{ cleanDirect(); onReady(); if(video.duration&&isFinite(video.duration)) setTimeMode(true); };
  const onErr2=()=>{ cleanDirect(); onFail('Cannot play this URL.'); };
  const cleanDirect=()=>{ video.removeEventListener('loadedmetadata',onMeta2); video.removeEventListener('error',onErr2); };
  video.src=url;
  video.addEventListener('loadedmetadata',onMeta2);
  video.addEventListener('error',onErr2);
}

// ─── JSON fetch & cache ───
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

function _uid(name,category,url){
  const s=name+'|'+category+'|'+url;
  let h=5381;
  for(let i=0;i<s.length;i++) h=((h*33)^s.charCodeAt(i))>>>0;
  return 'u'+h.toString(36);
}
function processChannels(raw){
  return raw.filter(c=>c.url&&c.name).map(c=>{
    const uid=_uid(c.name,c.category,c.url);
    const obj={
      id:uid,uid:uid,
      name:c.name,enc:_enc(c.url),category:c.category,logo:c.logo
    };
    obj._nameLow=c.name.toLowerCase();
    obj._catLow=(c.category||'').toLowerCase();
    return obj;
  });
}

let _lastRestoreKey='', _restorePending=false;
function applyChannels(chs){
  if(!chs||!chs.length) return false;
  setChannels(chs);
  migrateFavs(chs);
  $hdrCount.textContent=channels.length+' Channels';
  if(document.pictureInPictureEnabled) document.getElementById('btnPip').style.display='flex';
  renderAll();
  // Dismiss page splash screen
  window._splashReady=true;
  if(typeof window._splashDismiss==='function') window._splashDismiss(channels.length+' channels loaded ✓');
  else if(typeof window._splashTryDismiss==='function') window._splashTryDismiss();
  try{
    const last=JSON.parse(localStorage.getItem(LAST_CH_KEY)||'null');
    if(last&&last.name&&!currentChannel&&!_restorePending){
      const restoreKey=last.uid||(last.name+'|'+(last.category||''));
      if(_lastRestoreKey!==restoreKey){
        const match=last.uid
          ?channels.find(c=>c.uid===last.uid)
          :channels.find(c=>c.name===last.name&&c.category===last.category);
        if(match){
          _lastRestoreKey=restoreKey;
          _restorePending=true;
          setTimeout(()=>{_restorePending=false;if(!currentChannel)pickChannel(match.id);},200);
        }
      }
    }
  }catch(e){_restorePending=false;}
  return true;
}

function showGridSkeleton(count){
  const frag=document.createDocumentFragment();
  for(let i=0;i<count;i++){
    const el=document.createElement('div');
    el.className='sk-ch';
    const logo=document.createElement('div'); logo.className='sk-ch-logo';
    const n1=document.createElement('div'); n1.className='sk-ch-name';
    const n2=document.createElement('div'); n2.className='sk-ch-name2';
    el.appendChild(logo); el.appendChild(n1); el.appendChild(n2);
    frag.appendChild(el);
  }
  $channelGrid.innerHTML=''; $channelGrid.appendChild(frag);
  $gridTitle.textContent='Loading…'; $gridCount.textContent='';
}

async function fetchChannels(){
  try{
    const cached=localStorage.getItem(CACHE_KEY);
    const cachedTs=parseInt(localStorage.getItem(CACHE_TS_KEY)||'0',10);
    if(cached&&cachedTs&&(Date.now()-cachedTs)<CACHE_TTL){
      const parsed=JSON.parse(cached);
      if(parsed&&parsed.length){ applyChannels(parsed); _bgRefresh(); return; }
    }
  }catch(e){}
  $groupList.innerHTML='<div style="padding:6px;width:100%"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>';
  showGridSkeleton(18);
  await _fetchAndRender(true);
}

let _bgRefreshAbort=null;
async function _bgRefresh(){
  try{
    const ts=parseInt(localStorage.getItem(CACHE_TS_KEY)||'0',10);
    if(ts&&(Date.now()-ts)<CACHE_TTL) return; // respect same TTL as cache
  }catch(e){}
  if(_bgRefreshAbort){try{_bgRefreshAbort.abort();}catch(e){}}
  _bgRefreshAbort=new AbortController();
  try{
    const res=await fetch(JSON_URL,{signal:_bgRefreshAbort.signal,cache:'no-store'});
    if(!res.ok) return;
    const text=await res.text();
    if(text.trim().startsWith('<')) return;
    let data;
    try{data=JSON.parse(text);}catch(e){return;}
    const raw=parseJSON(data);
    const chs=processChannels(raw);
    if(!chs.length) return;
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(chs));localStorage.setItem(CACHE_TS_KEY,String(Date.now()));}catch(e){}
    const prevUid=currentChannel?currentChannel.uid:null;
    if(prevUid){
      const match=chs.find(c=>c.uid===prevUid);
      if(match){ currentChannel=match; currentEnc=match.enc; }
    }
    setChannels(chs);
    migrateFavs(chs);
    $hdrCount.textContent=channels.length+' Channels';
    renderAll();
  }catch(e){
    if(e&&e.name==='AbortError') return;
  }
}

let _fetchAbort=null;
async function _fetchAndRender(showError){
  if(_fetchAbort){try{_fetchAbort.abort();}catch(e){}}
  _fetchAbort=new AbortController();
  const signal=_fetchAbort.signal;
  try{
    const res=await fetch(JSON_URL,{signal,priority:'high'});
    if(!res.ok) throw {type:'network',status:res.status};
    const text=await res.text();
    if(text.trim().startsWith('<')) throw {type:'notjson'};
    let data;
    try{data=JSON.parse(text);}catch(pe){throw{type:'json',detail:pe.message};}
    const raw=parseJSON(data);
    const chs=processChannels(raw);
    if(!chs.length) throw {type:'empty'};
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(chs));localStorage.setItem(CACHE_TS_KEY,String(Date.now()));}catch(e){}
    applyChannels(chs);
  }catch(e){
    if(e&&e.name==='AbortError') return;
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
    $channelGrid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:30px 20px;color:var(--muted);font-size:11px">'+xe(title)+'</div>';
    $gridTitle.textContent='Channels'; $gridCount.textContent='';
    window._splashReady=true;
    if(typeof window._splashDismiss==='function') window._splashDismiss();
  }
}

// ─── Render ───
function renderAll(scrollSidebar=false){_lastGroupRenderKey='';computeFiltered();renderGroupList(scrollSidebar);renderGrid();}

let _histUidSet=new Set(), _histCacheLen=-1;
function _getHistUidSet(){
  if(_history.length!==_histCacheLen){
    _histUidSet=new Set(_history.map(h=>h.uid));
    _histCacheLen=_history.length;
  }
  return _histUidSet;
}

function computeFiltered(){
  const histUidSet=_getHistUidSet();
  const counts={all:0,__favs__:0,__history__:0};
  const catCounts={};
  filtered_=[];
  // Cache lowercase search to avoid repeated calls in hot loop
  const q=searchQ; // already lowercase
  const isSpecialCat=currentCat==='all'||currentCat==='__favs__'||currentCat==='__history__';
  const currentCatLow=isSpecialCat?'':currentCat.toLowerCase();
  const searchSrc=q
    ?channels.filter(ch=>(ch._nameLow||ch.name.toLowerCase()).includes(q)||(ch._catLow||(ch.category||'').toLowerCase()).includes(q))
    :channels;

  for(const ch of searchSrc){
    counts.all++;
    const c=ch.category||'';
    if(c) catCounts[c]=(catCounts[c]||0)+1;
    if(isFav(ch.uid)) counts.__favs__++;
    if(histUidSet.has(ch.uid)) counts.__history__++;

    let cOk;
    if(currentCat==='all') cOk=true;
    else if(currentCat==='__favs__') cOk=isFav(ch.uid);
    else if(currentCat==='__history__') cOk=histUidSet.has(ch.uid);
    else cOk=(ch._catLow||(ch.category||'').toLowerCase())===currentCatLow;
    if(cOk) filtered_.push(ch);
  }

  if(currentCat==='__history__'&&!searchQ){
    const histIdx=new Map(_history.map((h,i)=>[h.uid,i]));
    filtered_.sort((a,b)=>(histIdx.get(a.uid)??999)-(histIdx.get(b.uid)??999));
  } else {
    if(_sortMode==='az') filtered_.sort((a,b)=>a._nameLow<b._nameLow?-1:a._nameLow>b._nameLow?1:0);
    else if(_sortMode==='za') filtered_.sort((a,b)=>b._nameLow<a._nameLow?-1:b._nameLow>a._nameLow?1:0);
  }
  // Fallback: if search returns nothing in current cat, show all matches
  if(!filtered_.length&&currentCat!=='all'&&searchQ){
    const fallback=searchSrc.slice();
    if(fallback.length){filtered_=fallback;currentCat='all';}
  }
  const catLabel=currentCat==='all'?'All Channels':currentCat==='__favs__'?'★ Favourites':currentCat==='__history__'?'🕐 History':currentCat;
  $gridTitle.textContent=catLabel;
  $gridCount.textContent=filtered_.length+' Channels';
  if($clearHistoryBtn) $clearHistoryBtn.style.display=(currentCat==='__history__'&&_history.length>0)?'inline-block':'none';
  // Store merged counts for renderGroupList
  _lastCounts={...counts,...catCounts};
}

let _lastCounts={all:0,__favs__:0,__history__:0};

function buildCounts(){
  return _lastCounts;
}

let _lastGroupRenderKey='';
function renderGroupList(scrollToActive=false){
  const cats=[...new Set(channels.map(c=>c.category).filter(Boolean))].sort();
  const counts=buildCounts();

  // Build a compact key to detect if re-render is actually needed
  // Use sorted fav UIDs so toggle is correctly detected
  const favsKey=_favs.size>0?[..._favs].sort().join(','):'∅';
  const fKey=`${currentCat}|${favsKey}|${_history.length}|${searchQ}|${cats.join(',')}|${_sortMode}`;
  const needsRebuild=fKey!==_lastGroupRenderKey;
  _lastGroupRenderKey=fKey;

  if(!needsRebuild&&$groupList.children.length>0){
    // Just update active state without rebuilding
    $groupList.querySelectorAll('.group-item').forEach(el=>{
      const cat=el.dataset.cat;
      const isActive=currentCat===cat;
      if(isActive!==el.classList.contains('active')){
        el.classList.toggle('active',isActive);
      }
      // Update badge counts
      const badge=el.querySelector('.group-badge');
      if(badge){
        const c=cat==='all'?counts.all:cat==='__favs__'?counts.__favs__:cat==='__history__'?counts.__history__:(counts[cat]||0);
        if(badge.textContent!==String(c)) badge.textContent=c;
      }
    });
    if(scrollToActive){
      const active=$groupList.querySelector('.group-item.active');
      if(active) active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    }
    return;
  }

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
  if(counts.__favs__>0) makeGroupItem('__favs__','★','Favourites',counts.__favs__);
  if(counts.__history__>0) makeGroupItem('__history__','🕐','History',counts.__history__);
  for(const c of cats){
    const cnt=counts[c]||0;
    if(searchQ&&cnt===0) continue;
    makeGroupItem(c,getGroupIcon(c),c,cnt);
  }
  const prevScrollLeft=$groupList.scrollLeft;
  const prevScrollTop=$groupList.scrollTop;
  $groupList.innerHTML=''; $groupList.appendChild(frag);
  // Defer scroll restore so browser has time to lay out new content
  requestAnimationFrame(()=>{
    $groupList.scrollLeft=prevScrollLeft;
    $groupList.scrollTop=prevScrollTop;
    if(scrollToActive){
      const active=$groupList.querySelector('.group-item.active');
      if(active) active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    }
  });
}

function filterCat(c){if(currentCat===c)return;currentCat=c;computeFiltered();renderGroupList(true);renderGrid();}

const _logoCache=new Map();
const LOGO_CACHE_MAX=500;
function logoHTML(ch,size){
  if(!ch.logo) return '📺';
  let html=_logoCache.get(ch.id);
  if(!html){
    // onerror: hide broken img and show emoji fallback in parent
    html=`<img data-src="${xe(ch.logo)}" class="lazy" width="${size}" height="${size}" decoding="async" alt="" loading="lazy" fetchpriority="low" onerror="this.onerror=null;this.style.display='none';this.parentNode.textContent='📺';">`;
    if(_logoCache.size>=LOGO_CACHE_MAX){_logoCache.delete(_logoCache.keys().next().value);}
    _logoCache.set(ch.id,html);
  }
  return html;
}

let _imgObserver=null;
function getImgObserver(){
  if(_imgObserver) return _imgObserver;
  _imgObserver=new IntersectionObserver((entries)=>{
    for(const entry of entries){
      if(!entry.isIntersecting) continue;
      const img=entry.target;
      const src=img.dataset.src;
      if(src){
        img.src=src;
        delete img.dataset.src;
        if(img.complete&&img.naturalWidth>0){
          img.classList.add('loaded');
        } else {
          img.onload=()=>{img.classList.add('loaded');img.onload=null;};
        }
      }
      _imgObserver.unobserve(img);
    }
  },{rootMargin:'200px',threshold:0});
  return _imgObserver;
}
function observeLazyImages(container){
  const obs=getImgObserver();
  container.querySelectorAll('img.lazy[data-src]').forEach(img=>{
    if(img.complete&&img.naturalWidth>0){
      img.src=img.dataset.src; delete img.dataset.src; img.classList.add('loaded');
    } else {
      obs.observe(img);
    }
  });
}

const RENDER_CHUNK=60;
let _renderGen=0;
function renderGrid(){
  gridElMap.clear();
  if(_imgObserver) _imgObserver.disconnect();
  const gen=++_renderGen;
  if(!filtered_.length){
    $channelGrid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);font-size:11px">No channels found</div>';
    return;
  }
  const firstBatch=filtered_.slice(0,RENDER_CHUNK);
  const rest=filtered_.slice(RENDER_CHUNK);
  const frag=document.createDocumentFragment();
  for(const ch of firstBatch){const el=_makeChannelCard(ch,true);gridElMap.set(ch.id,el);frag.appendChild(el);}
  $channelGrid.innerHTML=''; $channelGrid.appendChild(frag);
  observeLazyImages($channelGrid);
  if(currentChannel){
    const activeEl=gridElMap.get(currentChannel.id);
    if(activeEl) requestAnimationFrame(()=>activeEl.scrollIntoView({block:'nearest',behavior:'smooth'}));
  }
  if(rest.length){
    let i=0;
    const IDLE_CHUNK=20;
    function renderChunk(deadline){
      if(gen!==_renderGen) return;
      const chunkFrag=document.createDocumentFragment();
      const chunkEls=[];
      let processed=0;
      while(i<rest.length&&(processed===0||processed<IDLE_CHUNK&&(deadline?deadline.timeRemaining()>1:true))){
        if(gen!==_renderGen) return;
        const ch=rest[i++]; processed++;
        const el=_makeChannelCard(ch,false); // no animation for idle-loaded cards
        gridElMap.set(ch.id,el);
        chunkFrag.appendChild(el);
        chunkEls.push(el);
      }
      $channelGrid.appendChild(chunkFrag);
      const obs=getImgObserver();
      for(let j=0;j<chunkEls.length;j++){
        chunkEls[j].querySelectorAll('img.lazy[data-src]').forEach(img=>{
          if(img.complete&&img.naturalWidth>0){img.src=img.dataset.src;delete img.dataset.src;img.classList.add('loaded');}
          else obs.observe(img);
        });
      }
      if(i<rest.length){
        if(typeof requestIdleCallback==='function') requestIdleCallback(renderChunk,{timeout:400});
        else setTimeout(()=>renderChunk(null),16);
      }
    }
    if(typeof requestIdleCallback==='function') requestIdleCallback(renderChunk,{timeout:400});
    else setTimeout(()=>renderChunk(null),16);
  }
}
function _makeChannelCard(ch,animate=true){
  const el=document.createElement('div');
  el.className='grid-ch'+(animate?' card-animate':'')+(currentChannel&&currentChannel.id===ch.id?' active':'');
  el.dataset.id=ch.id;
  // Logo wrapper
  const logoDiv=document.createElement('div');
  logoDiv.className='grid-logo';
  logoDiv.innerHTML=logoHTML(ch,34); // logoHTML returns cached img string
  el.appendChild(logoDiv);
  // Fav star
  if(isFav(ch.uid)){
    const star=document.createElement('div');
    star.className='grid-fav-star';
    star.textContent='★';
    el.appendChild(star);
  }
  // Name
  const nameDiv=document.createElement('div');
  nameDiv.className='grid-name';
  nameDiv.textContent=ch.name||'';
  el.appendChild(nameDiv);
  el.addEventListener('animationend',()=>el.classList.remove('card-animate'),{once:true});
  return el;
}

function _chFromCardEl(el){if(!el||!el.dataset.id)return null;return channelsById.get(el.dataset.id)||null;}
$channelGrid.addEventListener('click',e=>{const card=e.target.closest('.grid-ch');if(card)pickChannel(card.dataset.id);});
$channelGrid.addEventListener('contextmenu',e=>{
  const card=e.target.closest('.grid-ch');
  if(!card) return;
  e.preventDefault();
  if(card._lpFired){card._lpFired=false;return;}
  const ch=_chFromCardEl(card);
  if(ch) toggleFav(ch);
});
$channelGrid.addEventListener('touchstart',e=>{
  const card=e.target.closest('.grid-ch');
  if(!card) return;
  card._lpFired=false;
  clearTimeout(card._lpTimer);
  card._lpTimer=setTimeout(()=>{card._lpFired=true;const ch=_chFromCardEl(card);if(ch)toggleFav(ch);},600);
},{passive:true});
$channelGrid.addEventListener('touchend',e=>{
  const card=e.target.closest('.grid-ch');
  if(!card) return;
  clearTimeout(card._lpTimer);
  if(card._lpFired){card._lpFired=false;e.preventDefault();}
},{passive:false});
$channelGrid.addEventListener('touchmove',e=>{
  const card=e.target.closest('.grid-ch');
  if(!card) return;
  clearTimeout(card._lpTimer);
  card._lpFired=false;
},{passive:true});

function updateActiveHighlight(prevId,newId){
  if(prevId){const o=gridElMap.get(prevId)||$channelGrid.querySelector('[data-id="'+prevId+'"]');if(o)o.classList.remove('active');}
  if(newId){const n=gridElMap.get(newId)||$channelGrid.querySelector('[data-id="'+newId+'"]');if(n){n.classList.add('active');requestAnimationFrame(()=>n.scrollIntoView({block:'nearest',behavior:'smooth'}));}}
}

function pickChannel(id){playChannel(id);}
function playChannel(id){
  const ch=channelsById.get(id);
  if(!ch) return;
  if(currentChannel&&currentChannel.id===ch.id&&!$ovErr.classList.contains('show')&&!$ovLoad.classList.contains('show')){
    // Same channel: if paused by user, resume; otherwise do nothing
    if(video.paused&&!_userPaused){safePlay();setPlayIcon(true);pw.classList.remove('paused');}
    else if(video.paused&&_userPaused){togglePlay();}
    return;
  }
  const prevId=currentChannel?currentChannel.id:null;
  currentChannel=ch; currentEnc=ch.enc;
  _isDirectPlay=false; retryCount=0; clearAuto(); _userPaused=false; clearTimeout(_endedTimer); _endedTimer=null;
  resetSpeed();
  document.title=ch.name+' – Xtra TV';
  try{localStorage.setItem(LAST_CH_KEY,JSON.stringify({uid:ch.uid,name:ch.name,category:ch.category}));}catch(e){}
  pushHistory(ch);
  $ovEmpty.classList.remove('show');
  $audioOver.classList.remove('show');
  $livePill.style.display='flex';
  $nowLogo.classList.add('switching');
  if($nowInfo){$nowInfo.classList.add('switching');$nowInfo.classList.remove('incoming');}
  setTimeout(()=>{
    $nowLogo.classList.remove('switching');
    $nowLogo.innerHTML=ch.logo
      ?`<img src="${xe(ch.logo)}" width="28" height="28" decoding="async" onerror="this.onerror=null;this.style.display='none';this.parentNode.textContent='📺'" style="width:100%;height:100%;object-fit:cover;border-radius:5px">`
      :'📺';
    if($nowInfo){
      $nowInfo.classList.remove('switching');
      requestAnimationFrame(()=>{
        $nowInfo.classList.add('incoming');
        $nowInfo.addEventListener('animationend',()=>$nowInfo.classList.remove('incoming'),{once:true});
      });
    }
  },160);
  $nowName.textContent=ch.name;
  $nowCat.textContent=ch.category||'Live TV';
  updateActiveHighlight(prevId,ch.id);
  _updateFavBtn();
  const url=_decCached(ch.enc);
  if(!url){showErr(true,'Invalid stream URL.','Bad URL');return;}
  loadStream(url,ch.name);
}

// Cache loading center logo element
const $loadCenterLogo=document.querySelector('.load-center-logo');
function _setLoadLogo(logo){
  if(!$loadCenterLogo) return;
  if(logo){
    $loadCenterLogo.innerHTML=`<img src="${xe(logo)}" width="28" height="28" decoding="async" onerror="this.onerror=null;this.replaceWith(document.createTextNode('📺'))" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    $loadCenterLogo.textContent='📺';
  }
}

function loadStream(url,name){
  destroyStream();
  _setLoadLogo(currentChannel?.logo||null);
  showLoad(true,name);
  $qualSel.innerHTML='<option value="-1">Auto</option>';
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
    if(readyFired) return; readyFired=true;
    clearTimeout(_watchdogTimer);
    showLoad(false);safePlay();setPlayIcon(true);pw.classList.remove('paused');startProgressTimer();
    preloadNextChannel();
  };

  ensureHls(()=>{
    if(Hls.isSupported()){
      const h=new Hls({
        enableWorker:true,
        lowLatencyMode:false,
        maxBufferLength:16,
        maxMaxBufferLength:40,
        startLevel:-1,
        maxBufferSize:(isMobile()?20:40)*1000*1000,
        fragLoadingTimeOut:12000,
        manifestLoadingTimeOut:10000,
        levelLoadingTimeOut:10000,
        abrBandWidthFactor:0.9,
        abrBandWidthUpFactor:0.7,
        startFragPrefetch:true,
        backBufferLength:10,
        nudgeMaxRetry:6,
        nudgeOffset:0.5,
        maxFragLookUpTolerance:0.25,
        progressive:false,
        testBandwidth:true,
        maxStarvationDelay:4,
        highBufferWatchdogPeriod:3,
      });
      hlsObj=h;
      h.loadSource(url); h.attachMedia(video);

      h.on(Hls.Events.MANIFEST_PARSED,(e,d)=>{
        if(h!==hlsObj) return;
        onReady();
        if(d.levels&&d.levels.length>0){
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
          // Replace all options atomically (avoids double-Auto on 0-level streams)
          $qualSel.innerHTML='';
          $qualSel.appendChild(frag);
          $resBadge.style.display=has4k?'flex':'none';
        }
      });

      h.on(Hls.Events.LEVEL_SWITCHED,(e,d)=>{
        if(h!==hlsObj) return;
        const lv=h.levels[d.level];
        $resBadge.style.display=(lv&&lv.height>=2160)?'flex':'none';
        // Show current level in buffer badge
        if(lv&&lv.height){
          $bufBadge.textContent=lv.height>=2160?'4K':(lv.height+'p');
          $bufBadge.classList.add('show');
          clearTimeout($bufBadge._hideTimer);
          $bufBadge._hideTimer=setTimeout(()=>$bufBadge.classList.remove('show'),3000);
        }
      });

      h.on(Hls.Events.ERROR,(ev,d)=>{
        if(h!==hlsObj) return;
        if(!d.fatal) return;
        clearTimeout(_watchdogTimer);
        showLoad(false);
        if(d.type===Hls.ErrorTypes.NETWORK_ERROR&&retryCount<2&&!readyFired){
          retryCount++;
          setTimeout(()=>{if(h&&h===hlsObj)h.startLoad();},2500);
          showErr(true,'Reconnecting… ('+retryCount+'/2)','Connection interrupted');
        } else if(d.type===Hls.ErrorTypes.MEDIA_ERROR&&!h._mediaErrorRecovered){
          h._mediaErrorRecovered=true;
          try{h.recoverMediaError();}catch(e){}
          showErr(true,'Recovering playback…','Decode error');
        } else {
          let t='Stream unavailable',b='The channel may be offline or geo-restricted.';
          if(!navigator.onLine){t='No internet';b='Check your connection.';}
          else if(d.details==='manifestLoadError'||d.details==='manifestLoadTimeOut'){t='Server unreachable';b='Stream server did not respond — it may block this site or your network.';}
          showErr(true,b,t);
          scheduleAutoRetry();
        }
      });

    } else if(video.canPlayType('application/vnd.apple.mpegurl')){
      const onMeta=()=>{ cleanSafari(); onReady(); };
      const onErr=()=>{ cleanSafari(); clearTimeout(_watchdogTimer); showLoad(false); showErr(true,'Stream failed.','Playback error'); scheduleAutoRetry(); };
      const cleanSafari=()=>{ video.removeEventListener('loadedmetadata',onMeta); video.removeEventListener('error',onErr); };
      video.src=url;
      video.addEventListener('loadedmetadata',onMeta);
      video.addEventListener('error',onErr);
    } else {
      video.src=url;
      const onCan=()=>{ cleanFallback(); onReady(); };
      const onErrF=()=>{ cleanFallback(); clearTimeout(_watchdogTimer); showLoad(false); showErr(true,'Format not supported.','Unsupported'); scheduleAutoRetry(); };
      const cleanFallback=()=>{ video.removeEventListener('canplay',onCan); video.removeEventListener('error',onErrF); };
      video.addEventListener('canplay',onCan);
      video.addEventListener('error',onErrF);
    }
  });
}

// ─── Auto-retry ───
let _retryGen=0; // incremented on each new stream load to invalidate stale retry ticks
function scheduleAutoRetry(){
  if(_isDirectPlay) return;
  clearAuto();
  if(retryCount>=3){$errBody.textContent='Max retries reached. Tap Retry.';return;}
  const gen=++_retryGen;
  let s=7;
  const tick=()=>{
    if(gen!==_retryGen){return;} // stale — a new stream was loaded
    if(retryCount>=3){$errBody.textContent='Max retries reached.';clearAuto();return;}
    $errBody.textContent=`Retrying in ${s}s… (${retryCount+1}/3)`;
    if(s<=0){
      retryCount++;clearAuto();
      if(currentEnc&&typeof currentEnc==='string'){const url=_decCached(currentEnc);if(url)loadStream(url,currentChannel?.name||'Stream');}
      return;
    }
    s--;
    autoRetryTimer=setTimeout(tick,1000);
  };
  tick();
}
function clearAuto(){clearTimeout(autoRetryTimer);autoRetryTimer=null;_retryGen++;}
function retryStream(){
  clearAuto(); retryCount=0;
  if(_isDirectPlay){
    if(_directPlayUrl) loadStreamDirect(_directPlayUrl,_directPlayName||$nowName.textContent,_directPlayIsAudio);
    else openUrlModal();
  } else if(currentEnc&&typeof currentEnc==='string'){
    const url=_decCached(currentEnc);
    if(url) loadStream(url,currentChannel?.name||'Stream');
    else showErr(true,'Invalid stream URL.','Bad URL');
  }
}
function changeQuality(l){if(hlsObj)hlsObj.currentLevel=parseInt(l);}

// ─── Progress rAF loop ───
function startProgressTimer(){
  if(_rafLoopRunning) return;
  _rafLoopRunning=true;
  let lastLiveUpdate=-1;
  const loop=()=>{
    if(!_rafLoopRunning) return;
    // Pause rAF updates when video is paused to save battery
    if(video.paused&&!_isVod){requestAnimationFrame(loop);return;}
    if(_isVod&&video.duration&&isFinite(video.duration)){
      const fill=video.currentTime/video.duration*100;
      if(Math.abs(fill-_rafLastFill)>0.02){_rafLastFill=fill;$progFill.style.transform='scaleX('+(fill/100)+')';}
      if(video.buffered.length){
        const buf=video.buffered.end(video.buffered.length-1)/video.duration*100;
        if(Math.abs(buf-_rafLastBuf)>0.1){_rafLastBuf=buf;$progBuf.style.transform='scaleX('+buf/100+')';}
      }
      const label=fmtTime(video.currentTime)+' / '+fmtTime(video.duration);
      if(label!==_rafLastLabel){_rafLastLabel=label;$timeLabel.textContent=label;}
    } else {
      // LIVE mode: only update once per second — skip spinning at 60fps
      const nowSec=Math.floor(Date.now()/1000);
      if(nowSec!==lastLiveUpdate){
        lastLiveUpdate=nowSec;
        _rafLastFill=(_rafLastFill>=98?0:_rafLastFill+0.5);
        $progFill.style.transform='scaleX('+(_rafLastFill/100)+')';
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function stopProgressTimer(){
  _rafLoopRunning=false;
}
function setTimeMode(vod){
  _isVod=vod;
  $timeLabel.textContent=vod?'0:00 / 0:00':'● LIVE';
  $progFill.style.transform='scaleX(0)'; $progBuf.style.transform='scaleX(0)';
  // Reset cached values so new stream starts fresh
  _rafLastLabel=''; _rafLastFill=-1; _rafLastBuf=-1;
}
let _rafLastLabel='', _rafLastFill=-1, _rafLastBuf=-1;
function fmtTime(s){
  if(!isFinite(s)||s<0) return '0:00';
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.floor(s%60);
  if(h) return h+':'+String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0');
  return m+':'+String(ss).padStart(2,'0');
}

// ─── Seek bar ───
const $progBar=document.getElementById('progBar');
let _seekDragging=false;
function seekTo(clientX){
  if(!_isVod||!video.duration||!isFinite(video.duration)) return;
  const r=$progBar.getBoundingClientRect();
  video.currentTime=Math.max(0,Math.min(1,(clientX-r.left)/r.width))*video.duration;
}
function _onSeekMouseMove(e){seekTo(e.clientX);}
function _onSeekMouseUp(){
  _seekDragging=false;
  document.removeEventListener('mousemove',_onSeekMouseMove);
  document.removeEventListener('mouseup',_onSeekMouseUp);
}
function _onSeekTouchMove(e){if(_seekDragging){e.preventDefault();seekTo(e.touches[0].clientX);}}
function _onSeekTouchEnd(){
  _seekDragging=false;
  document.removeEventListener('touchmove',_onSeekTouchMove);
  document.removeEventListener('touchend',_onSeekTouchEnd);
}
$progBar.addEventListener('mousedown',e=>{
  _seekDragging=true; seekTo(e.clientX); e.preventDefault();
  document.addEventListener('mousemove',_onSeekMouseMove);
  document.addEventListener('mouseup',_onSeekMouseUp);
});
$progBar.addEventListener('touchstart',e=>{
  _seekDragging=true; seekTo(e.touches[0].clientX);
  e.preventDefault(); // prevent scroll while seeking
  document.addEventListener('touchmove',_onSeekTouchMove,{passive:false});
  document.addEventListener('touchend',_onSeekTouchEnd,{passive:true});},{passive:false});

// ─── Quality select ───
$qualSel.addEventListener('change',function(){changeQuality(this.value);});

// ─── Speed popup ───
const speedBtn=document.getElementById('speedBtn');
const speedPopup=document.getElementById('speedPopup');
speedBtn.addEventListener('click',e=>{e.stopPropagation();speedPopup.classList.toggle('open');document.getElementById('fitPopup').classList.remove('open');if(window._closeSortPopup)window._closeSortPopup();});
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
function resetSpeed(){
  if(_curSpeed===1) return;
  video.playbackRate=1; _curSpeed=1;
  speedBtn.textContent='1×';
  speedPopup.querySelectorAll('.speed-opt').forEach(o=>o.classList.toggle('active',o.dataset.sp==='1'));
}

// ─── Fit popup ───
const fitBtn=document.querySelector('.fit-btn');
const fitPopup=document.getElementById('fitPopup');
fitBtn.addEventListener('click',e=>{e.stopPropagation();fitPopup.classList.toggle('open');speedPopup.classList.remove('open');if(window._closeSortPopup)window._closeSortPopup();});
fitPopup.querySelectorAll('.fit-opt').forEach(o=>o.classList.toggle('active',o.dataset.fit===fitMode));
fitPopup.querySelectorAll('.fit-opt').forEach(el=>{
  el.addEventListener('click',()=>{
    const mode=el.dataset.fit; fitMode=mode;
    pw.classList.remove('fit-contain','fit-cover','fit-fill');
    pw.classList.add('fit-'+mode);
    fitPopup.querySelectorAll('.fit-opt').forEach(o=>o.classList.toggle('active',o===el));
    fitPopup.classList.remove('open');
    try{localStorage.setItem(FIT_KEY,mode);}catch(e){}
    toast(({contain:'📐 Fit Screen',cover:'✂️ Crop',fill:'↔️ Stretch'}[mode])||'✅ Applied');
  });
});

document.addEventListener('click',()=>{speedPopup.classList.remove('open');fitPopup.classList.remove('open');if(window._closeSortPopup)window._closeSortPopup();});

// ─── Playback controls ───
function togglePlay(){
  if(!currentChannel&&!_isDirectPlay){openUrlModal();return;}
  if(video.paused){
    _userPaused=false;
    video.play().then(()=>{setPlayIcon(true);pw.classList.remove('paused');}).catch(err=>{
      if(err&&err.name!=='AbortError'){setPlayIcon(false);pw.classList.add('paused');}
    });
  } else {
    _userPaused=true;
    video.pause();setPlayIcon(false);pw.classList.add('paused');
  }
}
function setPlayIcon(p){
  $btnPlay.innerHTML=p
    ?'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
    :'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
}
function toggleMute(){
  _muted=!_muted; video.muted=_muted;
  updateMuteIcon(_muted);
  toast(_muted?'🔇 Muted':'🔊 Unmuted');
}
let _volSaveTimer=null;
$volSlider.addEventListener('animationend',()=>$volSlider.classList.remove('vol-anim'),{passive:true});

function setVolume(v){
  const vol=Math.max(0,Math.min(1,parseFloat(v)||0));
  _userVolume=vol; video.volume=vol; $volSlider.value=vol;
  // Restart CSS animation by removing then re-adding class
  $volSlider.classList.remove('vol-anim');
  // Trigger reflow to allow animation restart
  void $volSlider.offsetWidth;
  $volSlider.classList.add('vol-anim');
  clearTimeout(_volSaveTimer);
  _volSaveTimer=setTimeout(()=>{try{localStorage.setItem(VOL_KEY,String(vol));}catch(e){}},300);
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

// ─── Theater mode ───
function toggleTheater(){
  _theaterMode=!_theaterMode;
  document.getElementById('playerArea').classList.toggle('theater-mode',_theaterMode);
  document.getElementById('theaterBtn').classList.toggle('active',_theaterMode);
  toast(_theaterMode?'⬛ Theater mode on':'⬜ Theater mode off');
}

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

// ─── Sleep Timer ───
let _sleepTimer=null, _sleepEndTime=0, _sleepCountdownTimer=null;
const $sleepIndicator=document.getElementById('sleepIndicator');
const $sleepCountdown=document.getElementById('sleepCountdown');

function openSleepModal(){
  const backdrop=document.getElementById('sleepModalBackdrop');
  backdrop.classList.add('open');
  const clearBtn=document.getElementById('sleepClear');
  if(clearBtn) clearBtn.classList.toggle('hidden',!_sleepTimer);
  document.getElementById('sleepCustomInput').value='';
  // If timer active, show remaining time in custom input as hint
  if(_sleepTimer){
    const rem=Math.max(0,_sleepEndTime-Date.now());
    const remMin=Math.ceil(rem/60000);
    document.getElementById('sleepCustomInput').placeholder='Remaining: ~'+remMin+' min';
  } else {
    document.getElementById('sleepCustomInput').placeholder='Custom minutes…';
  }
}
function closeSleepModal(){
  document.getElementById('sleepModalBackdrop').classList.remove('open');
}

function _applyHighlight(mins){
  document.querySelectorAll('.sleep-opt').forEach(o=>o.classList.toggle('active',parseInt(o.dataset.min)===mins));
}

function setSleepTimer(mins){
  if(isNaN(mins)||mins<1){toast('⚠️ Enter a valid number (min: 1)');return;}
  clearSleepTimer();
  _sleepEndTime=Date.now()+mins*60*1000;
  _sleepTimer=setTimeout(()=>{
    _userPaused=true;
    video.pause(); setPlayIcon(false); pw.classList.add('paused');
    clearSleepIndicator();
    toast('😴 Sleep timer — video paused',3000);
  },mins*60*1000);
  _applyHighlight(mins);
  // show countdown in header
  $sleepIndicator.classList.add('show');
  const _sleepClearBtn=document.getElementById('sleepClear');
  if(_sleepClearBtn) _sleepClearBtn.classList.remove('hidden');
  const tick=()=>{
    const rem=Math.max(0,_sleepEndTime-Date.now());
    if(rem<=0){clearSleepIndicator();return;}
    const m=Math.floor(rem/60000), s=Math.floor((rem%60000)/1000);
    $sleepCountdown.textContent=m+':'+(s<10?'0':'')+s;
    _sleepCountdownTimer=setTimeout(tick,500);
  };
  tick();
  closeSleepModal();
  toast('😴 Sleep in '+mins+' min'+(mins===1?'':'s'));
}
function clearSleepTimer(){
  clearTimeout(_sleepTimer); _sleepTimer=null;
  clearSleepIndicator();
  document.querySelectorAll('.sleep-opt').forEach(o=>o.classList.remove('active'));
}
function clearSleepIndicator(){
  clearTimeout(_sleepCountdownTimer); _sleepCountdownTimer=null;
  $sleepIndicator.classList.remove('show');
  $sleepCountdown.textContent='';
}

document.getElementById('sleepGrid').addEventListener('click',e=>{
  const btn=e.target.closest('.sleep-opt');
  if(!btn) return;
  setSleepTimer(parseInt(btn.dataset.min));
});
document.getElementById('sleepCustomSet').addEventListener('click',()=>{
  const v=parseInt(document.getElementById('sleepCustomInput').value);
  setSleepTimer(v);
});
document.getElementById('sleepCustomInput').addEventListener('keydown',e=>{
  if(e.key==='Enter') document.getElementById('sleepCustomSet').click();
});
document.getElementById('sleepCancel').addEventListener('click',closeSleepModal);
document.getElementById('sleepClear').addEventListener('click',()=>{
  clearSleepTimer(); closeSleepModal(); toast('😴 Sleep timer cancelled');
});
document.getElementById('sleepModalBackdrop').addEventListener('click',e=>{
  if(e.target===document.getElementById('sleepModalBackdrop')) closeSleepModal();
});
$sleepIndicator.addEventListener('click',()=>{
  if(_sleepTimer){clearSleepTimer();toast('😴 Sleep timer cancelled');}
  else openSleepModal();
});

// ─── Prev / Next ───
function nextChannel(){
  if(!filtered_.length) return;
  if(!currentChannel){pickChannel(filtered_[0].id);return;}
  const i=filtered_.findIndex(c=>c.id===currentChannel.id);
  const next=filtered_[(i===-1||i>=filtered_.length-1)?0:i+1];
  if(next){pickChannel(next.id);toast('⏭ '+next.name);}
}
function prevChannel(){
  if(!filtered_.length) return;
  if(!currentChannel){pickChannel(filtered_[filtered_.length-1].id);return;}
  const i=filtered_.findIndex(c=>c.id===currentChannel.id);
  const prev=filtered_[i<=0?filtered_.length-1:i-1];
  if(prev){pickChannel(prev.id);toast('⏮ '+prev.name);}
}
document.getElementById('btnNext').addEventListener('click',nextChannel);
document.getElementById('btnPrev').addEventListener('click',prevChannel);

// ─── Video events ───
video.addEventListener('pause',()=>{
  if(!video.src&&!hlsObj) return;
  if(!currentChannel&&!_isDirectPlay) return;
  setPlayIcon(false); pw.classList.add('paused');
  stopProgressTimer();
});
video.addEventListener('play',()=>{
  setPlayIcon(true); pw.classList.remove('paused');
  if(!_rafLoopRunning&&(currentChannel||_isDirectPlay)) startProgressTimer();
});
video.addEventListener('waiting',()=>{
  if(currentChannel||_isDirectPlay){
    const nm=currentChannel?.name||$nowName.textContent||'';
    showLoad(true,nm||undefined);
  }
});
video.addEventListener('playing',()=>{
  showLoad(false); showErr(false);
  clearTimeout(_stalledTimer);
  if(!_muted){video.volume=_userVolume;$volSlider.value=_userVolume;}
});
video.addEventListener('ended',()=>{
  setPlayIcon(false); pw.classList.add('paused'); stopProgressTimer();
  if(!_isVod&&!_isDirectPlay&&currentChannel){clearTimeout(_endedTimer);_endedTimer=setTimeout(nextChannel,1500);}
});
video.addEventListener('click',e=>{if(!isMobile()&&!e._fromTouch)togglePlay();});
video.addEventListener('dblclick',e=>{if(!isMobile())toggleFullscreen();});

// ─── Stall recovery ───
video.addEventListener('stalled',()=>{
  clearTimeout(_stalledTimer);
  _stalledTimer=setTimeout(()=>{
    if(_isDirectPlay){
      const src=video.currentSrc||video.src;
      if(src&&src!==window.location.href&&retryCount<2){
        retryCount++;
        const nm=$nowName.textContent||'Stream';
        const isAudio=/\.(mp3|aac|flac|wav|ogg|m4a|opus)(\?|$)/i.test(src);
        loadStreamDirect(src,nm,isAudio);
      }
      return;
    }
    if(!hlsObj&&!currentEnc) return;
    if(hlsObj){
      try{
        hlsObj.startLoad();
      }catch(e){}
    } else if(currentEnc&&typeof currentEnc==='string'&&retryCount<3){
      retryCount++;
      const url=_decCached(currentEnc);
      if(url) loadStream(url,currentChannel?.name||'Stream');
      else scheduleAutoRetry();
    } else if(retryCount>=3){
      showErr(true,'Stream keeps stalling. Check your connection.','Connection issues');
    }
  },6000);
});

// ─── Controls auto-hide (desktop) ───
pw.addEventListener('mousemove',()=>{
  if(!pw.classList.contains('show-ctrl')) pw.classList.add('show-ctrl');
  clearTimeout(_ctrlTimer);
  _ctrlTimer=setTimeout(()=>{if(!video.paused)pw.classList.remove('show-ctrl');},3000);
},{passive:true});
pw.addEventListener('mouseleave',()=>{if(!video.paused){clearTimeout(_ctrlTimer);pw.classList.remove('show-ctrl');}});

// ─── Mobile touch — single tap = toggle controls, double tap = fullscreen ───
let _tapTimer=null, _tapCount=0;
pw.addEventListener('touchstart',(e)=>{
  const ctrlEl=document.getElementById('controls');
  if(ctrlEl&&ctrlEl.contains(e.target)) return;
  if(!pw.contains(e.target)) return;
  _tapCount++;
  if(_tapCount===1){
    _tapTimer=setTimeout(()=>{
      _tapCount=0;
      const isVisible=pw.classList.contains('show-ctrl');
      if(isVisible){pw.classList.remove('show-ctrl');}
      else{pw.classList.add('show-ctrl');clearTimeout(_ctrlTimer);_ctrlTimer=setTimeout(()=>{if(!video.paused)pw.classList.remove('show-ctrl');},3000);}
    },230);
  } else if(_tapCount===2){
    clearTimeout(_tapTimer); _tapCount=0; toggleFullscreen();
  } else {
    clearTimeout(_tapTimer); _tapCount=0;
  }
},{passive:true});

// ─── Resize handle (desktop only) ───
(()=>{
  const h=document.getElementById('resizeHandle');
  if(!h) return;
  let dragging=false,sy=0,sh=0,rafPending=false,pendingH=null,wasResized=false;
  function startDrag(cy){dragging=true;sy=cy;sh=pw.offsetHeight;pw.style.aspectRatio='unset';h.classList.add('dragging');document.body.style.userSelect='none';wasResized=true;}
  function moveDrag(cy){
    if(!dragging) return;
    pendingH=Math.max(120,Math.min(sh+(cy-sy),window.innerHeight*0.82));
    if(!rafPending){rafPending=true;requestAnimationFrame(()=>{pw.style.height=pendingH+'px';pw.style.maxHeight='none';rafPending=false;});}
  }
  function endDrag(){if(dragging){dragging=false;h.classList.remove('dragging');document.body.style.userSelect='';}}
  h.addEventListener('mousedown',e=>{startDrag(e.clientY);e.preventDefault();});
  document.addEventListener('mousemove',e=>moveDrag(e.clientY),{passive:true});
  document.addEventListener('mouseup',endDrag);
  h.addEventListener('touchstart',e=>{startDrag(e.touches[0].clientY);},{passive:true});
  document.addEventListener('touchmove',e=>{if(dragging){moveDrag(e.touches[0].clientY);e.preventDefault();}},{passive:false});
  document.addEventListener('touchend',endDrag,{passive:true});
  function clearManualResize(){
    if(!wasResized) return;
    pw.style.height=''; pw.style.maxHeight=''; pw.style.aspectRatio=''; wasResized=false;
  }
  let _wasMobile=_isMobileCache;
  window.addEventListener('resize',()=>{const nowMobile=_isMobileCache;if(nowMobile!==_wasMobile){_wasMobile=nowMobile;clearManualResize();}},{passive:true});
  document.addEventListener('fullscreenchange',clearManualResize);
  document.addEventListener('webkitfullscreenchange',clearManualResize);
})();

// ─── Keyboard shortcut help modal ───
(()=>{
  const backdrop=document.getElementById('kbModalBackdrop');
  const closeBtn=document.getElementById('kbClose');
  const helpBtn=document.getElementById('kbHelpBtn');
  window.openKbModal=()=>backdrop.classList.add('open');
  window.closeKbModal=()=>backdrop.classList.remove('open');
  closeBtn.addEventListener('click',closeKbModal);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeKbModal();});
  if(helpBtn) helpBtn.addEventListener('click',openKbModal);
})();

// ─── Keyboard shortcuts ───
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    closeUrlModal(); closeKbModal(); closeSleepModal();
    const aboutBackdrop=document.getElementById('aboutModalBackdrop');
    if(aboutBackdrop) aboutBackdrop.classList.remove('open');
    speedPopup.classList.remove('open'); fitPopup.classList.remove('open');
    if(window._closeSortPopup) window._closeSortPopup();
    if(document.activeElement&&typeof document.activeElement.blur==='function'&&['INPUT','TEXTAREA'].includes(document.activeElement.tagName))
      document.activeElement.blur();
    return;
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  try{
    switch(e.key){
      case ' ':case 'k':e.preventDefault();togglePlay();break;
      case 'm':case 'M':toggleMute();break;
      case 'f':case 'F':toggleFullscreen();break;
      case 'p':case 'P':togglePip();break;
      case 's':case 'S':e.stopPropagation();speedBtn.click();break;
      case 't':case 'T':toggleTheater();break;
      case 'z':case 'Z':openSleepModal();break;
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
      case 'ArrowUp':{e.preventDefault();const nv=Math.min(1,Math.round((parseFloat($volSlider.value||0)+.1)*10)/10);setVolume(nv);toast('🔊 '+Math.round(nv*100)+'%');break;}
      case 'ArrowDown':{e.preventDefault();const nv=Math.max(0,Math.round((parseFloat($volSlider.value||0)-.1)*10)/10);setVolume(nv);toast('🔉 '+Math.round(nv*100)+'%');break;}
      case '1':fitPopup.querySelector('[data-fit="contain"]').click();break;
      case '2':fitPopup.querySelector('[data-fit="cover"]').click();break;
      case '3':fitPopup.querySelector('[data-fit="fill"]').click();break;
      case '?':openKbModal();break;
      case 'F2':if(currentChannel)toggleFav(currentChannel);break;
    }
  }catch(err){console.warn('[XtraTV] Keyboard handler:',err);}
});

// ─── Clear History button ───
if($clearHistoryBtn) $clearHistoryBtn.addEventListener('click',clearHistory);

// ─── Sort dropdown popup ───
(()=>{
  const btn=document.getElementById('sortBtn');
  const popup=document.getElementById('sortPopup');
  if(!btn||!popup) return;

  function updateSortUI(){
    const labels={default:'⇅ Sort',az:'A→Z ↑',za:'Z→A ↓'};
    // Replace entire button content safely to avoid duplicate text nodes
    btn.textContent='';
    const textNode=document.createTextNode(labels[_sortMode]+' ');
    const chevron=document.createElement('span');
    chevron.className='sort-chevron';
    chevron.textContent='▼';
    btn.appendChild(textNode);
    btn.appendChild(chevron);
    btn.classList.toggle('active',_sortMode!=='default');
    popup.querySelectorAll('.sort-opt').forEach(o=>{
      o.classList.toggle('active',o.dataset.sort===_sortMode);
    });
  }

  function openPopup(){
    popup.classList.add('open');
    btn.classList.add('popup-open');
    // Close other popups
    speedPopup.classList.remove('open');
    fitPopup.classList.remove('open');
  }
  function closePopup(){
    popup.classList.remove('open');
    btn.classList.remove('popup-open');
  }

  updateSortUI();

  btn.addEventListener('click',(e)=>{
    e.stopPropagation();
    popup.classList.contains('open')?closePopup():openPopup();
  });

  popup.addEventListener('click',(e)=>{
    e.stopPropagation();
    const opt=e.target.closest('.sort-opt');
    if(!opt) return;
    const newSort=opt.dataset.sort;
    closePopup();
    if(newSort===_sortMode) return;
    _sortMode=newSort;
    try{localStorage.setItem(SORT_KEY,_sortMode);}catch(ex){}
    updateSortUI();
    renderAll();
    toast(newSort==='az'?'↑ Sorted A→Z':newSort==='za'?'↓ Sorted Z→A':'⇅ Default order');
  });

  window._closeSortPopup=closePopup;
})();

// ─── Desktop search (debounced) ───
const $searchClear=document.getElementById('searchClear');
document.getElementById('searchInput').addEventListener('input',function(){
  clearTimeout(_searchDebounce);
  const val=this.value;
  const mobInp=document.getElementById('mobSearchInput');
  if(mobInp) mobInp.value=val;
  $searchClear.classList.toggle('visible',val.length>0);
  _searchDebounce=setTimeout(()=>{searchQ=val.trim().toLowerCase();renderAll();},150);
});
$searchClear.addEventListener('click',()=>{
  const inp=document.getElementById('searchInput');
  inp.value='';
  const mobInp=document.getElementById('mobSearchInput');
  if(mobInp) mobInp.value='';
  $searchClear.classList.remove('visible');
  searchQ=''; renderAll(); inp.focus();
});

// ─── Page visibility ───
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    // Only reload stream if truly broken — don't destroy a healthy HLS session
    if(!video.paused&&video.readyState<3){
      if(hlsObj){
        try{hlsObj.startLoad();}catch(e){}
      } else if(_isDirectPlay&&_directPlayUrl){
        loadStreamDirect(_directPlayUrl,_directPlayName||$nowName.textContent,_directPlayIsAudio);
      } else if(!_isDirectPlay&&currentEnc&&typeof currentEnc==='string'){
        const url=_decCached(currentEnc);
        if(url) loadStream(url,currentChannel?.name||'Stream');
      }
    }
    if(!_rafLoopRunning&&(currentChannel||_isDirectPlay)&&!video.paused) startProgressTimer();
    if(_sleepTimer&&!_sleepCountdownTimer){
      const tick=()=>{
        const rem=Math.max(0,_sleepEndTime-Date.now());
        if(rem<=0){clearSleepIndicator();return;}
        const m=Math.floor(rem/60000), s=Math.floor((rem%60000)/1000);
        $sleepCountdown.textContent=m+':'+(s<10?'0':'')+s;
        _sleepCountdownTimer=setTimeout(tick,500);
      };
      tick();
    }
  } else {
    stopProgressTimer();
    clearTimeout(_sleepCountdownTimer); _sleepCountdownTimer=null;
  }
});

// ─── Online/offline ───
window.addEventListener('offline',()=>toast('📡 No internet connection',3000));
window.addEventListener('online',()=>{
  toast('✅ Back online',2000);
  if(currentEnc&&!_isDirectPlay&&video.paused&&!_userPaused){
    setTimeout(()=>{if(navigator.onLine){const url=_decCached(currentEnc);if(url)loadStream(url,currentChannel?.name||'Stream');}},1000);
  }
  if(_isDirectPlay&&video.paused&&!_userPaused&&_directPlayUrl){
    setTimeout(()=>{
      if(navigator.onLine&&_isDirectPlay&&_directPlayUrl){
        loadStreamDirect(_directPlayUrl,_directPlayName||$nowName.textContent,_directPlayIsAudio);
      }
    },1200);
  }
});

// ─── About modal ───
(()=>{
  const backdrop=document.getElementById('aboutModalBackdrop');
  const closeBtn=document.getElementById('aboutClose');
  const openBtn=document.getElementById('aboutBtn');
  const openBtnMob=document.getElementById('aboutBtnMob');
  if(!backdrop||!openBtn) return;
  function openAbout(){backdrop.classList.add('open');}
  function closeAbout(){backdrop.classList.remove('open');}
  openBtn.addEventListener('click',openAbout);
  if(openBtnMob) openBtnMob.addEventListener('click',openAbout);
  closeBtn.addEventListener('click',closeAbout);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeAbout();});
  // NOTE: Escape is already handled by the global keydown handler above — no duplicate listener needed
})();

// ─── Mobile search overlay ───
(()=>{
  const btn=document.getElementById('mobSearchBtn');
  const overlay=document.getElementById('mobSearchOverlay');
  const inp=document.getElementById('mobSearchInput');
  const close=document.getElementById('mobSearchClose');
  if(!btn) return;
  btn.addEventListener('click',()=>{overlay.classList.add('open');setTimeout(()=>inp.focus(),80);});
  function closeMobSearch(clearQuery){
    overlay.classList.remove('open');
    setTimeout(()=>inp.blur(),50); // defer blur to avoid iOS scroll jump
    if(clearQuery&&inp.value){
      clearTimeout(_searchDebounce);
      inp.value='';
      const di=document.getElementById('searchInput'); if(di) di.value='';
      const cb=document.getElementById('searchClear'); if(cb) cb.classList.remove('visible');
      searchQ=''; renderAll();
    }
  }
  close.addEventListener('click',()=>closeMobSearch(true));
  inp.addEventListener('input',function(){
    clearTimeout(_searchDebounce);
    const val=this.value;
    const di=document.getElementById('searchInput');
    if(di&&di.value!==val) di.value=val;
    const cb=document.getElementById('searchClear'); if(cb) cb.classList.toggle('visible',val.length>0);
    _searchDebounce=setTimeout(()=>{searchQ=val.trim().toLowerCase();renderAll();},150);
  });  inp.addEventListener('keydown',e=>{
    if(e.key==='Escape') closeMobSearch(true);
    else if(e.key==='Enter') closeMobSearch(false);
  });
})();

// ══════════════════════════════════════════
// PAGE SPLASH SCREEN CONTROLLER
// ══════════════════════════════════════════
(function(){
  const splash=document.getElementById('splashScreen');
  const splashStatus=document.getElementById('splashStatus');
  const splashBar=document.getElementById('splashBar');
  if(!splash) return;

  const STATUS_MSGS=['Connecting to server…','Loading channels…','Preparing stream engine…','Almost ready…'];
  let _statusIdx=0,_statusTimer=null,_dismissed=false,_minTimePassed=false,_pollIv=null;

  function setStatus(msg){
    if(!splashStatus||_dismissed) return;
    // reflow trick to restart CSS animation on the span
    const span=document.createElement('span');
    span.textContent=msg;
    splashStatus.innerHTML='';
    splashStatus.appendChild(span);
  }

  function cycleStatus(){
    if(_dismissed){clearTimeout(_statusTimer);return;}
    _statusIdx=(_statusIdx+1)%STATUS_MSGS.length;
    setStatus(STATUS_MSGS[_statusIdx]);
    _statusTimer=setTimeout(cycleStatus,900);
  }

  setStatus(STATUS_MSGS[0]);
  _statusTimer=setTimeout(cycleStatus,900);

  setTimeout(()=>{ _minTimePassed=true; tryDismiss(); },1600);
  function doFade(){
    if(_dismissed) return;
    _dismissed=true;
    clearTimeout(_statusTimer);
    clearInterval(_pollIv);
    setStatus('Ready! ✨');
    if(splashBar){
      splashBar.style.animation='none';
      splashBar.style.transition='transform .28s ease';
      splashBar.style.transform='scaleX(1)';
    }
    setTimeout(()=>{
      splash.classList.add('hidden');
      splash.style.willChange='auto';
      // Free GPU compositing layers used by orbit animations
      splash.querySelectorAll('[style*="will-change"],[class*="orbit"],[class*="dot"],[class*="ring"]').forEach(el=>{el.style.willChange='auto';});
      splash.addEventListener('transitionend',()=>{
        if(splash.parentNode) splash.remove();
      },{once:true});
      setTimeout(()=>{ if(splash.parentNode) splash.remove(); },700);
    },180);
  }

  function tryDismiss(){
    if(_dismissed) return;
    if(_minTimePassed && window._splashReady) doFade();
  }

  window._splashDismiss=function(statusText){
    if(_dismissed) return;
    if(statusText) setStatus(statusText);
    if(_minTimePassed) doFade();
    else _pollIv=setInterval(()=>{ if(_minTimePassed){clearInterval(_pollIv);doFade();} },40);
  };
  window._splashTryDismiss=tryDismiss;

  setTimeout(()=>{ if(!_dismissed) doFade(); },7000);
})();

// ─── Init ───
ensureHls(()=>{});
fetchChannels();

window.addEventListener('beforeunload',()=>{
  stopProgressTimer();
  clearTimeout(_searchDebounce);clearTimeout(_tt);clearTimeout(_ctrlTimer);
  clearTimeout(_stalledTimer);clearTimeout(_watchdogTimer);clearAuto();
  clearTimeout(_volSaveTimer);clearTimeout(_sleepTimer);clearTimeout(_sleepCountdownTimer);
  clearTimeout(_endedTimer);
  clearInterval(_loadStatusTimer);
  destroyPreload();
  if(hlsObj){try{hlsObj.destroy();}catch(e){}}
  if(_fetchAbort){try{_fetchAbort.abort();}catch(e){}}
  if(_bgRefreshAbort){try{_bgRefreshAbort.abort();}catch(e){}}
  if(_imgObserver){try{_imgObserver.disconnect();}catch(e){}}
});