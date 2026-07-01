// Sleep timer: pauses playback after N minutes. _sleepEndTime is an
// absolute timestamp (not just "minutes remaining") so the countdown stays
// correct even if the tab was backgrounded/throttled in between ticks.
let _sleepTimer=null, _sleepEndTime=0, _sleepCountdownTimer=null;
const $sleepIndicator=document.getElementById('sleepIndicator');
const $sleepCountdown=document.getElementById('sleepCountdown');

// Opens the sleep-timer modal. If a timer is already running, shows the
// "Clear" button and pre-fills the custom-minutes placeholder with the
// remaining time instead of a generic hint.
function openSleepModal(){
  const backdrop=document.getElementById('sleepModalBackdrop');
  backdrop.classList.add('open');
  const clearBtn=document.getElementById('sleepClear');
  if(clearBtn) clearBtn.classList.toggle('hidden',!_sleepTimer);
  document.getElementById('sleepCustomInput').value='';
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

// Starts (or restarts) the sleep timer for `mins` minutes: schedules the
// actual pause via setTimeout, and separately runs a 500ms tick() loop
// just to update the visible mm:ss countdown badge — the two are
// independent so a delayed/throttled tick doesn't affect when playback
// actually pauses.
function setSleepTimer(mins){
  if(isNaN(mins)||mins<1){toast('Enter a valid number (min: 1)',1600,'alert');return;}
  clearSleepTimer();
  _sleepEndTime=Date.now()+mins*60*1000;
  _sleepTimer=setTimeout(()=>{
    _userPaused=true;
    video.pause(); setPlayIcon(false); pw.classList.add('paused');
    clearSleepIndicator();
    toast('Sleep timer — video paused',3000,'moon');
  },mins*60*1000);
  _applyHighlight(mins);
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
  toast('Sleep in '+mins+' min'+(mins===1?'':'s'),1600,'moon');
}
// Cancels the sleep timer entirely (user pressed "Clear"/cancelled it) —
// as opposed to clearSleepIndicator() below, which only hides the
// countdown badge (used once the timer legitimately fires and pauses).
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
  clearSleepTimer(); closeSleepModal(); toast('Sleep timer cancelled',1600,'moon');
});
document.getElementById('sleepModalBackdrop').addEventListener('click',e=>{
  if(e.target===document.getElementById('sleepModalBackdrop')) closeSleepModal();
});
// The floating "sleep in X:XX" badge itself is clickable: tap it to
// cancel the timer directly, or (if somehow shown with no timer running)
// reopen the modal.
$sleepIndicator.addEventListener('click',()=>{
  if(_sleepTimer){clearSleepTimer();toast('Sleep timer cancelled',1600,'moon');}
  else openSleepModal();
});