// Obfuscates stream URLs so they don't appear as plain text in view-source/devtools.
// Reversible client-side obfuscation only, not real encryption — the key ships in this same file.
const _K=[0x4c,0x53,0x42,0x44,0x37,0x29,0x5a,0x71,0x1f,0x3e,0x88,0xa2,0x5c,0x17,0x63,0x4b];
// XOR's the UTF-8 bytes against the repeating key, base64-encodes the
// result, then reverses the base64 string (one more trivial speed bump
// against a casual glance in devtools). Built in CHUNK-sized pieces
// because String.fromCharCode.apply(null, hugeArray) can hit a call-stack
// / argument-limit error on very long strings.
function _enc(s){
  const b=new TextEncoder().encode(s);
  const x=new Uint8Array(b.length);
  for(let i=0;i<b.length;i++) x[i]=b[i]^_K[i%_K.length];
  let bin='';
  const CHUNK=8192;
  for(let i=0;i<x.length;i+=CHUNK) bin+=String.fromCharCode.apply(null,x.subarray(i,i+CHUNK));
  return btoa(bin).replace(/=/g,'').split('').reverse().join('');
}
// Reverses _enc(): un-reverse the string, restore base64 padding (stripped
// by _enc), decode, then XOR back with the same key. Wrapped in try/catch
// and returns '' on failure so a corrupted/foreign value never throws and
// breaks playback — it just fails to resolve to a URL.
function _dec(s){
  try{
    const arr=s.split('');arr.reverse();const r=arr.join('');
    const p=r+'='.repeat((4-r.length%4)%4);
    const bin=atob(p);
    const len=bin.length;
    const b=new Uint8Array(len);
    for(let i=0;i<len;i++) b[i]=bin.charCodeAt(i)^_K[i%_K.length];
    return new TextDecoder().decode(b);
  }catch(e){ return ''; }
}
// Minimal HTML-escaping for safely interpolating untrusted strings (channel
// names, error messages, etc.) into innerHTML template strings — escapes
// just the characters that matter for that (&, ", <).
function xe(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}

// Memoized wrapper around _dec(): decoding runs on every channel-card
// render (logoHTML/grid building), so caching results avoids redoing the
// same XOR+base64 work repeatedly for the same encoded url. Capped at
// MAX entries with simple FIFO eviction (oldest inserted key first) —
// not true LRU, but good enough since channel lists are small and mostly
// static within a session.
const _decCached=(function(_decImpl){
  const _decCache=new Map();
  const MAX=400;
  return function(s){
    if(!s) return '';
    let r=_decCache.get(s);
    if(r!==undefined) return r;
    r=_decImpl(s);
    if(_decCache.size>=MAX){
      _decCache.delete(_decCache.keys().next().value);
    }
    _decCache.set(s,r);
    return r;
  };
})(_dec);