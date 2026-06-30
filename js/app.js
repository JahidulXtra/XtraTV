/* ===== Main App: bootstrap / init — MUST load last, after every other js/*.js file ===== */
// ─── Init ───
ensureHls(()=>{});
fetchChannels();

window.addEventListener('beforeunload',()=>{
  stopProgressTimer();
  clearTimeout(_searchDebounce);clearTimeout(_tt);clearTimeout(_ctrlTimer);
  clearTimeout(_stalledTimer);clearTimeout(_watchdogTimer);clearAuto();
  clearTimeout(_volSaveTimer);clearTimeout(_sleepTimer);clearTimeout(_sleepCountdownTimer);
  clearTimeout(_endedTimer);clearTimeout(_waitingTimer);
  clearInterval(_loadStatusTimer);
  destroyPreload();
  if(hlsObj){try{hlsObj.destroy();}catch(e){}}
  if(_fetchAbort){try{_fetchAbort.abort();}catch(e){}}
  if(_bgRefreshAbort){try{_bgRefreshAbort.abort();}catch(e){}}
  if(_imgObserver){try{_imgObserver.disconnect();}catch(e){}}
});
