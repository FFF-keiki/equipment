import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const env={DEMO_MODE:'true',ASSETS:{fetch:async()=>new Response('asset')}};
async function call(path,method='GET',body=null,origin='http://localhost:8787',e=env){
  const req=new Request(`http://localhost:8787${path}`,{method,headers:method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  const res=await worker.fetch(req,e);
  return {status:res.status,json:res.headers.get('Content-Type')?.includes('json')?await res.json():null};
}
test('Demo session and snapshot can be loaded without secrets',async()=>{
  const s=await call('/api/session');
  assert.equal(s.json.mode,'demo');assert.equal(s.json.authorized,true);
  const state=await call('/api/snapshot');
  assert.equal(state.status,200);assert.ok(state.json.people.length>2);assert.ok(state.json.rows.length>2);
});
test('Cross-origin writes are denied',async()=>{
  const res=await call('/api/edit','POST',{sheetRow:3,column:'K',value:3},'https://untrusted.example');
  assert.equal(res.status,403);
});
test('Production defaults to configuration required, not an unprotected demo',async()=>{
  const s=await call('/api/session','GET',null,'http://localhost:8787',{DEMO_MODE:'false',ASSETS:env.ASSETS});
  assert.equal(s.json.mode,'unconfigured');
  const state=await call('/api/snapshot','GET',null,'http://localhost:8787',{DEMO_MODE:'false',ASSETS:env.ASSETS});
  assert.equal(state.status,503);
});

test('Production session is accessible without APP_PASSWORD or APP_SESSION_SECRET',async()=>{
  const e={DEMO_MODE:'false',ASSETS:env.ASSETS,SPREADSHEET_ID:'sheet',SERVICE_ACCOUNT_EMAIL:'service@example.iam.gserviceaccount.com',SERVICE_ACCOUNT_PRIVATE_KEY:'test-only-key'};
  const s=await call('/api/session','GET',null,'http://localhost:8787',e);
  assert.equal(s.status,200);assert.equal(s.json.mode,'live');assert.equal(s.json.authorized,true);
  const oldLogin=await call('/api/login','POST',{password:'irrelevant'},'http://localhost:8787',e);
  assert.equal(oldLogin.status,404);
});
