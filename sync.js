// Live sync between the TV and phones, peer-to-peer over PeerJS (no account needed).
// The TV owns a room (a fixed peer id) and relays; every phone keeps its own copy of the data.
// Conflict rule: the copy with the newest `updatedAt` (in TV time) wins; remote.html merges what it lost.
// A remote opened on the TV's own computer also talks to it over a BroadcastChannel, which needs no
// internet and no PeerJS server.
(function(){
  "use strict";
  var PREFIX="hpl-room-", RETRY_MS=3000, PING_MS=5000, DEAD_MS=12000, CONNECT_MS=8000, HERE_MS=3000, OFFSET_KEY="pokerLeague.tvOffset";

  function newRoomCode(){
    var a="ABCDEFGHJKMNPQRSTUVWXYZ23456789",s="";
    for(var i=0;i<6;i++)s+=a[Math.floor(Math.random()*a.length)];
    return s;
  }
  function newer(a,b){ return !b || (a&&(a.updatedAt||0)>=(b.updatedAt||0)); }
  function channel(room){ return ("BroadcastChannel" in window)?new BroadcastChannel(PREFIX+room):null; }

  // TV side. h = {initial, onState(state), onStatus(status, phoneCount)}
  function host(room,h){
    var peer=null, conns=[], state=h.initial||null, retry=null, bc=channel(room);
    function status(s){ if(h.onStatus)h.onStatus(s,conns.length); }
    function drop(c){ conns=conns.filter(function(o){return o!==c;}); status(peer&&peer.open?"ready":"reconnecting"); }
    // from: the PeerJS connection it came on, or "bc" for this computer.
    function incoming(s,from){
      if(newer(s,state)){
        state=s; h.onState(state);
        conns.forEach(function(o){ if(o!==from&&o.open)o.send({t:"state",state:state}); });
        if(bc&&from!=="bc") bc.postMessage({t:"state",state:state,tv:true});
      } else if(from==="bc"){ bc.postMessage({t:"state",state:state,tv:true}); }
      else { from.send({t:"state",state:state}); } // that phone was behind: hand it the newer copy
    }
    function open(){
      peer=new Peer(PREFIX+room);
      peer.on("open",function(){ status("ready"); });
      peer.on("connection",function(c){
        c.on("open",function(){ conns.push(c); status("ready"); if(state)c.send({t:"state",state:state}); });
        c.on("data",function(m){
          if(!m)return;
          if(m.t==="ping"){ c.send({t:"pong",c:m.c,tv:Date.now()}); return; }
          if(m.t==="state"&&m.state) incoming(m.state,c);
        });
        c.on("close",function(){ drop(c); });
        c.on("error",function(){ drop(c); });
      });
      peer.on("disconnected",function(){ status("reconnecting"); if(!peer.destroyed)peer.reconnect(); });
      peer.on("error",function(e){
        // After a refresh the server can hold our old id for a few seconds, so keep retrying.
        if(e.type==="peer-unavailable")return;
        status("reconnecting");
        conns=[]; peer.destroy(); clearTimeout(retry); retry=setTimeout(open,RETRY_MS);
      });
    }
    if(bc){
      bc.onmessage=function(e){
        var m=e.data; if(!m||m.tv)return;
        if(m.t==="hello") bc.postMessage(state?{t:"state",state:state,tv:true}:{t:"here",tv:true});
        else if(m.t==="state"&&m.state) incoming(m.state,"bc");
      };
      setInterval(function(){ bc.postMessage({t:"here",tv:true}); },HERE_MS);
    }
    open();
    return { phones:function(){ return conns.length; } };
  }

  // Phone side. h = {getState(), onState(state), onStatus(status)}
  function join(room,h){
    var peer=null, conn=null, retry=null, lastPong=0, best=Infinity, bc=channel(room), lastHere=0, peerStatus="connecting";
    var offset=0; try{ offset=+localStorage.getItem(OFFSET_KEY)||0; }catch(e){}
    function local(){ return Date.now()-lastHere<HERE_MS*2.5; }
    function peerOpen(){ return !!(conn&&conn.open); }
    function online(){ return peerOpen()||local(); }
    function status(s){ if(s)peerStatus=s; if(h.onStatus)h.onStatus(online()?"online":peerStatus); }
    function later(){ clearTimeout(retry); retry=setTimeout(connect,RETRY_MS); }
    function connect(){
      clearTimeout(retry);
      if(peerOpen())return;
      if(!peer||peer.destroyed){
        peer=new Peer();
        peer.on("open",dial);
        peer.on("disconnected",function(){ if(!peer.destroyed)peer.reconnect(); });
        peer.on("error",function(e){
          status(e.type==="peer-unavailable"?"waiting":"offline");
          if(e.type!=="peer-unavailable"){ peer.destroy(); }
          later();
        });
      } else if(peer.open){ dial(); }
      else if(peer.disconnected){ peer.reconnect(); }
    }
    function dial(){
      if(peerOpen())return;
      status("connecting");
      var c=peer.connect(PREFIX+room,{reliable:true});
      conn=c;
      c.on("open",function(){
        if(conn!==c)return;
        status("online"); best=Infinity; lastPong=Date.now();
        [0,300,600].forEach(function(t){ setTimeout(ping,t); });
        var s=h.getState(); if(s)c.send({t:"state",state:s});
      });
      c.on("data",function(m){
        if(!m||conn!==c)return;
        if(m.t==="pong"){
          var now=Date.now(), rtt=now-m.c; lastPong=now;
          if(rtt<best){ best=rtt; offset=m.tv-(m.c+rtt/2); try{localStorage.setItem(OFFSET_KEY,String(offset));}catch(e){} }
        } else if(m.t==="state"&&m.state){ h.onState(m.state); }
      });
      function gone(){ if(conn!==c)return; conn=null; status("offline"); later(); }
      c.on("close",gone);
      c.on("error",gone);
      // A dial sent while the TV was reloading can hang without ever erroring.
      setTimeout(function(){ if(conn===c&&!c.open){ gone(); try{c.close();}catch(e){} } },CONNECT_MS);
    }
    function ping(){ if(peerOpen())conn.send({t:"ping",c:Date.now()}); }
    // Heartbeat: a locked phone can leave a connection that looks open but is dead.
    setInterval(function(){
      if(!peerOpen()){ status(); return; }
      if(Date.now()-lastPong>DEAD_MS){ var c=conn; conn=null; try{c.close();}catch(e){} status("offline"); connect(); }
      else ping();
    },PING_MS);
    if(bc){
      bc.onmessage=function(e){
        var m=e.data; if(!m)return;
        if(m.tv){
          var was=local(); lastHere=Date.now();
          // Same computer as the TV: one clock, so no offset.
          if(!was){ offset=0; status(); var s=h.getState(); if(s)bc.postMessage({t:"state",state:s}); }
        }
        if(m.t==="state"&&m.state) h.onState(m.state);
      };
      bc.postMessage({t:"hello"});
      setInterval(function(){ if(!local())status(); },HERE_MS);
    }
    document.addEventListener("visibilitychange",function(){ if(!document.hidden){ connect(); if(bc)bc.postMessage({t:"hello"}); } });
    connect();
    return {
      send:function(s){ if(peerOpen())conn.send({t:"state",state:s}); if(bc)bc.postMessage({t:"state",state:s}); },
      now:function(){ return Date.now()+offset; },   // TV clock time
      online:online
    };
  }

  window.Sync={host:host,join:join,newRoomCode:newRoomCode,newer:newer};
})();
