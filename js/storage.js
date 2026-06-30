/* ===== Config (storage keys / cache settings) + global app state ===== */
// ─── CONFIG ───
// Live channel source (remote). To test/demo with the local sample list instead,
// comment this line out and uncomment the one below — see data/channels.json
// for the expected schema (flat array of {name, category, logo, url}).
const JSON_URL = 'https://cdn.jsdelivr.net/gh/bugsfreeweb/LiveTVCollector@main/LiveTV/Bangladesh/LiveTV.json';
// const JSON_URL = 'data/channels.json';
const CACHE_KEY = 'xtra_tv_channels_v3';
const CACHE_TS_KEY = 'xtra_tv_cache_ts_v3';
const CACHE_TTL = 10 * 60 * 1000;
const VOL_KEY = 'xtra_tv_volume';
const LAST_CH_KEY = 'xtra_tv_last_channel';
const FIT_KEY = 'xtra_tv_fit';
const FAVS_KEY = 'xtra_tv_favs';
const HISTORY_KEY = 'xtra_tv_history';
const SORT_KEY = 'xtra_tv_sort';


// ─── State ───
let channels=[], filtered_=[], currentChannel=null, currentEnc=null,
    hlsObj=null, currentCat='all', searchQ='',
    retryCount=0, autoRetryTimer=null, _muted=false, _ctrlTimer=null,
    fitMode='contain', _curSpeed=1, _isVod=false, _isDirectPlay=false,
    _stalledTimer=null, _tt=null,
    _searchDebounce=null, _watchdogTimer=null,
    _rafLoopRunning=false, _userVolume=0.3,
    _preloadHls=null, _preloadTimer=null,
    _theaterMode=false, _userPaused=false, _endedTimer=null,
    _qualityLevels=[], _qualityHls=null, _autoLiveTimer=null;
const gridElMap=new Map();
let channelsById=new Map();
function setChannels(chs){
  channels=chs;
  channelsById=new Map(chs.map(c=>[c.id,c]));
  _logoCache.clear();
}

