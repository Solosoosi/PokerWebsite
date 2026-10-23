// League rules and the blinds clock, shared by tv.html and remote.html.
// The points rules mirror index.html; change both if the rules change.
(function(){
  "use strict";
  var PLACE_PTS={1:12,2:8,3:6,4:4,5:3,6:2,7:1};
  var ROUNDS=5, KO_VALUE=0.5, FINAL_MULT=1.5;
  var LEVELS=[
    {big:5,  small:1,  mins:30, note:"Re-entry open"},
    {big:10, small:5,  mins:45, note:"Re-entry open"},
    {big:25, small:10, mins:60, note:"Last level with re-entry"},
    {big:50, small:25, mins:60, note:"Freezeout"},
    {big:100,small:50, mins:null,note:"Heads-up · play to the finish"}
  ];

  // Same shape index.html saves under LS_KEY, so the phone's standings page sees every change.
  var LS_KEY="pokerLeague.v1";
  function normalize(s,base){
    s=s||{}; base=base||{};
    var players=(Array.isArray(s.players)&&s.players.length)?s.players:(base.players||[]);
    players=players.map(function(p,i){return {id:p.id||("p"+(i+1)),name:p.name!=null?p.name:("Player "+(i+1))};});
    function rule(k){ return (s.rules&&k in s.rules)?!!s.rules[k]:true; }
    return {
      leagueName:s.leagueName||base.leagueName||"The League",
      cadence:s.cadence||base.cadence||"weekly",
      players:players,
      places:s.places||base.places||{},
      kos:s.kos||base.kos||{},
      rules:{dropWorst:rule("dropWorst"),finalMultiplier:rule("finalMultiplier"),koBonus:rule("koBonus")}
    };
  }

  function playerScore(league,pid){
    var places=league.places[pid]||[], scored=[], firsts=0;
    for(var r=0;r<ROUNDS;r++){
      var pl=places[r]; if(!pl) continue;
      var s=PLACE_PTS[pl]||0;
      if(r===ROUNDS-1 && league.rules.finalMultiplier) s*=FINAL_MULT;
      if(pl===1) firsts++;
      scored.push(s);
    }
    var counted=scored.slice();
    if(league.rules.dropWorst && scored.length===ROUNDS) counted.splice(counted.indexOf(Math.min.apply(null,scored)),1);
    var total=counted.reduce(function(a,b){return a+b;},0), kos=league.kos[pid]||0;
    if(league.rules.koBonus) total+=kos*KO_VALUE;
    return {total:total,firsts:firsts,kos:kos,played:scored.length};
  }
  function standings(league){
    var rows=league.players.map(function(p){var sc=playerScore(league,p.id);return{id:p.id,name:p.name,total:sc.total,firsts:sc.firsts,kos:sc.kos,played:sc.played};});
    rows.sort(function(a,b){return b.total-a.total||b.firsts-a.firsts||b.kos-a.kos||a.name.localeCompare(b.name);});
    return rows;
  }

  // Clock state is {i, running, endAt, remaining}; endAt is in TV clock time.
  // Every device works out the current level from it, so nobody has to write when a level rolls over.
  function newClock(){ return {i:0,running:false,endAt:0,remaining:LEVELS[0].mins*60}; }
  function clockAt(c,now){
    var i=c.i, L=LEVELS[i];
    if(L.mins==null) return {i:i,remaining:0,running:false,final:true};
    if(!c.running) return {i:i,remaining:c.remaining,running:false,final:false};
    var end=c.endAt;
    while(now>=end){
      i++; L=LEVELS[i];
      if(L.mins==null) return {i:i,remaining:0,running:false,final:true};
      end+=L.mins*60000;
    }
    return {i:i,remaining:Math.ceil((end-now)/1000),running:true,final:false};
  }
  function clockStart(c,now){
    var v=clockAt(c,now); if(v.final) return c;
    var rem=v.remaining>0?v.remaining:LEVELS[v.i].mins*60;
    return {i:v.i,running:true,endAt:now+rem*1000,remaining:rem};
  }
  function clockPause(c,now){
    var v=clockAt(c,now);
    return {i:v.i,running:false,endAt:0,remaining:v.remaining};
  }
  function clockReset(c,now){
    var v=clockAt(c,now); if(v.final) return c;
    var full=LEVELS[v.i].mins*60;
    return {i:v.i,running:v.running,endAt:v.running?now+full*1000:0,remaining:full};
  }
  function clockAdjust(c,now,secs){
    var v=clockAt(c,now); if(v.final) return c;
    var rem=Math.max(1,v.remaining+secs);
    return {i:v.i,running:v.running,endAt:v.running?now+rem*1000:0,remaining:rem};
  }
  function clockSetLevel(c,now,i){
    var v=clockAt(c,now); i=Math.max(0,Math.min(LEVELS.length-1,i));
    var L=LEVELS[i], full=L.mins!=null?L.mins*60:0, run=v.running&&L.mins!=null;
    return {i:i,running:run,endAt:run?now+full*1000:0,remaining:full};
  }

  // Game night: night = {round, playing:[pid], busts:[{v, k, re, lvl}], applied}.
  // A bust with re=true was a re-entry; only a final bust (re=false) sets a place. Every bust is a KO for k;
  // k is null when the player left the game (no KO for anyone).
  var MAX_ENTRIES=2, REENTRY_LAST_LEVEL=2; // re-entry closes at the end of Level 3
  function nextRound(league){
    for(var r=0;r<ROUNDS;r++){
      var used=league.players.some(function(p){ return (league.places[p.id]||[])[r]; });
      if(!used) return r+1;
    }
    return ROUNDS;
  }
  function newId(){ return Math.random().toString(36).slice(2,10); }
  // Each bust also carries {id, at, by}: a unique id, when it was recorded (TV time) and which device
  // recorded it, so two phones' lists can be merged. `removed` keeps the ids of deleted busts for the same reason.
  function newNight(league){
    return {id:newId(),round:nextRound(league),playing:league.players.map(function(p){return p.id;}),guests:[],busts:[],removed:[],applied:{kos:{},placed:false}};
  }
  // Nights saved before these fields existed: fill them in the same way on every device.
  function fixNight(n,league){
    // A device's very first night has the same id everywhere, so phones that never synced still agree.
    if(!n){ n=newNight(league); n.id="n0"; return n; }
    n.id=n.id||"n0"; n.guests=n.guests||[]; n.removed=n.removed||[]; n.applied=n.applied||{kos:{},placed:false};
    n.busts=(n.busts||[]).map(function(b,i){ if(!b.id) b.id="L"+i+b.v+(b.k||""); if(b.at==null) b.at=i; return b; });
    return n;
  }
  function isGuest(night,pid){ return night.guests.some(function(g){ return g.id===pid; }); }
  function playerName(league,night,pid){
    var p=league.players.filter(function(x){return x.id===pid;})[0]||(night?night.guests:[]).filter(function(g){return g.id===pid;})[0];
    return p?p.name:"?";
  }
  function nightView(night){
    var info={}, outOrder=[];
    night.playing.forEach(function(pid){ info[pid]={entries:1,out:false,place:null,kos:0,guest:isGuest(night,pid)}; });
    night.busts.forEach(function(b){
      if(info[b.k]) info[b.k].kos++;
      var v=info[b.v]; if(!v) return;
      if(b.re) v.entries++; else { v.out=true; outOrder.push(b.v); }
    });
    // Places rank league players only, so a guest never pushes anyone down; guests get no place.
    var nL=night.playing.filter(function(pid){ return !info[pid].guest; }).length;
    outOrder.filter(function(pid){ return !info[pid].guest; }).forEach(function(pid,idx){ info[pid].place=nL-idx; });
    var alive=night.playing.filter(function(pid){ return !info[pid].out; });
    var done=night.playing.length>1&&alive.length===1;
    if(done&&!info[alive[0]].guest) info[alive[0]].place=1;
    return {info:info,alive:alive,done:done,winner:done?alive[0]:null};
  }
  // After two phones' lists are merged, drop what no longer makes sense: the same bust recorded on two
  // phones (same player, different device, within 2 minutes), or a bust involving someone already out.
  function cleanBusts(night,busts){
    var st={}, kept=[];
    night.playing.forEach(function(pid){ st[pid]={entries:1,out:false}; });
    busts.forEach(function(b){
      var v=st[b.v], k=b.k?st[b.k]:null;
      if(!v||v.out||(b.k&&(!k||k.out||b.k===b.v))) return;
      if(kept.some(function(x){ return x.v===b.v&&x.by!==b.by&&Math.abs(x.at-b.at)<120000; })) return;
      var re=!!b.re&&v.entries<MAX_ENTRIES;
      if(re) v.entries++; else v.out=true;
      kept.push(re===!!b.re?b:Object.assign({},b,{re:re}));
    });
    return kept;
  }
  function canReenter(night,pid,level){
    var v=nightView(night).info[pid];
    return !!v&&v.entries<MAX_ENTRIES&&level<=REENTRY_LAST_LEVEL;
  }

  function fmt(n){ return Number.isInteger(n)?String(n):n.toFixed(1); }
  function fmtClock(s){s=Math.max(0,s|0);var m=Math.floor(s/60),ss=s%60;return m+":"+(ss<10?"0":"")+ss;}
  function ordinal(n){return n+["th","st","nd","rd"][(n%10>3||[11,12,13].indexOf(n%100)>=0)?0:n%10];}
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

  // Player photos live in players/, named after the player: players/Dana.jpg (or .jpeg/.png/.webp,
  // or an all-lowercase name). The first that loads is remembered; with none, the initial shows.
  var PHOTO_EXT=["jpg","jpeg","png","webp"], photoFound={};
  function photoCandidates(name){
    var bases=[name], list=[];
    if(name.toLowerCase()!==name) bases.push(name.toLowerCase());
    bases.forEach(function(b){ PHOTO_EXT.forEach(function(e){ list.push("players/"+encodeURIComponent(b)+"."+e); }); });
    return list;
  }
  function photoOk(img){ photoFound[img.dataset.name]=img.getAttribute("src"); }
  function photoNext(img){
    var name=img.dataset.name, found=photoFound[name], list=photoCandidates(name), i=+img.dataset.try+1;
    if(found&&img.getAttribute("src")!==found){ img.src=found; return; }
    if(found||i>=list.length){ photoFound[name]=false; img.remove(); return; }
    img.dataset.try=i; img.src=list[i];
  }
  function avatar(name){
    name=name||"?";
    var html='<div class="avatar">'+esc(name.charAt(0).toUpperCase());
    var known=photoFound[name];
    if(known!==false){
      html+='<img alt="" src="'+esc(known||photoCandidates(name)[0])+'" data-name="'+esc(name)+'" data-try="0"'+
        ' onload="League.photoOk(this)" onerror="League.photoNext(this)">';
    }
    return html+'</div>';
  }

  window.League={
    PLACE_PTS:PLACE_PTS,ROUNDS:ROUNDS,LEVELS:LEVELS,LS_KEY:LS_KEY,
    normalize:normalize,standings:standings,
    newClock:newClock,clockAt:clockAt,clockStart:clockStart,clockPause:clockPause,clockReset:clockReset,clockSetLevel:clockSetLevel,clockAdjust:clockAdjust,
    MAX_ENTRIES:MAX_ENTRIES,newId:newId,newNight:newNight,fixNight:fixNight,playerName:playerName,
    nightView:nightView,cleanBusts:cleanBusts,canReenter:canReenter,
    fmt:fmt,fmtClock:fmtClock,ordinal:ordinal,esc:esc,avatar:avatar,photoOk:photoOk,photoNext:photoNext
  };
})();
