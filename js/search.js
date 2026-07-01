// Desktop search box. Debounced (150ms) so filtering/re-rendering doesn't
// run on every single keystroke, and mirrors its value into the mobile
// search input so both stay in sync no matter which one the user typed in.
const $searchClear=document.getElementById('searchClear');
document.getElementById('searchInput').addEventListener('input',function(){
  clearTimeout(_searchDebounce);
  const val=this.value;
  const mobInp=document.getElementById('mobSearchInput');
  if(mobInp) mobInp.value=val;
  $searchClear.classList.toggle('visible',val.length>0);
  _searchDebounce=setTimeout(()=>{searchQ=val.trim().toLowerCase();renderAll();},150);
});
// The little "x" button that clears the search box (and re-syncs mobile).
$searchClear.addEventListener('click',()=>{
  const inp=document.getElementById('searchInput');
  inp.value='';
  const mobInp=document.getElementById('mobSearchInput');
  if(mobInp) mobInp.value='';
  $searchClear.classList.remove('visible');
  searchQ=''; renderAll(); inp.focus();
});

// Mobile full-screen search overlay (separate UI from the desktop search
// box, but kept in sync with it via the mirroring above). Silently no-ops
// if the mobile search button isn't present in the DOM (desktop-only layout).
(()=>{
  const btn=document.getElementById('mobSearchBtn');
  const overlay=document.getElementById('mobSearchOverlay');
  const inp=document.getElementById('mobSearchInput');
  const close=document.getElementById('mobSearchClose');
  if(!btn) return;
  btn.addEventListener('click',()=>{overlay.classList.add('open');setTimeout(()=>inp.focus(),80);});
  // clearQuery=true wipes the search text on close (Escape/X button);
  // false just closes the overlay and keeps whatever was typed (Enter —
  // the user is done searching but wants the filtered grid to stay applied).
  function closeMobSearch(clearQuery){
    overlay.classList.remove('open');
    setTimeout(()=>inp.blur(),50);
    if(clearQuery&&inp.value){
      clearTimeout(_searchDebounce);
      inp.value='';
      const di=document.getElementById('searchInput'); if(di) di.value='';
      const cb=document.getElementById('searchClear'); if(cb) cb.classList.remove('visible');
      searchQ=''; renderAll();
    }
  }
  close.addEventListener('click',()=>closeMobSearch(true));
  inp.addEventListener('input',function(){
    clearTimeout(_searchDebounce);
    const val=this.value;
    const di=document.getElementById('searchInput');
    if(di&&di.value!==val) di.value=val;
    const cb=document.getElementById('searchClear'); if(cb) cb.classList.toggle('visible',val.length>0);
    _searchDebounce=setTimeout(()=>{searchQ=val.trim().toLowerCase();renderAll();},150);
  });  inp.addEventListener('keydown',e=>{
    if(e.key==='Escape') closeMobSearch(true);
    else if(e.key==='Enter') closeMobSearch(false);
  });
})();