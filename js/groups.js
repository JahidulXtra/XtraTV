// ─── Sort ───
let _sortMode='default';
try{const s=localStorage.getItem(SORT_KEY);if(s&&['default','az','za'].includes(s))_sortMode=s;}catch(e){}


// ─── Render ───
function renderAll(scrollSidebar=false){computeFiltered();_lastGroupRenderKey='';renderGroupList(scrollSidebar);renderGrid();}

let _histUidSet=new Set(), _histCacheLen=-1;
function _getHistUidSet(){
  if(_history.length!==_histCacheLen){
    _histUidSet=new Set(_history.map(h=>h.uid));
    _histCacheLen=_history.length;
  }
  return _histUidSet;
}

function computeFiltered(){
  const histUidSet=_getHistUidSet();
  const counts={all:0,__favs__:0,__history__:0};
  const catCounts={};
  filtered_=[];
  // Cache lowercase search to avoid repeated calls in hot loop
  const q=searchQ; // already lowercase
  const isSpecialCat=currentCat==='all'||currentCat==='__favs__'||currentCat==='__history__';
  const currentCatLow=isSpecialCat?'':currentCat.toLowerCase();
  const searchSrc=q
    ?channels.filter(ch=>(ch._nameLow||ch.name.toLowerCase()).includes(q)||(ch._catLow||(ch.category||'').toLowerCase()).includes(q))
    :channels;

  for(const ch of searchSrc){
    counts.all++;
    const c=ch.category||'';
    if(c) catCounts[c]=(catCounts[c]||0)+1;
    if(isFav(ch.uid)) counts.__favs__++;
    if(histUidSet.has(ch.uid)) counts.__history__++;

    let cOk;
    if(currentCat==='all') cOk=true;
    else if(currentCat==='__favs__') cOk=isFav(ch.uid);
    else if(currentCat==='__history__') cOk=histUidSet.has(ch.uid);
    else cOk=(ch._catLow||(ch.category||'').toLowerCase())===currentCatLow;
    if(cOk) filtered_.push(ch);
  }

  if(currentCat==='__history__'&&!searchQ){
    const histIdx=new Map(_history.map((h,i)=>[h.uid,i]));
    filtered_.sort((a,b)=>(histIdx.get(a.uid)??999)-(histIdx.get(b.uid)??999));
  } else {
    if(_sortMode==='az') filtered_.sort((a,b)=>a._nameLow<b._nameLow?-1:a._nameLow>b._nameLow?1:0);
    else if(_sortMode==='za') filtered_.sort((a,b)=>b._nameLow<a._nameLow?-1:b._nameLow>a._nameLow?1:0);
  }
  // Fallback: if search returns nothing in current cat, show all matches
  if(!filtered_.length&&currentCat!=='all'&&searchQ){
    const fallback=searchSrc.slice();
    if(fallback.length){filtered_=fallback;currentCat='all';_lastGroupRenderKey='';}
  }
  const catLabel=currentCat==='all'?'All Channels':currentCat==='__favs__'?'Favourites':currentCat==='__history__'?'History':currentCat;
  $gridTitle.textContent=catLabel;
  $gridCount.textContent=filtered_.length+(filtered_.length===1?' Channel':' Channels');
  if($clearHistoryBtn) $clearHistoryBtn.style.display=(currentCat==='__history__'&&_history.length>0)?'inline-block':'none';
  // Store merged counts for renderGroupList
  _lastCounts={...counts,...catCounts};
}

let _lastCounts={all:0,__favs__:0,__history__:0};

function buildCounts(){
  return _lastCounts;
}

let _lastGroupRenderKey='';
function renderGroupList(scrollToActive=false){
  const cats=[...new Set(channels.map(c=>c.category).filter(Boolean))].sort();
  const counts=buildCounts();

  // Build a compact key to detect if re-render is actually needed
  // Use sorted fav UIDs so toggle is correctly detected
  const favsKey=_favs.size>0?[..._favs].sort().join(','):'∅';
  const fKey=`${currentCat}|${favsKey}|${_history.length}|${searchQ}|${cats.join(',')}|${_sortMode}`;
  const needsRebuild=fKey!==_lastGroupRenderKey;
  _lastGroupRenderKey=fKey;

  if(!needsRebuild&&$groupList.children.length>0){
    // Just update active state without rebuilding
    $groupList.querySelectorAll('.group-item').forEach(el=>{
      const cat=el.dataset.cat;
      const isActive=currentCat===cat;
      if(isActive!==el.classList.contains('active')){
        el.classList.toggle('active',isActive);
      }
      // Update badge counts
      const badge=el.querySelector('.group-badge');
      if(badge){
        const c=cat==='all'?counts.all:cat==='__favs__'?counts.__favs__:cat==='__history__'?counts.__history__:(counts[cat]||0);
        if(badge.textContent!==String(c)) badge.textContent=c;
      }
    });
    if(scrollToActive){
      const active=$groupList.querySelector('.group-item.active');
      if(active) active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    }
    return;
  }

  const frag=document.createDocumentFragment();
  function makeGroupItem(cat,icon,label,count){
    const el=document.createElement('div');
    el.className='group-item'+(currentCat===cat?' active':'');
    el.dataset.cat=cat;
    el.innerHTML=`<div class="group-icon">${icon}</div><div class="group-info"><div class="group-name">${xe(label)}</div></div><span class="group-badge">${count}</span>`;
    el.addEventListener('click',()=>filterCat(cat,el));
    frag.appendChild(el);
    return el;
  }
  makeGroupItem('all',ICONS.globe,'All',counts.all);
  if(counts.__favs__>0) makeGroupItem('__favs__',ICONS.starFilled,'Favourites',counts.__favs__);
  if(counts.__history__>0) makeGroupItem('__history__',ICONS.clock,'History',counts.__history__);
  for(const c of cats){
    const cnt=counts[c]||0;
    if(searchQ&&cnt===0) continue;
    makeGroupItem(c,getGroupIcon(c),c,cnt);
  }
  const prevScrollLeft=$groupList.scrollLeft;
  const prevScrollTop=$groupList.scrollTop;
  $groupList.innerHTML=''; $groupList.appendChild(frag);
  // Defer scroll restore so browser has time to lay out new content
  requestAnimationFrame(()=>{
    $groupList.scrollLeft=prevScrollLeft;
    $groupList.scrollTop=prevScrollTop;
    if(scrollToActive){
      const active=$groupList.querySelector('.group-item.active');
      if(active) active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    }
  });
}

function filterCat(c,srcEl){
  if(srcEl){
    srcEl.style.animation='none';
    requestAnimationFrame(()=>{srcEl.style.animation='sidebar-tap .28s cubic-bezier(.34,1.4,.64,1) both';});
    srcEl.addEventListener('animationend',()=>{srcEl.style.animation='';},{once:true});
  }
  if(currentCat===c)return;
  currentCat=c;computeFiltered();renderGroupList(true);renderGrid();
}

// ─── Sort dropdown popup ───
(()=>{
  const btn=document.getElementById('sortBtn');
  const popup=document.getElementById('sortPopup');
  if(!btn||!popup) return;

  function updateSortUI(){
    const labels={default:{icon:ICONS.sort,text:'Sort'},az:{icon:ICONS.arrowUp,text:'A→Z'},za:{icon:ICONS.arrowDown,text:'Z→A'}};
    const cur=labels[_sortMode]||labels.default;
    btn.innerHTML='<span class="ic" aria-hidden="true">'+cur.icon+'</span> '+cur.text+' <span class="sort-chevron ic">'+ICONS.chevronDown+'</span>';
    btn.classList.toggle('active',_sortMode!=='default');
    popup.querySelectorAll('.sort-opt').forEach(o=>{
      o.classList.toggle('active',o.dataset.sort===_sortMode);
    });
  }

  function openPopup(){
    popup.classList.add('open');
    btn.classList.add('popup-open');
    // Close other popups
    speedPopup.classList.remove('open');
    fitPopup.classList.remove('open');
    if(window._closeQualityPopup) window._closeQualityPopup();
  }
  function closePopup(){
    popup.classList.remove('open');
    btn.classList.remove('popup-open');
  }

  updateSortUI();

  btn.addEventListener('click',(e)=>{
    e.stopPropagation();
    popup.classList.contains('open')?closePopup():openPopup();
  });

  popup.addEventListener('click',(e)=>{
    e.stopPropagation();
    const opt=e.target.closest('.sort-opt');
    if(!opt) return;
    const newSort=opt.dataset.sort;
    closePopup();
    if(newSort===_sortMode) return;
    _sortMode=newSort;
    try{localStorage.setItem(SORT_KEY,_sortMode);}catch(ex){}
    updateSortUI();
    renderAll();
    toast(newSort==='az'?'Sorted A→Z':newSort==='za'?'Sorted Z→A':'Default order',1600,newSort==='az'?'arrowUp':newSort==='za'?'arrowDown':'sort');
  });

  window._closeSortPopup=closePopup;
})();

