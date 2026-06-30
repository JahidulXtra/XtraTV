// ─── Favourites ───
let _favs=new Set();
try{const f=JSON.parse(localStorage.getItem(FAVS_KEY)||'[]');if(Array.isArray(f))_favs=new Set(f);}catch(e){}
function isFav(uid){return _favs.has(uid);}
function toggleFav(ch){
  const uid=ch.uid;
  if(_favs.has(uid)){_favs.delete(uid);toast('Removed from Favourites',1600,'starOutline');}
  else{_favs.add(uid);toast('Added to Favourites',1600,'starFilled');}
  try{localStorage.setItem(FAVS_KEY,JSON.stringify([..._favs]));}catch(e){}
  const card=gridElMap.get(ch.id)||$channelGrid.querySelector('[data-id="'+ch.id+'"]');
  if(card){
    let star=card.querySelector('.grid-fav-star');
    if(isFav(uid)){
      if(!star){star=document.createElement('div');star.className='grid-fav-star';star.innerHTML=ICONS.starFilled;card.appendChild(star);}
    } else {
      if(star) star.remove();
    }
  }
  if(currentCat==='__favs__'){
    renderAll();
  } else {
    _lastGroupRenderKey='';
    computeFiltered();
    renderGroupList(false);
  }
  _updateFavBtn();
}
let _favsMigrated=false;
function migrateFavs(chs){
  if(_favsMigrated||!_favs.size) return;
  _favsMigrated=true;
  const uidSet=new Set(chs.map(c=>c.uid));
  const byName=new Map();
  for(const c of chs){
    if(!byName.has(c.name)) byName.set(c.name,[]);
    byName.get(c.name).push(c);
  }
  let changed=false;
  const next=new Set();
  for(const entry of _favs){
    if(uidSet.has(entry)){ next.add(entry); continue; }
    const candidates=byName.get(entry);
    if(candidates&&candidates.length===1){ next.add(candidates[0].uid); changed=true; }
    else { next.add(entry); }
  }
  if(changed){
    _favs=next;
    try{localStorage.setItem(FAVS_KEY,JSON.stringify([..._favs]));}catch(e){}
  }
}
const $btnFav=document.getElementById('btnFav');
function _updateFavBtn(){
  if(!$btnFav) return;
  const isCurFav=currentChannel&&isFav(currentChannel.uid);
  $btnFav.title=isCurFav?'Remove from Favourites':'Add to Favourites';
  const icon=document.getElementById('favIcon');
  if(icon){
    icon.setAttribute('fill',isCurFav?'#fbbf24':'none');
    icon.setAttribute('stroke',isCurFav?'#fbbf24':'currentColor');
  }
  $btnFav.style.color=isCurFav?'#fbbf24':'';
  $btnFav.classList.toggle('fav-active',!!isCurFav);
}

