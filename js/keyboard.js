// Wires up the "?" keyboard-shortcuts help modal. Opens/closes are exposed
// on window (openKbModal/closeKbModal) since the global Escape handler
// below, and the '?' key case, need to call closeKbModal/openKbModal too.
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

// Global keyboard shortcut handler (see README's Keyboard Shortcuts table).
document.addEventListener('keydown',e=>{
  // Escape always closes whatever's open (modals + the sort/speed/fit/
  // quality popups) and blurs any focused input, regardless of what else
  // is happening — handled first and separately from the rest of the
  // shortcuts below.
  if(e.key==='Escape'){
    closeUrlModal(); closeKbModal(); closeSleepModal();
    const aboutBackdrop=document.getElementById('aboutModalBackdrop');
    if(aboutBackdrop) aboutBackdrop.classList.remove('open');
    speedPopup.classList.remove('open'); fitPopup.classList.remove('open');
    if(window._closeSortPopup) window._closeSortPopup();
    if(window._closeQualityPopup) window._closeQualityPopup();
    if(document.activeElement&&typeof document.activeElement.blur==='function'&&['INPUT','TEXTAREA'].includes(document.activeElement.tagName))
      document.activeElement.blur();
    return;
  }
  // Don't hijack keys while the user is typing into a text field/search box.
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  // Wrapped in try/catch so one shortcut throwing (e.g. a popup element
  // missing) can't break every other shortcut for the rest of the session.
  try{
    switch(e.key){
      case ' ':case 'k':e.preventDefault();togglePlay();break;
      case 'm':case 'M':toggleMute();break;
      case 'f':case 'F':toggleFullscreen();break;
      case 'p':case 'P':togglePip();break;
      case 's':case 'S':e.preventDefault();e.stopPropagation();speedPopup.classList.contains('open')?speedPopup.classList.remove('open'):(speedPopup.classList.add('open'),fitPopup.classList.remove('open'),document.getElementById('fitPopup').classList.remove('open'),window._closeQualityPopup&&window._closeQualityPopup(),window._closeSortPopup&&window._closeSortPopup());break;
      case 't':case 'T':toggleTheater();break;
      case 'z':case 'Z':openSleepModal();break;
      // Left/Right seek ±10s for VOD/direct playback, but switch channels
      // for live streams (which have no meaningful seek position).
      case 'ArrowRight':
        e.preventDefault();
        if(_isVod&&video.duration){video.currentTime=Math.min(video.currentTime+10,video.duration);toast('+10s',1200,'fastFwd');}
        else nextChannel();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if(_isVod&&video.duration){video.currentTime=Math.max(video.currentTime-10,0);toast('−10s',1200,'rewind');}
        else prevChannel();
        break;
      case 'ArrowUp':{e.preventDefault();const nv=Math.min(1,Math.round((parseFloat($volSlider.value||0)+.1)*10)/10);setVolume(nv);toast(Math.round(nv*100)+'%',1200,'volHigh');break;}
      case 'ArrowDown':{e.preventDefault();const nv=Math.max(0,Math.round((parseFloat($volSlider.value||0)-.1)*10)/10);setVolume(nv);toast(Math.round(nv*100)+'%',1200,'volLow');break;}
      case '1':fitPopup.querySelector('[data-fit="contain"]').click();break;
      case '2':fitPopup.querySelector('[data-fit="cover"]').click();break;
      case '3':fitPopup.querySelector('[data-fit="fill"]').click();break;
      case '?':openKbModal();break;
      case 'F2':if(currentChannel)toggleFav(currentChannel);break;
    }
  }catch(err){console.warn('[XtraTV] Keyboard handler:',err);}
});