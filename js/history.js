// Watch history: most-recently-watched channel first, capped at
// HISTORY_MAX entries. Stores a lightweight snapshot (uid/name/category/
// logo) rather than a reference to the live channel object, so history
// still displays correctly even if that channel later disappears from a
// refreshed channel list.
const HISTORY_MAX=12;
let _history=[];
try{const h=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(Array.isArray(h))_history=h;}catch(e){}
// Called every time a channel starts playing (see playChannel in
// channels.js). Moves it to the front if already present (so re-watching
// bumps it up rather than creating a duplicate), then trims to
// HISTORY_MAX. _histCacheLen=-1 invalidates groups.js's cached history-uid
// Set so the sidebar's History count/badge picks up the change.
function pushHistory(ch){
  _history=_history.filter(h=>h.uid!==ch.uid);
  _history.unshift({uid:ch.uid,name:ch.name,category:ch.category,logo:ch.logo});
  if(_history.length>HISTORY_MAX) _history=_history.slice(0,HISTORY_MAX);
  _histCacheLen=-1;
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(_history));}catch(e){}
}
// Wipes watch history (triggered by the "Clear" button, only visible
// while viewing the History tab). If the user was looking at History when
// they clear it, switches them back to "All" so they're not left staring
// at an empty category.
function clearHistory(){
  if(!_history.length) return;
  _history=[];
  _histCacheLen=-1;
  try{localStorage.removeItem(HISTORY_KEY);}catch(e){}
  if(currentCat==='__history__') currentCat='all';
  renderAll(true);
  toast('Watch history cleared',1600,'trash');
}

if($clearHistoryBtn) $clearHistoryBtn.addEventListener('click',clearHistory);