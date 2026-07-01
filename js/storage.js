// --- Config ---------------------------------------------------------
// This file loads first (see README load order), so these constants and
// the global state block below are available to every other JS file.
// JSON_URL is the channel list source — see README "Configuration" for
// how to point this at your own list instead.
const JSON_URL = 'https://cdn.jsdelivr.net/gh/bugsfreeweb/LiveTVCollector@main/LiveTV/Bangladesh/LiveTV.json';
const CACHE_KEY = 'xtra_tv_channels';
const CACHE_TS_KEY = 'xtra_tv_cache_ts';
const CACHE_TTL = 10 * 60 * 1000;
const VOL_KEY = 'xtra_tv_volume';
const LAST_CH_KEY = 'xtra_tv_last_channel';
const FIT_KEY = 'xtra_tv_fit';
const FAVS_KEY = 'xtra_tv_favs';
const HISTORY_KEY = 'xtra_tv_history';
const SORT_KEY = 'xtra_tv_sort';

// --- Global app state -------------------------------------------------
// Shared mutable state used across every JS file (no modules/bundler —
// see README Architecture Notes). Grouped here rather than declared
// locally in whichever file happens to use them first, so it's obvious at
// a glance what state the app carries as a whole.
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
// Replaces the active channel list everywhere it's indexed: the plain
// array (`channels`, used for iteration/search) and the id->channel Map
// (`channelsById`, used for O(1) lookups when playing/rendering a
// specific channel). Also clears the logo-HTML cache since it's keyed by
// channel id and a fresh list may reuse ids for different channels.
function setChannels(chs){
  channels=chs;
  channelsById=new Map(chs.map(c=>[c.id,c]));
  _logoCache.clear();
}