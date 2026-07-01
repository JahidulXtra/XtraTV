// Shows a brief toast notification. Forces a 'reset' class + rAF before
// adding 'show' so the CSS transition restarts even if a toast is already
// visible (back-to-back toasts each get their own fade-in instead of the
// second one silently reusing the first's still-running animation).
function toast(msg,dur=1600,iconKey=null){
  clearTimeout(_tt);
  $toast.innerHTML=(iconKey?('<span class="toast-ic">'+(ICONS[iconKey]||'')+'</span>'):'')+'<span class="toast-txt">'+xe(msg)+'</span>';
  $toast.classList.remove('show');
  $toast.classList.add('reset');
  requestAnimationFrame(()=>{
    $toast.classList.remove('reset');
    $toast.classList.add('show');
    _tt=setTimeout(()=>$toast.classList.remove('show'),dur);
  });
}

// --- "Play a network stream" modal (paste any HLS/MP4/MP3/etc URL) -----
const urlBackdrop=document.getElementById('urlModalBackdrop');
const $urlInput=document.getElementById('urlInput');
const $urlErrMsg=document.getElementById('urlErrMsg');
const $urlErrText=document.getElementById('urlErrText');
function clearUrlError(){
  $urlInput.classList.remove('invalid');
  $urlErrMsg.classList.remove('visible');
}
// Shows the inline validation error under the URL field. The remove/
// reflow(offsetWidth)/re-add dance on 'invalid' forces the CSS shake
// animation to replay even if the field is already marked invalid from a
// previous attempt (otherwise re-adding an already-present class is a
// no-op and the animation wouldn't restart).
function showUrlError(msg){
  $urlErrText.textContent=msg;
  $urlErrMsg.classList.add('visible');
  $urlInput.classList.remove('invalid');
  void $urlInput.offsetWidth;
  $urlInput.classList.add('invalid');
}
// Basic sanity check for the "play network stream" input — just confirms
// it's a well-formed http(s) URL. Doesn't (and can't) verify the stream
// actually plays; that's discovered when loadStreamDirect() tries it.
function isValidStreamUrl(str){
  let u;
  try{u=new URL(str);}catch(e){return false;}
  return u.protocol==='http:'||u.protocol==='https:';
}
function openUrlModal(){
  urlBackdrop.classList.add('open');
  clearUrlError();
  setTimeout(()=>document.getElementById('urlInput').focus(),80);
}
function closeUrlModal(){urlBackdrop.classList.remove('open');clearUrlError();}
urlBackdrop.addEventListener('click',e=>{if(e.target===urlBackdrop)closeUrlModal();});
document.getElementById('umCancel').addEventListener('click',closeUrlModal);
document.getElementById('umPlay').addEventListener('click',playFromUrlModal);
$urlInput.addEventListener('input',clearUrlError);
document.getElementById('urlInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();playFromUrlModal();}});
document.getElementById('urlTitleInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();playFromUrlModal();}});

// Validates and kicks off playback of whatever URL the user pasted into
// the network-stream modal, falling back to the URL's filename as a title
// if the user didn't type one, and auto-detecting audio-only formats so
// the audio-visualizer overlay shows instead of a black video frame.
function playFromUrlModal(){
  const url=document.getElementById('urlInput').value.trim();
  if(!url){showUrlError('Enter a URL to continue');$urlInput.focus();return;}
  if(!isValidStreamUrl(url)){showUrlError('That doesn\'t look like a valid URL');$urlInput.focus();return;}
  const title=document.getElementById('urlTitleInput').value.trim()||url.split('/').pop().split('?')[0]||'Stream';
  closeUrlModal();
  document.getElementById('urlInput').value='';
  document.getElementById('urlTitleInput').value='';
  clearUrlError();
  const isAudio=/\.(mp3|aac|flac|wav|ogg|m4a|opus)(\?|$)/i.test(url);
  playDirect(url,title,isAudio?ICONS.music:ICONS.link,isAudio?'Audio':'Network Stream',isAudio);
}

// Sets up player/header UI for a non-channel stream (pasted URL or, via
// the report/audio flows, any ad-hoc direct source) and hands off to
// loadStreamDirect() for the actual playback. Mirrors playChannel() in
// channels.js but for streams that aren't part of the channel list, so
// there's no grid highlight, favorite button, or "last watched" save.
function playDirect(url,name,icon,cat,isAudio=false){
  if(!url||typeof url!=='string'||!url.trim()){toast('Invalid URL',1600,'alert');return;}
  url=url.trim();
  const prevId=currentChannel?currentChannel.id:null;
  currentChannel=null; currentEnc=null; retryCount=0; clearAuto();
  _isDirectPlay=true; _userPaused=false;
  _directPlayUrl=url; _directPlayName=name; _directPlayIsAudio=isAudio;
  resetSpeed();
  document.title=name+' – Xtra TV';
  $ovEmpty.classList.remove('show');
  $livePill.style.display='none';
  $nowLogo.innerHTML=icon||ICONS.film;
  $nowName.textContent=name;
  $nowCat.textContent=cat||'Stream';
  updateActiveHighlight(prevId,null);
  loadStreamDirect(url,name,isAudio);
}

// Direct-URL counterpart to loadStream() in player.js: same watchdog/
// ready/fail pattern, but simpler (no auto-retry-with-countdown, since a
// pasted one-off URL failing usually means it's genuinely wrong/dead
// rather than a transient live-stream hiccup) and it also handles plain
// MP4/MP3/etc files, not just HLS.
function loadStreamDirect(url,name,isAudio){
  destroyStream();
  _setLoadLogo(null);
  showLoad(true,name);
  resetQualityUI();
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
          buildQualityList(h,h.levels);
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

// Auto-resumes playback when the device comes back online after a
// connectivity drop — only if the user hadn't manually paused, and only
// for whichever mode (channel vs direct/pasted URL) was actually active.
window.addEventListener('offline',()=>toast('No internet connection',3000,'wifiOff'));
window.addEventListener('online',()=>{
  toast('Back online',2000,'checkCircle');
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

// "About" modal — opened from either the desktop or mobile header button.
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
})();

// "Report this channel" modal — builds a pre-filled Telegram deep link to
// the developer with the current channel's name, so reporting a dead
// stream is a single tap rather than the user having to type it out.
function openReportModal(){
  const backdrop=document.getElementById('reportModalBackdrop');
  if(!backdrop) return;
  const chName=currentChannel ? currentChannel.name : 'Unknown Channel';
  const chNameEl=document.getElementById('reportChName');
  if(chNameEl) chNameEl.textContent=chName;
  const msg=encodeURIComponent('🚨 Channel Not Working!\n\nChannel: '+chName+'\nApp: Xtra TV\n\nThis channel is not playing. Please fix it. Thank you!');
  const tgBtn=document.getElementById('reportTelegramBtn');
  if(tgBtn) tgBtn.href='https://t.me/JahidulXtra?text='+msg;
  backdrop.classList.add('open');
}
(()=>{
  const backdrop=document.getElementById('reportModalBackdrop');
  const closeBtn=document.getElementById('reportModalClose');
  if(!backdrop) return;
  function closeReport(){backdrop.classList.remove('open');}
  if(closeBtn) closeBtn.addEventListener('click',closeReport);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeReport();});
  const tgBtn=document.getElementById('reportTelegramBtn');
  if(tgBtn) tgBtn.addEventListener('click',()=>setTimeout(closeReport,300));
})();

// Tracks viewport width via ResizeObserver (rather than a 'resize'
// listener) and exposes the sidebar's current width as the --sw CSS
// variable, which other elements (e.g. the player area) use to size
// themselves around the sidebar without needing their own media queries.
(()=>{
  const sidebar=document.querySelector('.sidebar');
  if(!sidebar||!window.ResizeObserver) return;
  let _roRaf=false;
  const ro=new ResizeObserver(()=>{
    if(_roRaf) return;
    _roRaf=true;
    requestAnimationFrame(()=>{
      _roRaf=false;
      const vw=window.innerWidth;
      let sw=280;
      if(vw<900) sw=220;
      if(vw<600) sw=0;
      document.documentElement.style.setProperty('--sw',sw+'px');
    });
  });
  ro.observe(document.documentElement);
})();