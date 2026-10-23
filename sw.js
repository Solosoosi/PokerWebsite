// Keeps the site opening without internet. Pages, scripts, fonts and photos are fetched fresh when online
// (so updates show at once) and served from this cache when not. The PeerJS server is never cached.
var CACHE="hpl-v1";
var HOSTS=[self.location.host,"unpkg.com","cdn.jsdelivr.net","fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install",function(){ self.skipWaiting(); });
self.addEventListener("activate",function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch",function(e){
  var req=e.request, url=new URL(req.url);
  if(req.method!=="GET"||HOSTS.indexOf(url.host)<0) return;
  var same=url.host===self.location.host;
  e.respondWith(fetch(req).then(function(res){
    if(res.ok||res.type==="opaque"){ var copy=res.clone(); caches.open(CACHE).then(function(c){ c.put(req,copy); }); }
    return res;
  }).catch(function(){
    // remote.html?room=... and the plain remote.html are the same page.
    return caches.match(req,{ignoreSearch:same}).then(function(hit){ return hit||Response.error(); });
  }));
});
