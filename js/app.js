// App bootstrap — must be the LAST <script> in index.html.
// It calls functions and reads globals (hlsObj, _fetchAbort, timer IDs, etc.)
// that are defined in the other js/ files, so it has to load after all of them.
// See the script load-order table in README.md.

// Start loading hls.js from the CDN right away (in the background) so it's
// already cached by the time the user actually picks a channel.
ensureHls(()=>{});

// Load the channel list — from the 10-min localStorage cache if it's fresh,
// otherwise from JSON_URL — and render the grid.
fetchChannels();

// Cleanup when the tab is closing/navigating away. Not strictly required
// (the browser will clean up anyway), but it cancels in-flight fetches,
// clears pending timers, and destroys the hls.js instance so nothing tries
// to run after the page is gone. Everything is wrapped in try/catch because
// throwing inside beforeunload can block/delay the navigation.
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