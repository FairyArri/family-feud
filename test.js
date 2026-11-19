const WebSocket=require('ws');const {server}=require('./server');
const assert=require('assert');
function client(port){return new Promise(r=>{const ws=new WebSocket('ws://localhost:'+port+'/ws');const c={ws,s:null,tok:null,msgs:[]};
 ws.on('message',d=>{const m=JSON.parse(d);c.msgs.push(m);if(m.type==='state')c.s=m.s;if(m.type==='joined')c.tok=m.token;});
 ws.on('open',()=>r(c));});}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const tx=(c,m)=>{c.ws.send(JSON.stringify(m));return wait(40)};
(async()=>{
 await new Promise(r=>server.listen(0,r));const port=server.address().port;
 const h=await client(port);await tx(h,{type:'create'});const code=h.s.code;
 const mk=async(n,t)=>{const c=await client(port);await tx(c,{type:'join',code,name:n,team:t});return c};
 const a1=await mk('Ann','A'),a2=await mk('Al','A'),b1=await mk('Bo','B'),b2=await mk('Bea','B');
 await tx(a1,{type:'join',code,name:'ann',team:'A'}); // duplicate name
 assert(a1.msgs.some(m=>m.type==='error'),'dup name rejected');
 const pid=n=>h.s.players.find(p=>p.name===n).id;
 await tx(h,{type:'host',a:'start'});assert.equal(h.s.phase,'lobby','needs leaders');
 await tx(h,{type:'host',a:'leader',pid:pid('Ann')});await tx(h,{type:'host',a:'leader',pid:pid('Bo')});
 await tx(h,{type:'host',a:'start'});assert.equal(h.s.phase,'ready');
 // players never see hidden answers
 assert(a2.s.answers.every(a=>a.t===undefined),'answers hidden from players');
 assert(h.s.answers.every(a=>a.t!==undefined),'host sees key');
 // buzz before open ignored; non-leader ignored
 await tx(b1,{type:'buzz'});assert.equal(h.s.phase,'ready');
 await tx(h,{type:'host',a:'open'});assert.equal(h.s.phase,'buzzing');
 await tx(a2,{type:'buzz'});assert.equal(h.s.phase,'buzzing','non-leader cannot buzz');
 a1.ws.send(JSON.stringify({type:'buzz'}));b1.ws.send(JSON.stringify({type:'buzz'}));await wait(60);
 assert.equal(h.s.phase,'faceoff');const first=h.s.firstTeam;console.log('first buzz:',first,'late ms:',h.s.lateMs);
 const other=first==='A'?'B':'A';
 // first misses, other leader answers correctly -> control
 await tx(h,{type:'host',a:'miss'});assert.equal(h.s.answerer,other);assert.equal(h.s.faceoffMissed?.length,undefined);
 await tx(h,{type:'host',a:'reveal',i:0});assert.equal(h.s.phase,'choose');assert.equal(h.s.control,other);assert.equal(h.s.pot,38);
 // play, reveal 3 more, no strike -> control team wins pot, no steal
 await tx(h,{type:'host',a:'choose',c:'play'});assert.equal(h.s.playing,other);
 for(const i of [1,2,3])await tx(h,{type:'host',a:'reveal',i});
 assert.equal(h.s.phase,'roundEnd');assert.equal(h.s.teams[other].score,100);assert.equal(h.s.teams[first].score,0);
 // round 2: pass, strike, successful steal
 await tx(h,{type:'host',a:'next'});await tx(h,{type:'host',a:'open'});await tx(b1,{type:'buzz'});assert.equal(h.s.firstTeam,'B');
 await tx(h,{type:'host',a:'reveal',i:0});await tx(h,{type:'host',a:'choose',c:'pass'});assert.equal(h.s.playing,'A');
 await tx(h,{type:'host',a:'reveal',i:1});await tx(h,{type:'host',a:'miss'});assert.equal(h.s.phase,'steal');assert.equal(h.s.stealer,'B');
 await tx(h,{type:'host',a:'reveal',i:2});assert.equal(h.s.phase,'roundEnd');assert.equal(h.s.winner,'B');
 const bScore=h.s.teams.B.score;assert.equal(bScore,(other==='B'?100:0)+38+30+18);console.log('steal pot to B:',38+30+18);
 // undo reverts the steal
 await tx(h,{type:'host',a:'undo'});assert.equal(h.s.phase,'steal');assert.equal(h.s.teams.B.score,other==='B'?100:0);
 // failed steal: original team keeps pot
 await tx(h,{type:'host',a:'miss'});assert.equal(h.s.winner,'A');assert.equal(h.s.teams.A.score,(other==="A"?100:0)+68);
 // round 3: both leaders miss -> back to ready
 await tx(h,{type:'host',a:'next'});await tx(h,{type:'host',a:'open'});await tx(a1,{type:'buzz'});
 await tx(h,{type:'host',a:'miss'});await tx(h,{type:'host',a:'miss'});assert.equal(h.s.phase,'ready');assert.equal(h.s.pot,0);
 // reconnect a player by token
 const re=await client(port);await tx(re,{type:'resume',code,token:b1.tok});assert.equal(re.s.you.name,'Bo');assert(re.s.you.leader);
 // host resume
 const h2=await client(port);await tx(h2,{type:'host-resume',code,token:h.tok});assert.equal(h2.s.role,'host');
 // player cannot act as host
 await tx(a2,{type:'host',a:'reset'});assert.notEqual(h.s.phase,'lobby');
 console.log('ALL FLOW TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
