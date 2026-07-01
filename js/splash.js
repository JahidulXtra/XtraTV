// Splash/loading screen shown on first paint, dismissed once channels are
// ready. Dismissal waits on *two* independent conditions so it never
// looks broken in either direction:
//  - _minTimePassed (1.6s): a minimum show time, so on fast connections
//    the splash doesn't just flash and disappear instantly.
//  - window._splashReady (set by channels.js once fetchChannels()
//    resolves, success or error): the actual data is ready.
// Whichever finishes last triggers the fade-out. A 7s hard timeout forces
// dismissal regardless, in case something upstream never sets _splashReady.
(function(){
  const splash=document.getElementById('splashScreen');
  const splashStatus=document.getElementById('splashStatus');
  const splashBar=document.getElementById('splashBar');
  if(!splash) return;

  const STATUS_MSGS=['Connecting to server…','Loading channels…','Preparing stream engine…','Almost ready…'];
  let _statusIdx=0,_statusTimer=null,_dismissed=false,_minTimePassed=false,_pollIv=null;

  function setStatus(msg){
    if(!splashStatus||_dismissed) return;
    const span=document.createElement('span');
    span.textContent=msg;
    splashStatus.innerHTML='';
    splashStatus.appendChild(span);
  }

  // Rotates through STATUS_MSGS every 900ms purely for perceived-progress
  // feedback — like the load-status cycle in player.js, not tied to real
  // loading stages.
  function cycleStatus(){
    if(_dismissed){clearTimeout(_statusTimer);return;}
    _statusIdx=(_statusIdx+1)%STATUS_MSGS.length;
    setStatus(STATUS_MSGS[_statusIdx]);
    _statusTimer=setTimeout(cycleStatus,900);
  }

  setStatus(STATUS_MSGS[0]);
  _statusTimer=setTimeout(cycleStatus,900);

  setTimeout(()=>{ _minTimePassed=true; tryDismiss(); },1600);
  // Plays the fade-out and removes the splash from the DOM. Clears
  // `will-change` on the splash and its decorative elements (orbit/dot/
  // ring animations) before hiding, so the browser drops those GPU layers
  // instead of holding them in memory after they're no longer visible.
  // Removal is triggered by the CSS transitionend event, with a 700ms
  // fallback timeout in case that event never fires for some reason (e.g.
  // reduced-motion settings skipping the transition).
  function doFade(){
    if(_dismissed) return;
    _dismissed=true;
    clearTimeout(_statusTimer);
    clearInterval(_pollIv);
    setStatus('Ready!');
    if(splashBar){
      splashBar.style.animation='none';
      splashBar.style.transition='transform .28s ease';
      splashBar.style.transform='scaleX(1)';
    }
    setTimeout(()=>{
      splash.classList.add('hidden');
      splash.style.willChange='auto';
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

  // Public entry point called by channels.js once channel data is ready.
  // If the minimum display time has already elapsed, fades out right
  // away; otherwise polls every 40ms until it has (simpler than tracking
  // a second timer/callback just for this one edge case).
  window._splashDismiss=function(statusText){
    if(_dismissed) return;
    if(statusText) setStatus(statusText);
    if(_minTimePassed) doFade();
    else _pollIv=setInterval(()=>{ if(_minTimePassed){clearInterval(_pollIv);doFade();} },40);
  };
  window._splashTryDismiss=tryDismiss;

  setTimeout(()=>{ if(!_dismissed) doFade(); },7000);
})();