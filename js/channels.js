// Normalizes the remote/local channel JSON into a flat array of
// { name, url, category, logo } objects. Accepts two shapes:
//  1) { channels: { "News": [...], "Sports": [...] } }  -> category = object key
//  2) a flat array (or { channels: [...] })              -> category = per-item field
// Also accepts alternate key names (title/stream/link/group/cat/image/icon)
// so slightly different community JSON formats still work.
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

// Generates a short, stable id for a channel from its name+category+url
// (djb2 string hash). Same channel data always produces the same id, so
// favorites/history/"last watched" can reliably match a channel across
// separate fetches/page reloads, even without a real backend id.
function _uid(name,category,url){
  const s=name+'|'+category+'|'+url;
  let h=5381;
  for(let i=0;i<s.length;i++) h=((h*33)^s.charCodeAt(i))>>>0;
  return 'u'+h.toString(36);
}
// Turns the raw parsed entries into the final channel objects used by the
// rest of the app: drops entries missing a name/url, attaches a stable id
// (see _uid), obfuscates the stream url (see js/utils.js _enc), and
// pre-computes lowercase name/category strings so search doesn't have to
// call .toLowerCase() on every keystroke.
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

// Called once a channel list (fresh or cached) is ready to be used.
// Updates the header count, renders the sidebar/grid, dismisses the splash
// screen, and — if the user had a channel playing on a previous visit —
// auto-restores it. _lastRestoreKey/_restorePending guard against trying
// to restore the same channel twice (e.g. cache load followed by a
// background refresh calling this again).
let _lastRestoreKey='', _restorePending=false;
function applyChannels(chs){
  if(!chs||!chs.length) return false;
  setChannels(chs);
  migrateFavs(chs);
  $hdrCount.textContent=channels.length+' Channels';
  $hdrCount.classList.remove('updated');
  requestAnimationFrame(()=>$hdrCount.classList.add('updated'));
  if(document.pictureInPictureEnabled) document.getElementById('btnPip').style.display='flex';
  renderAll();
  window._splashReady=true;
  if(typeof window._splashDismiss==='function') window._splashDismiss(channels.length+' channels loaded');
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

// Renders placeholder "skeleton" cards in the channel grid while the real
// list is loading, so the layout doesn't jump once channels arrive.
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

// Main entry point for loading channels (called once on app start).
// Cache-first: if a cached list exists and is still within CACHE_TTL,
// show it instantly and quietly re-validate in the background
// (_bgRefresh). Otherwise show skeletons and fetch from JSON_URL directly.
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

// Silent "stale-while-revalidate" refresh: re-fetches the channel list in
// the background without showing loading UI or errors. If the cache is
// still fresh it does nothing. Any in-flight previous refresh is aborted
// first so overlapping calls can't race each other.
let _bgRefreshAbort=null;
async function _bgRefresh(){
  try{
    const ts=parseInt(localStorage.getItem(CACHE_TS_KEY)||'0',10);
    if(ts&&(Date.now()-ts)<CACHE_TTL) return;
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

// Does the actual network fetch + parse + cache-write for the channel
// list, and (when showError is true) renders a friendly error state in
// the sidebar/grid with a specific message per failure type (offline,
// 404, HTML instead of JSON, invalid JSON, empty list, etc).
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
    let iconKey='alert',title='Could not load channels',body='Check the JSON_URL in the config.';
    if(!navigator.onLine){iconKey='wifiOff';title='No internet';body='You appear to be offline.';}
    else if(e.type==='network'){iconKey='link';title='File not found ('+e.status+')';body='Make sure the URL is public and correct.';}
    else if(e.type==='notjson'){iconKey='file';title='Not a JSON file';body='Use the jsDelivr CDN link.';}
    else if(e.type==='json'){iconKey='wrench';title='JSON syntax error';body=e.detail||'Validate your JSON at jsonlint.com';}
    else if(e.type==='empty'){iconKey='clipboard';title='No channels found';body='Each entry needs name and url fields.';}
    $groupList.innerHTML=`<div style="padding:16px 10px;text-align:center">
      <div style="font-size:26px;margin-bottom:8px;color:var(--accent2);display:flex;align-items:center;justify-content:center" aria-hidden="true">${ICONS[iconKey]}</div>
      <div style="font-size:12px;font-weight:600;margin-bottom:5px">${xe(title)}</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.7;margin-bottom:10px">${xe(body)}</div>
      <button onclick="fetchChannels()" style="background:var(--accent);color:#fff;border:none;padding:6px 16px;border-radius:7px;font-size:11px;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;gap:5px"><span class="ic" aria-hidden="true">${ICONS.refresh}</span> Retry</button>
    </div>`;
    $channelGrid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:30px 20px;color:var(--muted);font-size:11px">'+xe(title)+'</div>';
    $gridTitle.textContent='Channels'; $gridCount.textContent='';
    window._splashReady=true;
    if(typeof window._splashDismiss==='function') window._splashDismiss();
  }
}

// Builds (and memoizes per channel id) the <img> markup for a channel
// logo. Uses data-src instead of src so the image only actually loads
// once it scrolls into view (see getImgObserver/observeLazyImages below).
// Falls back to the generic TV icon if there's no logo or it fails to load.
const _logoCache=new Map();
const LOGO_CACHE_MAX=500;
function logoHTML(ch,size){
  if(!ch.logo) return ICONS.tv;
  let html=_logoCache.get(ch.id);
  if(!html){
    html=`<img data-src="${xe(ch.logo)}" class="lazy" width="${size}" height="${size}" decoding="async" alt="" loading="lazy" fetchpriority="low" onerror="this.onerror=null;this.style.display='none';this.parentNode.innerHTML=window.ICONS.tv;">`;
    if(_logoCache.size>=LOGO_CACHE_MAX){_logoCache.delete(_logoCache.keys().next().value);}
    _logoCache.set(ch.id,html);
  }
  return html;
}

// Lazy-image-loading: a single shared IntersectionObserver that swaps
// data-src -> src once a logo <img> scrolls within 300px of the viewport,
// instead of loading every channel logo up front.
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
  },{rootMargin:'300px 0px',threshold:0});
  return _imgObserver;
}
// Hooks up the lazy-load observer to every not-yet-loaded logo <img>
// inside a given container. If an image happens to already be cached by
// the browser (img.complete), it's shown immediately instead of waiting
// for an intersection event.
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

// Renders the channel grid in two phases so a large channel list never
// blocks/freezes the UI:
//  1) the first RENDER_CHUNK cards are built and inserted immediately.
//  2) the rest are built in small batches during browser idle time
//     (requestIdleCallback, with a setTimeout fallback for Safari).
// _renderGen is bumped on every call so an in-progress background batch
// from a previous render (e.g. user switched category mid-render) detects
// it's stale and stops instead of appending to the wrong grid.
const RENDER_CHUNK=80;
let _renderGen=0;
function renderGrid(){
  gridElMap.clear();
  if(_imgObserver) _imgObserver.disconnect();
  const gen=++_renderGen;
  if(!filtered_.length){
    $channelGrid.innerHTML='<div class="ei" style="grid-column:1/-1;flex-direction:column;gap:8px;padding:32px 20px"><div style="font-size:32px">📺</div><div class="et">No channels found</div><div class="es">'+(searchQ?'Try a different search term':'No channels in this category')+'</div></div>';
    return;
  }
  const firstBatch=filtered_.slice(0,RENDER_CHUNK);
  const rest=filtered_.slice(RENDER_CHUNK);
  const frag=document.createDocumentFragment();
  for(let _ci=0;_ci<firstBatch.length;_ci++){const ch=firstBatch[_ci];const el=_makeChannelCard(ch,true,_ci);gridElMap.set(ch.id,el);frag.appendChild(el);}
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
        const el=_makeChannelCard(ch,false,null);
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
// Builds one channel card DOM element (logo + name + favorite star).
// `animate` staggers the entrance animation using the --i CSS variable,
// only used for the first visible batch so later idle-time batches don't
// pointlessly animate off-screen.
function _makeChannelCard(ch,animate,idx){
  const el=document.createElement('div');
  el.className='grid-ch'+(animate?' card-animate':'')+(currentChannel&&currentChannel.id===ch.id?' active':'');
  if(animate&&idx!=null) el.style.setProperty('--i',Math.min(idx,15));
  el.dataset.id=ch.id;
  const logoDiv=document.createElement('div');
  logoDiv.className='grid-logo';
  logoDiv.innerHTML=logoHTML(ch,34);
  el.appendChild(logoDiv);
  if(isFav(ch.uid)){
    const star=document.createElement('div');
    star.className='grid-fav-star';
    star.innerHTML=ICONS.starFilled;
    el.appendChild(star);
  }
  const nameDiv=document.createElement('div');
  nameDiv.className='grid-name';
  nameDiv.textContent=ch.name||'';
  el.appendChild(nameDiv);
  if(animate) el.addEventListener('animationend',()=>{el.classList.remove('card-animate');el.style.removeProperty('--i');},{once:true});
  return el;
}

function _chFromCardEl(el){if(!el||!el.dataset.id)return null;return channelsById.get(el.dataset.id)||null;}
// Click a card -> play that channel.
$channelGrid.addEventListener('click',e=>{const card=e.target.closest('.grid-ch');if(card)pickChannel(card.dataset.id);});
// Right-click (desktop) -> toggle favorite.
$channelGrid.addEventListener('contextmenu',e=>{
  const card=e.target.closest('.grid-ch');
  if(!card) return;
  e.preventDefault();
  if(card._lpFired){card._lpFired=false;return;}
  const ch=_chFromCardEl(card);
  if(ch) toggleFav(ch);
});
// Mobile equivalent of right-click: a ~600ms long-press on a card toggles
// favorite. _lpFired flags a completed long-press so the following
// touchend doesn't also fire a click/play, and touchmove cancels the
// long-press if the user is scrolling instead of holding still.
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

// Moves the "active" (currently playing) highlight from one grid card to
// another without re-rendering the whole grid, and scrolls the newly
// active card into view.
function updateActiveHighlight(prevId,newId){
  if(prevId){const o=gridElMap.get(prevId)||$channelGrid.querySelector('[data-id="'+prevId+'"]');if(o)o.classList.remove('active');}
  if(newId){const n=gridElMap.get(newId)||$channelGrid.querySelector('[data-id="'+newId+'"]');if(n){n.classList.add('active');requestAnimationFrame(()=>n.scrollIntoView({block:'nearest',behavior:'smooth'}));}}
}

function pickChannel(id){playChannel(id);}
// Switches playback to the channel with the given id (used by grid clicks,
// history, favorites, prev/next, and "last watched" restore).
// If it's already the channel on screen and not in an error/loading state,
// this just resumes/toggles playback instead of reloading the stream.
function playChannel(id){
  const ch=channelsById.get(id);
  if(!ch) return;
  if(currentChannel&&currentChannel.id===ch.id&&!$ovErr.classList.contains('show')&&!$ovLoad.classList.contains('show')){
    if(video.paused&&!_userPaused){safePlay();setPlayIcon(true);pw.classList.remove('paused');}
    else if(video.paused&&_userPaused){togglePlay();}
    return;
  }
  const prevId=currentChannel?currentChannel.id:null;
  // Swap in the new channel's state, reset per-stream UI (speed, retry
  // count, any pending auto-retry/ended timers) before loading it.
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
      ?`<img src="${xe(ch.logo)}" width="28" height="28" decoding="async" onerror="this.onerror=null;this.style.display='none';this.parentNode.innerHTML=window.ICONS.tv" style="width:100%;height:100%;object-fit:cover;border-radius:5px">`
      :ICONS.tv;
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
  // Stream URL is stored obfuscated (see js/utils.js _enc/_dec) — decode it
  // right before actually handing it to the player.
  const url=_decCached(ch.enc);
  if(!url){showErr(true,'Invalid stream URL.','Bad URL');return;}
  loadStream(url,ch.name);
}