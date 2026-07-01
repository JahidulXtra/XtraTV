// Favorites are kept in-memory as a Set of channel uid's (see js/channels.js
// _uid) for O(1) lookups, and mirrored to localStorage on every change.
// Alongside the uid, _favNames remembers the channel *name* that uid was
// favorited under (uid -> name). It's not needed for normal favorite
// lookups (those are all by uid), only so migrateFavs() below has
// something to match on if that uid ever stops existing.
let _favs=new Set(), _favNames=new Map();
try{
  const f=JSON.parse(localStorage.getItem(FAVS_KEY)||'[]');
  if(Array.isArray(f)){
    for(const entry of f){
      if(typeof entry==='string') _favs.add(entry); // older format: plain uid strings, no name on record
      else if(entry&&entry.uid){ _favs.add(entry.uid); if(entry.name) _favNames.set(entry.uid,entry.name); }
    }
  }
}catch(e){}
function isFav(uid){return _favs.has(uid);}
function _persistFavs(){
  try{localStorage.setItem(FAVS_KEY,JSON.stringify([..._favs].map(uid=>({uid,name:_favNames.get(uid)||''}))));}catch(e){}
}
// Adds/removes a channel from favorites and keeps every bit of UI that
// shows favorite state in sync: the grid card's star badge, the sidebar
// "Favourites" list/count (if that's the active category), and the
// player's favorite button — without doing a full re-render of everything.
function toggleFav(ch){
  const uid=ch.uid;
  if(_favs.has(uid)){_favs.delete(uid);_favNames.delete(uid);toast('Removed from Favourites',1600,'starOutline');}
  else{_favs.add(uid);_favNames.set(uid,ch.name);toast('Added to Favourites',1600,'starFilled');}
  _persistFavs();
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
// Channel uid's are a hash of name+category+url (see js/channels.js _uid),
// so if the remote channel list changes a category label or tweaks a url,
// a channel the user had favorited gets a *new* uid and the old favorite
// silently "disappears". This runs once per session, right after a fresh
// channel list loads, to patch that up: any saved favorite uid that no
// longer matches a channel is remapped to the new uid of a channel with
// the same name — but only if that name is unambiguous (exactly one
// channel with that name), to avoid guessing wrong when duplicates exist.
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
  const next=new Set(), nextNames=new Map();
  for(const entry of _favs){
    if(uidSet.has(entry)){ next.add(entry); if(_favNames.has(entry)) nextNames.set(entry,_favNames.get(entry)); continue; }
    const name=_favNames.get(entry);
    const candidates=name?byName.get(name):null;
    if(candidates&&candidates.length===1){
      next.add(candidates[0].uid); nextNames.set(candidates[0].uid,candidates[0].name); changed=true;
    } else {
      next.add(entry); if(name) nextNames.set(entry,name);
    }
  }
  if(changed){
    _favs=next; _favNames=nextNames;
    _persistFavs();
  }
}
// Syncs the player's favorite (star) button — icon fill/color and title —
// to whether the currently playing channel is favorited. Called after any
// channel switch and after toggleFav().
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