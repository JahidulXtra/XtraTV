// ─── Watch History ───
const HISTORY_MAX=12;
let _history=[];
try{const h=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(Array.isArray(h))_history=h;}catch(e){}
function pushHistory(ch){
  _history=_history.filter(h=>h.uid!==ch.uid);
  _history.unshift({uid:ch.uid,name:ch.name,category:ch.category,logo:ch.logo});
  if(_history.length>HISTORY_MAX) _history=_history.slice(0,HISTORY_MAX);
  _histCacheLen=-1; // invalidate cache
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(_history));}catch(e){}
}
function clearHistory(){
  if(!_history.length) return;
  _history=[];
  _histCacheLen=-1; // invalidate cache
  try{localStorage.removeItem(HISTORY_KEY);}catch(e){}
  if(currentCat==='__history__') currentCat='all';
  renderAll(true);
  toast('Watch history cleared',1600,'trash');
}


// ─── Clear History button ───
if($clearHistoryBtn) $clearHistoryBtn.addEventListener('click',clearHistory);

