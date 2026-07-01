// --- Cached DOM references -------------------------------------------
// Player, overlays, progress bar, and header elements are looked up once
// here and reused everywhere else in this file (and other JS files that
// load after this one — see README load-order notes).
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
const $qualityBtn      = document.getElementById('qualityBtn');
const $qualityBtnLabel = document.getElementById('qualityBtnLabel');
const $qualityPopup    = document.getElementById('qualityPopup');
const $qualityList     = document.getElementById('qualityList');
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
const $btnMute    = document.getElementById('btnMute');
const $toast      = document.getElementById('toast');
const $groupList  = document.getElementById('groupList');
const $bufBadge   = document.getElementById('bufBadge');
const $progBar    = document.getElementById('progBar');
// Cached mobile/desktop flag (recomputed on resize via rAF, not on every
// call) — used to branch touch-vs-mouse UI behavior without re-measuring
// window.innerWidth on every check.
let _isMobileCache=window.innerWidth<=700;
const isMobile=()=>_isMobileCache;
let _resizeRaf=false;
window.addEventListener('resize',()=>{
  if(_resizeRaf) return;
  _resizeRaf=true;
  requestAnimationFrame(()=>{_isMobileCache=window.innerWidth<=700;_resizeRaf=false;});
},{passive:true});

// Restore previously saved volume and fit-mode preferences (localStorage)
// before anything plays, so the player opens with the user's last settings.
try{ const sv=parseFloat(localStorage.getItem(VOL_KEY)); if(!isNaN(sv)&&sv>=0&&sv<=1) _userVolume=sv; }catch(e){}
try{ const sf=localStorage.getItem(FIT_KEY); if(sf&&['contain','cover','fill'].includes(sf)){ fitMode=sf; pw.classList.remove('fit-contain','fit-cover','fit-fill'); pw.classList.add('fit-'+sf); } }catch(e){}
video.volume = _userVolume;
$volSlider.value = _userVolume;
$volSlider.style.setProperty('--vol',(_userVolume*100).toFixed(1)+'%');

// Generates the animated "audio bars" visualizer shown when playing an
// audio-only stream (random heights/durations so bars don't move in sync).
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

// Lazy-loads hls.js from CDN on first use (rather than always, since many
// visits may only play native-supported formats). Queues callbacks if a
// load is already in progress so multiple simultaneous callers don't
// inject the script twice. The integrity attribute is pinned to this exact
// version's known hash (computed from the published npm package, which
// cdnjs serves unmodified) so the browser refuses to run the script if the
// CDN ever serves something other than the expected file — falls into the
// same onerror path as a network failure. Bump both the URL and this hash
// together whenever the pinned hls.js version changes.
let _hlsLoading=false, _hlsQueue=[];
function ensureHls(cb){
  if(typeof Hls!=='undefined'){cb();return;}
  _hlsQueue.push(cb);
  if(_hlsLoading) return;
  _hlsLoading=true;
  const s=document.createElement('script');
  s.crossOrigin='anonymous';
  s.integrity='sha384-z+tuLqMWl1/cPv7O+39RO0EURSNvorimpcCaMgeNwU+qFBx+AlUIl7jaAwg0cYil';
  s.src='https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.6.13/hls.min.js';
  s.onload=()=>{_hlsLoading=false;_hlsQueue.forEach(fn=>fn());_hlsQueue=[];};
  s.onerror=()=>{_hlsLoading=false;_hlsQueue=[];console.warn('HLS.js load failed');};
  document.head.appendChild(s);
}

// --- Next-channel preloading -------------------------------------------
// While the current channel plays, quietly start loading (but don't play)
// the *next* channel in the filtered list into a hidden, muted <video> +
// separate Hls instance, so pressing "next" feels instant. Cancelled/
// destroyed if the user navigates away, changes channel again, or after
// 30s (to avoid holding a stale connection open indefinitely).
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
        _preloadVideo.style.cssText='position:absolute;width:0;height:0;opacity:0;pointer-events:none';
        _preloadHls.attachMedia(_preloadVideo);
        setTimeout(()=>{if(_preloadHls){try{_preloadHls.destroy();}catch(e){} _preloadHls=null;} if(_preloadVideo){_preloadVideo.src='';_preloadVideo=null;}},30000);
      }catch(e){_preloadHls=null;_preloadVideo=null;}
    });
  },3000);
}

// Starts playback in a way that works around browser autoplay restrictions:
// always attempt play() *muted* first (muted autoplay is universally
// allowed), then unmute shortly after if the user hadn't muted themselves.
// If even muted play() is rejected (NotAllowedError), fall back to staying
// muted and prompting the user to tap the speaker icon.
function safePlay(){
  video.volume=_userVolume;
  $volSlider.value=_userVolume;
  video.muted=true;
  const cc=currentChannel, ce=currentEnc;
  const p=video.play();
  if(p&&typeof p.then==='function'){
    p.then(()=>{
      setTimeout(()=>{
        if(currentChannel!==cc||currentEnc!==ce) return;
        if(!_muted){
          video.muted=false;
          video.volume=_userVolume; $volSlider.value=_userVolume;
          updateMuteIcon(false);
        }
      },200);
    }).catch(err=>{
      if(err&&err.name==='NotAllowedError'){
        _muted=true; video.muted=true;
        video.volume=_userVolume; $volSlider.value=_userVolume;
        updateMuteIcon(true);
        $volSlider.classList.add('is-muted');
        toast('Tap the speaker icon to unmute',2500,'volMute');
      } else if(err&&err.name!=='AbortError'){
        console.warn('[XtraTV] play() error:',err);
      }
    });
  } else {
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

// Redraws the speaker icon (muted / low / high volume) with a small
// scale+fade transition. Icon shape depends on both the mute flag and the
// current slider value, so dragging volume to 0 shows the muted icon even
// if `_muted` itself is still false.
function updateMuteIcon(m){
  const svg=document.getElementById('muteIcon');
  const btn=document.getElementById('btnMute');
  if(!svg||!btn) return;
  btn.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
  btn.title = m ? 'Unmute (M)' : 'Mute (M)';
  svg.style.transform='scale(.75)';
  svg.style.opacity='0';
  setTimeout(()=>{
    if(m){
      svg.innerHTML=`
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" opacity=".9"/>
        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
    } else {
      const vol=parseFloat(document.getElementById('volSlider')?.value??1);
      if(vol===0){
        svg.innerHTML=`<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" opacity=".9"/>`;
      } else if(vol<0.5){
        svg.innerHTML=`
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" opacity=".9"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" class="vol-arc vol-arc-inner" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`;
      } else {
        svg.innerHTML=`
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" opacity=".9"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" class="vol-arc vol-arc-outer" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" class="vol-arc vol-arc-inner" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`;
      }
    }
    svg.style.transition='transform .18s cubic-bezier(.34,1.4,.64,1), opacity .15s ease';
    svg.style.transform='scale(1)';
    svg.style.opacity='1';
  },70);
}

// Fully tears down whatever is currently playing/loading: clears every
// stream-related timer, destroys the Hls instance (if any) and any
// preload in progress, detaches the <video> source, and hides the
// loading/error/audio overlays. Called at the start of every new
// loadStream/loadStreamDirect so switching channels never leaves stale
// timers or a leftover Hls instance running in the background.
function destroyStream(){
  clearTimeout(_stalledTimer);
  clearTimeout(_watchdogTimer);
  clearAuto();
  stopProgressTimer();
  clearInterval(_loadStatusTimer); _loadStatusTimer=null;
  destroyPreload();
  const h=hlsObj; hlsObj=null;
  if(h){try{h.destroy();}catch(e){}}
  clearInterval(_autoLiveTimer); _autoLiveTimer=null;
  try{video.pause();video.removeAttribute('src');video.load();}catch(e){}
  $audioOver.classList.remove('show');
  $bufBadge.classList.remove('show');
  showLoad(false); showErr(false);
}

// Cycles the small status text under the loading spinner ("Connecting to
// stream…" -> "Fetching manifest…" -> …) purely for perceived-progress
// feedback — it's not tied to real load stages, just rotates on a timer.
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

// Shows/hides the loading overlay and starts/stops the status-message cycle.
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
// Shows/hides the error overlay with a given title/body, or resets it back
// to the default "Stream unavailable" text when hidden.
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

let _directPlayUrl='', _directPlayName='', _directPlayIsAudio=false;

const $loadCenterLogo=document.querySelector('.load-center-logo');
function _setLoadLogo(logo){
  if(!$loadCenterLogo) return;
  if(logo){
    $loadCenterLogo.innerHTML=`<img src="${xe(logo)}" width="28" height="28" decoding="async" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{innerHTML:window.ICONS.tv,style:'display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#fff'}))" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    $loadCenterLogo.innerHTML=ICONS.tv;
  }
}

// Loads and plays a channel's stream URL. This is the main HLS pipeline:
//  - hls.js (if supported) for most browsers, tuned with conservative
//    buffer sizes on mobile to limit memory/bandwidth use.
//  - native HLS (video.canPlayType) as a fallback for Safari/iOS, which
//    doesn't need hls.js since it supports HLS out of the box.
// An 8s watchdog fires an error if neither path reports "ready" in time
// (e.g. server not responding at all). Recoverable Hls errors (network
// blips, decode errors) are retried in place; unrecoverable ones show an
// error and hand off to scheduleAutoRetry() for a countdown-based retry.
function loadStream(url,name){
  destroyStream();
  _setLoadLogo(currentChannel?.logo||null);
  showLoad(true,name);
  resetQualityUI();
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
        if(d.levels&&d.levels.length>0) buildQualityList(h,d.levels);
      });

      h.on(Hls.Events.LEVEL_SWITCHED,(e,d)=>{
        if(h!==hlsObj) return;
        onLevelSwitched(h,d.level);
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

// Counts down and automatically retries a failed live stream (up to 3
// attempts), updating the error message each second ("Retrying in Ns…").
// _retryGen lets clearAuto() invalidate an in-progress countdown so a
// newer retry/channel-switch can't be stepped on by a stale tick().
let _retryGen=0;
function scheduleAutoRetry(){
  if(_isDirectPlay) return;
  clearAuto();
  if(retryCount>=3){$errBody.textContent='Max retries reached. Tap Retry.';return;}
  const gen=++_retryGen;
  let s=7;
  const tick=()=>{
    if(gen!==_retryGen){return;}
    if(retryCount>=3){$errBody.textContent='Max retries reached.';clearAuto();return;}
    $errBody.textContent=`Retrying in ${s}s… (attempt ${retryCount+1}/3)`;
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
// Manual retry (the "Retry" button on the error overlay) — resets the
// retry counter and reloads either the current channel or the last
// direct/network-stream URL, whichever was playing.
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
function _fmtBitrate(bps){
  if(!bps||bps<=0) return '';
  const mbps=bps/1e6;
  return mbps>=1?mbps.toFixed(1)+' Mbps':Math.round(bps/1e3)+' kbps';
}
function _levelLabel(lv){
  if(!lv) return '';
  if(!lv.height) return lv.width?lv.width+'w':'Auto';
  return lv.height+'p';
}
function _levelSubLabel(lv){
  if(!lv||!lv.height) return '';
  const h=lv.height;
  if(h>=2160) return '2160p';
  if(h>=1440) return '1440p';
  if(h>=1080) return '1080p';
  if(h>=720)  return '720p';
  if(h>=480)  return '480p';
  return h+'p';
}
function resetQualityUI(){
  _qualityHls=null; _qualityLevels=[];
  clearInterval(_autoLiveTimer); _autoLiveTimer=null;
  $qualityList.innerHTML=`<div class="quality-opt active" data-level="-1">
    <span class="ic quality-opt-ic" aria-hidden="true">${ICONS.auto}</span>
    <span class="quality-opt-label">Auto</span>
    <span class="quality-opt-live" id="qualityAutoLive"></span>
    <span class="quality-opt-check ic" aria-hidden="true">${ICONS.check}</span>
  </div>`;
  $qualityBtnLabel.textContent='Auto';
}
// Rebuilds the quality-selector dropdown from an Hls instance's ABR
// levels: always includes "Auto" at the top, then each level sorted
// highest-resolution first, labeled with an SD/HD/FHD/2K/4K badge based on
// height. Levels above 4320p (8K) are skipped as almost certainly bogus
// manifest data rather than a real stream.
function buildQualityList(hls,levels){
  if(!levels||!levels.length) return;
  _qualityHls=hls; _qualityLevels=levels;
  const frag=document.createDocumentFragment();
  const autoOpt=document.createElement('div');
  autoOpt.className='quality-opt active'; autoOpt.dataset.level='-1';
  autoOpt.innerHTML=`<span class="ic quality-opt-ic" aria-hidden="true">${ICONS.auto}</span><span class="quality-opt-label">Auto</span><span class="quality-opt-live" id="qualityAutoLive"></span><span class="quality-opt-check ic" aria-hidden="true">${ICONS.check}</span>`;
  frag.appendChild(autoOpt);
  const order=levels.map((lv,i)=>({lv,i})).sort((a,b)=>(b.lv.height||0)-(a.lv.height||0));
  for(const {lv,i} of order){
    if(lv.height>=4320) continue;
    const opt=document.createElement('div');
    opt.className='quality-opt'; opt.dataset.level=String(i);
    const label=_levelSubLabel(lv);
    let badge='';
    if(lv.height>=2160) badge='<span class="quality-opt-hd" style="color:#60a5fa;background:rgba(96,165,250,.12);border-color:rgba(96,165,250,.35)">4K</span>';
    else if(lv.height>=1440) badge='<span class="quality-opt-hd" style="color:#34d399;background:rgba(52,211,153,.12);border-color:rgba(52,211,153,.35)">2K</span>';
    else if(lv.height>=1080) badge='<span class="quality-opt-hd" style="color:#fb923c;background:rgba(251,146,60,.12);border-color:rgba(251,146,60,.35)">FHD</span>';
    else if(lv.height>=720)  badge='<span class="quality-opt-hd" style="color:#fbbf24;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.35)">HD</span>';
    else if(lv.height>=480)  badge='<span class="quality-opt-hd" style="color:#94a3b8;background:rgba(148,163,184,.1);border-color:rgba(148,163,184,.3)">SD</span>';
    opt.innerHTML=`<span class="ic quality-opt-ic" aria-hidden="true">${ICONS.quality}</span><span class="quality-opt-label">${label}</span>${badge}<span class="quality-opt-check ic" aria-hidden="true">${ICONS.check}</span>`;
    frag.appendChild(opt);
  }
  $qualityList.innerHTML=''; $qualityList.appendChild(frag);
  $qualityBtnLabel.textContent='Auto';
  _startAutoLiveIndicator();
}
function _startAutoLiveIndicator(){
  clearInterval(_autoLiveTimer);
  _autoLiveTimer=setInterval(()=>{
    if(!_qualityHls||_qualityHls!==hlsObj||_qualityHls.currentLevel!==-1) return;
    const live=document.getElementById('qualityAutoLive');
    if(live&&_qualityHls.levels&&_qualityHls.levels[_qualityHls.loadLevel]){
      live.title=_fmtBitrate(_qualityHls.levels[_qualityHls.loadLevel].bitrate);
    }
  },2000);
}
// Fired whenever Hls actually switches the playing quality level (either
// because the user picked one, or ABR picked one automatically). Updates
// the dropdown's active checkmark, the button label, and briefly flashes a
// "1080p · Auto" badge over the video.
function onLevelSwitched(hls,levelIdx){
  if(hls!==hlsObj) return;
  const lv=hls.levels[levelIdx];
  if(!lv) return;
  const isAuto=hls.currentLevel===-1;
  $qualityList.querySelectorAll('.quality-opt').forEach(o=>{
    o.classList.toggle('active',isAuto?o.dataset.level==='-1':o.dataset.level===String(levelIdx));
  });
  $qualityBtnLabel.textContent=isAuto?'Auto':_levelLabel(lv);
  if(lv.height){
    $bufBadge.textContent=_levelSubLabel(lv)+(isAuto?' · Auto':'');
    $bufBadge.classList.add('show');
    clearTimeout($bufBadge._hideTimer);
    $bufBadge._hideTimer=setTimeout(()=>$bufBadge.classList.remove('show'),2600);
  }
}
function changeQuality(levelIdx){
  if(!hlsObj) return;
  hlsObj.currentLevel=levelIdx;
  const isAuto=levelIdx===-1;
  $qualityList.querySelectorAll('.quality-opt').forEach(o=>o.classList.toggle('active',o.dataset.level===String(levelIdx)));
  if(isAuto){
    $qualityBtnLabel.textContent='Auto';
    toast('Auto quality',1400,'auto');
  } else {
    const lv=hlsObj.levels[levelIdx];
    $qualityBtnLabel.textContent=_levelLabel(lv);
    toast(_levelSubLabel(lv)||_levelLabel(lv),1400,'quality');
  }
}
(()=>{
  if(!$qualityBtn||!$qualityPopup) return;
  function openPopup(){
    $qualityPopup.classList.add('open');
    $qualityBtn.classList.add('popup-open');
    speedPopup.classList.remove('open'); fitPopup.classList.remove('open');
    if(window._closeSortPopup) window._closeSortPopup();
  }
  function closePopup(){
    $qualityPopup.classList.remove('open');
    $qualityBtn.classList.remove('popup-open');
  }
  $qualityBtn.addEventListener('click',e=>{
    e.stopPropagation();
    $qualityPopup.classList.contains('open')?closePopup():openPopup();
  });
  $qualityList.addEventListener('click',e=>{
    e.stopPropagation();
    const opt=e.target.closest('.quality-opt');
    if(!opt) return;
    changeQuality(parseInt(opt.dataset.level,10));
    closePopup();
  });
  window._closeQualityPopup=closePopup;
})();

// Drives the custom progress bar / time label via requestAnimationFrame.
// For VOD/direct files it tracks real currentTime/duration/buffered.
// For live channels (no real duration) it instead animates a slow
// continuously-filling bar purely as a "still live" visual cue — it does
// not represent actual playback position. Throttles to ~2fps when paused
// or tab is hidden to avoid burning CPU in the background.
let _rafLastLabel='', _rafLastFill=-1, _rafLastBuf=-1;
function startProgressTimer(){
  if(_rafLoopRunning) return;
  _rafLoopRunning=true;
  let lastLiveUpdate=-1;
  const loop=()=>{
    if(!_rafLoopRunning) return;
    if(document.hidden||(video.paused&&!_isVod)){
      setTimeout(()=>{if(_rafLoopRunning)requestAnimationFrame(loop);},500);
      return;
    }
    if(_isVod&&video.duration&&isFinite(video.duration)){
      const fill=video.currentTime/video.duration*100;
      if(Math.abs(fill-_rafLastFill)>0.02){_rafLastFill=fill;$progFill.style.transform='scaleX('+(fill/100)+')';$progBar.style.setProperty('--fill',fill);}
      if(video.buffered.length){
        const buf=video.buffered.end(video.buffered.length-1)/video.duration*100;
        if(Math.abs(buf-_rafLastBuf)>0.1){_rafLastBuf=buf;$progBuf.style.transform='scaleX('+buf/100+')';}
      }
      const label=fmtTime(video.currentTime)+' / '+fmtTime(video.duration);
      if(label!==_rafLastLabel){_rafLastLabel=label;$timeLabel.textContent=label;}
    } else {
      const nowSec=Math.floor(Date.now()/1000);
      if(nowSec!==lastLiveUpdate){
        lastLiveUpdate=nowSec;
        _rafLastFill=(_rafLastFill>=98?0:_rafLastFill+0.5);
        $progFill.style.transform='scaleX('+(_rafLastFill/100)+')';$progBar.style.setProperty('--fill',_rafLastFill);
      }
      setTimeout(()=>{if(_rafLoopRunning)requestAnimationFrame(loop);},800);
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function stopProgressTimer(){
  _rafLoopRunning=false;
  _rafLastLabel=''; _rafLastFill=-1; _rafLastBuf=-1;
}
function setTimeMode(vod){
  _isVod=vod;
  $timeLabel.textContent=vod?'0:00 / 0:00':'● LIVE';
  $progFill.style.transform='scaleX(0)'; $progBuf.style.transform='scaleX(0)'; $progBar.style.setProperty('--fill',0);
}
function fmtTime(s){
  if(!isFinite(s)||s<0) return '0:00';
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.floor(s%60);
  if(h) return h+':'+String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0');
  return m+':'+String(ss).padStart(2,'0');
}

// Click-and-drag (mouse) / touch-and-drag seeking on the progress bar.
// Only active for VOD/direct playback (_isVod) since live streams have no
// meaningful seek target.
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
  e.preventDefault();
  document.addEventListener('touchmove',_onSeekTouchMove,{passive:false});
  document.addEventListener('touchend',_onSeekTouchEnd,{passive:true});},{passive:false});

const speedBtn=document.getElementById('speedBtn');
const speedPopup=document.getElementById('speedPopup');
speedBtn.addEventListener('click',e=>{e.stopPropagation();speedPopup.classList.toggle('open');document.getElementById('fitPopup').classList.remove('open');if(window._closeSortPopup)window._closeSortPopup();if(window._closeQualityPopup)window._closeQualityPopup();});
speedPopup.querySelectorAll('.speed-opt').forEach(el=>{
  el.addEventListener('click',()=>{
    const sp=parseFloat(el.dataset.sp);
    video.playbackRate=sp; _curSpeed=sp;
    speedBtn.textContent=sp===1?'1×':sp+'×';
    speedPopup.querySelectorAll('.speed-opt').forEach(o=>o.classList.toggle('active',o===el));
    speedPopup.classList.remove('open');
    toast(sp+'×',1600,'fastFwd');
  });
});
function resetSpeed(){
  if(_curSpeed===1) return;
  video.playbackRate=1; _curSpeed=1;
  speedBtn.textContent='1×';
  speedPopup.querySelectorAll('.speed-opt').forEach(o=>o.classList.toggle('active',o.dataset.sp==='1'));
}

const fitBtn=document.querySelector('.fit-btn');
const fitPopup=document.getElementById('fitPopup');
fitBtn.addEventListener('click',e=>{e.stopPropagation();fitPopup.classList.toggle('open');speedPopup.classList.remove('open');if(window._closeSortPopup)window._closeSortPopup();if(window._closeQualityPopup)window._closeQualityPopup();});
fitPopup.querySelectorAll('.fit-opt').forEach(o=>o.classList.toggle('active',o.dataset.fit===fitMode));
fitPopup.querySelectorAll('.fit-opt').forEach(el=>{
  el.addEventListener('click',()=>{
    const mode=el.dataset.fit; fitMode=mode;
    pw.classList.remove('fit-contain','fit-cover','fit-fill');
    pw.classList.add('fit-'+mode);
    fitPopup.querySelectorAll('.fit-opt').forEach(o=>o.classList.toggle('active',o===el));
    fitPopup.classList.remove('open');
    try{localStorage.setItem(FIT_KEY,mode);}catch(e){}
    const fitToasts={contain:['Fit Screen','fitScreen'],cover:['Crop','crop'],fill:['Stretch','stretch']};
    const ft=fitToasts[mode]||['Applied','check'];
    toast(ft[0],1600,ft[1]);
  });
});

document.addEventListener('click',()=>{speedPopup.classList.remove('open');fitPopup.classList.remove('open');if(window._closeSortPopup)window._closeSortPopup();if(window._closeQualityPopup)window._closeQualityPopup();});

function togglePlay(){
  if(!currentChannel&&!_isDirectPlay){openUrlModal();return;}
  if(video.paused){
    _userPaused=false;
    const p=video.play();
    if(p&&typeof p.then==='function'){
      p.then(()=>{setPlayIcon(true);pw.classList.remove('paused');}).catch(err=>{
        if(err&&err.name==='AbortError') return;
        setPlayIcon(false);pw.classList.add('paused');
      });
    } else {
      setPlayIcon(true);pw.classList.remove('paused');
    }
  } else {
    _userPaused=true;
    video.pause();setPlayIcon(false);pw.classList.add('paused');
  }
}
function setPlayIcon(playing){
  const svg=document.getElementById('playIcon');
  if(!svg) return;
  const btn=document.getElementById('btnPlay');
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  btn.title = playing ? 'Pause (Space)' : 'Play (Space)';
  svg.style.transform='scale(.7)';
  svg.style.opacity='0';
  setTimeout(()=>{
    if(playing){
      svg.innerHTML='<rect x="5" y="3" width="4" height="18" rx="1.5" fill="currentColor"/><rect x="15" y="3" width="4" height="18" rx="1.5" fill="currentColor"/>';
    } else {
      svg.innerHTML='<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>';
    }
    svg.style.transition='transform .15s cubic-bezier(.34,1.4,.64,1), opacity .15s ease';
    svg.style.transform='scale(1)';
    svg.style.opacity='1';
  },80);
}
function toggleMute(){
  _muted=!_muted; video.muted=_muted;
  updateMuteIcon(_muted);
  $volSlider.classList.toggle('is-muted',_muted);
  toast(_muted?'Muted':'Unmuted',1400,_muted?'volMute':'volHigh');
}
let _volSaveTimer=null;
$volSlider.addEventListener('animationend',()=>$volSlider.classList.remove('vol-anim'),{passive:true});

function setVolume(v){
  const vol=Math.max(0,Math.min(1,parseFloat(v)||0));
  _userVolume=vol; video.volume=vol; $volSlider.value=vol;
  $volSlider.style.setProperty('--vol',(vol*100).toFixed(1)+'%');
  $volSlider.classList.remove('vol-anim');
  requestAnimationFrame(()=>$volSlider.classList.add('vol-anim'));
  clearTimeout(_volSaveTimer);
  _volSaveTimer=setTimeout(()=>{try{localStorage.setItem(VOL_KEY,String(vol));}catch(e){}},300);
  if(vol===0&&!_muted){_muted=true;video.muted=true;updateMuteIcon(true);$volSlider.classList.add('is-muted');}
  else if(vol>0&&_muted){_muted=false;video.muted=false;updateMuteIcon(false);$volSlider.classList.remove('is-muted');}
  else if(!_muted){ updateMuteIcon(false); }
}

// Toggles fullscreen on the player wrapper (with a Safari/iOS-specific
// fallback that puts just the <video> element into fullscreen, since
// older WebKit doesn't support requestFullscreen on arbitrary elements).
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
  const el=document.getElementById('fsIcon');
  if(!el) return;
  if(inFs){
    el.setAttribute('fill','none');
    el.setAttribute('stroke','currentColor');
    el.setAttribute('stroke-width','2');
    el.setAttribute('stroke-linecap','round');
    el.setAttribute('stroke-linejoin','round');
    el.innerHTML='<path d="M8 3v5H3"/><path d="M21 8h-5V3"/><path d="M3 16h5v5"/><path d="M16 21v-5h5"/>';
    document.getElementById('btnFs').title='Exit Fullscreen (F)';
    document.getElementById('btnFs').classList.add('fs-active');
  } else {
    el.setAttribute('fill','none');
    el.setAttribute('stroke','currentColor');
    el.setAttribute('stroke-width','2');
    el.setAttribute('stroke-linecap','round');
    el.setAttribute('stroke-linejoin','round');
    el.innerHTML='<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>';
    document.getElementById('btnFs').title='Fullscreen (F)';
    document.getElementById('btnFs').classList.remove('fs-active');
  }
}
document.addEventListener('fullscreenchange',updateFsIcon);
document.addEventListener('webkitfullscreenchange',updateFsIcon);

function toggleTheater(){
  _theaterMode=!_theaterMode;
  document.getElementById('playerArea').classList.toggle('theater-mode',_theaterMode);
  document.getElementById('theaterBtn').classList.toggle('active',_theaterMode);
  toast(_theaterMode?'Theater mode on':'Theater mode off',1600,'theater');
}

async function togglePip(){
  try{
    if(document.pictureInPictureElement){await document.exitPictureInPicture();toast('Exited PiP',1600,'pip');}
    else{await video.requestPictureInPicture();toast('PiP mode',1600,'pip');}
  }catch{toast('PiP not supported',1600,'alert');}
}
document.getElementById('btnPip').addEventListener('click',togglePip);
video.addEventListener('enterpictureinpicture',()=>{
  const b=document.getElementById('btnPip');
  b.style.color='var(--accent2)';
  b.classList.add('pip-active');
  toast('Picture in Picture — On',1600,'pip');
});
video.addEventListener('leavepictureinpicture',()=>{
  const b=document.getElementById('btnPip');
  b.style.color='';
  b.classList.remove('pip-active');
  toast('Picture in Picture — Off',1400,'pip');
});

// Jumps to the next/previous channel within the currently filtered list
// (respects active category/search), wrapping around at either end.
function nextChannel(){
  if(!filtered_.length) return;
  if(!currentChannel){pickChannel(filtered_[0].id);return;}
  const i=filtered_.findIndex(c=>c.id===currentChannel.id);
  const next=filtered_[(i===-1||i>=filtered_.length-1)?0:i+1];
  if(next){pickChannel(next.id);toast(next.name,1600,'skipNext');}
}
function prevChannel(){
  if(!filtered_.length) return;
  if(!currentChannel){pickChannel(filtered_[filtered_.length-1].id);return;}
  const i=filtered_.findIndex(c=>c.id===currentChannel.id);
  const prev=filtered_[i<=0?filtered_.length-1:i-1];
  if(prev){pickChannel(prev.id);toast(prev.name,1600,'skipPrev');}
}
document.getElementById('btnNext').addEventListener('click',nextChannel);
document.getElementById('btnPrev').addEventListener('click',prevChannel);

let _waitingTimer=null;
video.addEventListener('pause',()=>{
  if(!video.src&&!hlsObj) return;
  if(!currentChannel&&!_isDirectPlay) return;
  setPlayIcon(false); pw.classList.add('paused');
  stopProgressTimer();
});
video.addEventListener('play',()=>{
  clearTimeout(_waitingTimer); _waitingTimer=null;
  setPlayIcon(true); pw.classList.remove('paused');
  if(!_rafLoopRunning&&(currentChannel||_isDirectPlay)) startProgressTimer();
});
video.addEventListener('waiting',()=>{
  if(currentChannel||_isDirectPlay){
    clearTimeout(_waitingTimer);
    _waitingTimer=setTimeout(()=>{
      if(video.readyState<3){
        const nm=currentChannel?.name||$nowName.textContent||'';
        showLoad(true,nm||undefined);
      }
    },600);
  }
});
video.addEventListener('playing',()=>{
  clearTimeout(_waitingTimer); _waitingTimer=null;
  showLoad(false); showErr(false);
  clearTimeout(_stalledTimer);
  if(!_muted){video.volume=_userVolume;$volSlider.value=_userVolume;}
});
video.addEventListener('ended',()=>{
  setPlayIcon(false); pw.classList.add('paused'); stopProgressTimer();
  if(!_isVod&&!_isDirectPlay&&currentChannel){clearTimeout(_endedTimer);_endedTimer=setTimeout(nextChannel,1500);}
});
video.addEventListener('click',()=>{if(!isMobile())togglePlay();});
video.addEventListener('dblclick',e=>{if(!isMobile())toggleFullscreen();});

// If playback stalls for 6s straight, try to self-heal: for a direct
// (non-HLS) stream, just reload the same src; for an Hls stream, nudge it
// with startLoad() rather than a full teardown/rebuild; only fall back to
// a full loadStream() retry if there's no live Hls instance to nudge.
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
        showLoad(true,currentChannel?.name||undefined);
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

pw.addEventListener('mousemove',()=>{
  if(!pw.classList.contains('show-ctrl')) pw.classList.add('show-ctrl');
  clearTimeout(_ctrlTimer);
  _ctrlTimer=setTimeout(()=>{if(!video.paused)pw.classList.remove('show-ctrl');},3000);
},{passive:true});
pw.addEventListener('mouseleave',()=>{if(!video.paused){clearTimeout(_ctrlTimer);pw.classList.remove('show-ctrl');}});

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

// Lets the user drag a handle to manually resize the player's height
// (desktop/tablet). A manual resize is cleared automatically if the
// layout crosses the mobile/desktop breakpoint or fullscreen is
// entered/exited, since the fixed pixel height wouldn't make sense there.
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

// Handles the tab being backgrounded/foregrounded (e.g. switching apps on
// mobile, or another browser tab). On return to visible: if playback had
// stalled while hidden, resume/reload the stream; restart the progress
// loop and sleep-timer countdown. While hidden: pause the progress loop
// and tell Hls to stop loading segments, to save bandwidth/battery.
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    let _alreadyResumedHls=false;
    if(!video.paused&&video.readyState<3){
      if(hlsObj){
        try{hlsObj.startLoad();}catch(e){}
        _alreadyResumedHls=true;
      } else if(_isDirectPlay&&_directPlayUrl){
        loadStreamDirect(_directPlayUrl,_directPlayName||$nowName.textContent,_directPlayIsAudio);
      } else if(!_isDirectPlay&&currentEnc&&typeof currentEnc==='string'){
        const url=_decCached(currentEnc);
        if(url) loadStream(url,currentChannel?.name||'Stream');
      }
    }
    if(!_rafLoopRunning&&(currentChannel||_isDirectPlay)&&!video.paused) startProgressTimer();
    if(hlsObj&&!video.paused&&!_alreadyResumedHls){try{hlsObj.startLoad(-1);}catch(e){}}
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
    clearTimeout(_stalledTimer); _stalledTimer=null;
    clearTimeout(_sleepCountdownTimer); _sleepCountdownTimer=null;
    if(hlsObj){try{hlsObj.stopLoad();}catch(e){}}
  }
});