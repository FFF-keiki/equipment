import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {SheetEventHub} from '../src/worker.js';
const s={revision:''};
let sends=[];
const state={
  storage:{async get(k){return s[k]},async put(k,v){s[k]=v}},
  getWebSockets(){return [{send(v){sends.push(JSON.parse(v));}}]},
  acceptWebSocket(){}
};
test('durable hub stores version and broadcasts only after /notify',async()=>{
  const hub=new SheetEventHub(state,{});
  const before=await (await hub.fetch(new Request('https://internal/revision'))).json();
  assert.equal(before.revision,'');
  const notify=await hub.fetch(new Request('https://internal/notify',{method:'POST'}));
  assert.equal(notify.status,200);
  assert.equal(sends.length,1);
  const after=await (await hub.fetch(new Request('https://internal/revision'))).json();
  assert.ok(after.revision.length>10);assert.equal(after.revision,sends[0].revision);
});
test('Apps Script webhook needs secret and ignores unrelated tabs',async()=>{
  let hits=0;
  const env={SHEET_TAB:'機材管理',SHEET_WEBHOOK_SECRET:'random-secret',ASSETS:{fetch:async()=>new Response('asset')},SHEET_EVENTS:{getByName(){return {fetch:async(request)=>{hits++;return Response.json({ok:true})}}}}};
  const send=(secret,sheet,event='edit')=>worker.fetch(new Request('https://example.test/api/sheet-change',{method:'POST',headers:{'Content-Type':'application/json','X-Equipment-Webhook-Secret':secret},body:JSON.stringify({event,sheet})}),env);
  assert.equal((await send('wrong','機材管理')).status,401);
  assert.equal(hits,0);
  const ignored=await send('random-secret','操作履歴');
  assert.equal((await ignored.json()).ignored,true);assert.equal(hits,0);
  assert.equal((await send('random-secret','機材管理')).status,200);assert.equal(hits,1);
});
