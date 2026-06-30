// ─── Toast ───
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
  if(!url){toast('Enter a URL',1600,'alert');return;}
  closeUrlModal();
  document.getElementById('urlInput').value='';
  document.getElementById('urlTitleInput').value='';
  const isAudio=/\.(mp3|aac|flac|wav|ogg|m4a|opus)(\?|$)/i.test(url);
  playDirect(url,title,isAudio?ICONS.music:ICONS.link,isAudio?'Audio':'Network Stream',isAudio);
}

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

function loadStreamDirect(url,name,isAudio){
  destroyStream();
  _setLoadLogo(null); // direct stream has no logo
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


// ─── Online/offline ───
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


// ─── Report Modal ───
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


// ─── Responsive sidebar width via ResizeObserver ───
// Adjusts --sw CSS variable based on actual viewport so sidebar is never too wide
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

// HLS buffer control is handled inside the main visibilitychange listener above

