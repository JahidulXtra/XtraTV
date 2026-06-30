// ─── Desktop search (debounced) ───
const $searchClear=document.getElementById('searchClear');
document.getElementById('searchInput').addEventListener('input',function(){
  clearTimeout(_searchDebounce);
  const val=this.value;
  const mobInp=document.getElementById('mobSearchInput');
  if(mobInp) mobInp.value=val;
  $searchClear.classList.toggle('visible',val.length>0);
  _searchDebounce=setTimeout(()=>{searchQ=val.trim().toLowerCase();renderAll();},150);
});
$searchClear.addEventListener('click',()=>{
  const inp=document.getElementById('searchInput');
  inp.value='';
  const mobInp=document.getElementById('mobSearchInput');
  if(mobInp) mobInp.value='';
  $searchClear.classList.remove('visible');
  searchQ=''; renderAll(); inp.focus();
});


// ─── Mobile search overlay ───
(()=>{
  const btn=document.getElementById('mobSearchBtn');
  const overlay=document.getElementById('mobSearchOverlay');
  const inp=document.getElementById('mobSearchInput');
  const close=document.getElementById('mobSearchClose');
  if(!btn) return;
  btn.addEventListener('click',()=>{overlay.classList.add('open');setTimeout(()=>inp.focus(),80);});
  function closeMobSearch(clearQuery){
    overlay.classList.remove('open');
    setTimeout(()=>inp.blur(),50); // defer blur to avoid iOS scroll jump
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

