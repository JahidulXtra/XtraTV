/* ===== Helper Functions (id obfuscation encode/decode, HTML escaping) ===== */
const _K=[0x4c,0x53,0x42,0x44,0x37,0x29,0x5a,0x71,0x1f,0x3e,0x88,0xa2,0x5c,0x17,0x63,0x4b];
function _enc(s){
  const b=new TextEncoder().encode(s);
  const x=new Uint8Array(b.length);
  for(let i=0;i<b.length;i++) x[i]=b[i]^_K[i%_K.length];
  // Use chunk approach to avoid stack overflow on large URLs with apply()
  let bin='';
  const CHUNK=8192;
  for(let i=0;i<x.length;i+=CHUNK) bin+=String.fromCharCode.apply(null,x.subarray(i,i+CHUNK));
  return btoa(bin).replace(/=/g,'').split('').reverse().join('');
}
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
function xe(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}

// Wrap _dec with a URL decode cache (LRU-lite: evict oldest entry when full)
const _decCached=(function(_decImpl){
  const _decCache=new Map();
  const MAX=400;
  return function(s){
    if(!s) return '';
    let r=_decCache.get(s);
    if(r!==undefined) return r;
    r=_decImpl(s);
    if(_decCache.size>=MAX){
      // Evict the oldest (first) entry
      _decCache.delete(_decCache.keys().next().value);
    }
    _decCache.set(s,r);
    return r;
  };
})(_dec);

