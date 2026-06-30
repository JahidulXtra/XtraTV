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
    setStatus('Ready!');
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

