import test from 'node:test';
import assert from 'node:assert/strict';
import {SheetEventHub} from '../src/worker.js';

const privatePem = async () => {
  const keys = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8',keys.privateKey));
  return '-----BEGIN PRIVATE KEY-----\n'+Buffer.from(bytes).toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END PRIVATE KEY-----';
};

test('serialized web checkouts update G and the person together, reject stale second checkout',async () => {
  const originalFetch = globalThis.fetch;
  let stock = 1, person = 0;
  const batchUpdates = [];
  const header = Array.from({length:54},()=> '');
  header[1]='備品名'; header[10]='佐藤';
  const rows=Array.from({length:54},()=> ''); rows[1]='キーボード'; rows[6]=stock; rows[10]=person;
  const authEmail=`worker-allocate-test-${crypto.randomUUID()}@example.iam.gserviceaccount.com`;
  const env={
    SHEET_TAB:'機材管理',HEADER_ROW:'2',FIRST_DATA_ROW:'3',MAX_DATA_ROWS:'1000',
    PERSON_START_COLUMN:'K',PERSON_END_COLUMN:'BB',AUDIT_TAB:'操作履歴',
    SPREADSHEET_ID:'spreadsheet-test', SERVICE_ACCOUNT_EMAIL:authEmail,
    SERVICE_ACCOUNT_PRIVATE_KEY:await privatePem()
  };
  let rev=''; const broadcasts=[];
  const state={
    storage:{get:async()=>rev,put:async(k,v)=>{rev=v}},
    getWebSockets:()=>[{send:msg=>broadcasts.push(JSON.parse(msg))}],
    acceptWebSocket:()=>{}
  };
  globalThis.fetch=async (url,options={})=>{
    const u=new URL(url);
    if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fake-token',expires_in:3600});
    if(u.pathname.endsWith('/values:batchGet')){
      const cells=Array.from({length:54},()=> '');
      cells[1]='キーボード';cells[6]=stock;cells[10]=person;
      return Response.json({valueRanges:[{values:[header]},{values:[cells]}]});
    }
    if(u.pathname.endsWith('/values:batchUpdate')){
      const data=JSON.parse(options.body).data;
      batchUpdates.push(data);
      assert.equal(data.length,2,'both cells are written with one Google API request');
      assert.match(data[0].range,/!G3$/);
      assert.match(data[1].range,/!K3$/);
      stock=data[0].values[0][0];person=data[1].values[0][0];
      return Response.json({totalUpdatedCells:2});
    }
    if(u.pathname.includes(':append'))return Response.json({updates:{updatedCells:9}});
    throw new Error(`unexpected request ${url}`);
  };
  const hub=new SheetEventHub(state,env);
  const send=()=>hub.fetch(new Request('https://events.internal/allocate',{method:'POST',body:JSON.stringify({
    sheetRow:3,personColumn:'K',delta:1,expectedName:'キーボード',expectedPersonName:'佐藤',
    expectedAssigned:'',expectedSpares:'1',actor:'佐藤'
  })}));
  try {
    const [a,b]=await Promise.all([send(),send()]);
    assert.deepEqual([a.status,b.status],[200,409]);
    assert.equal(stock,0);assert.equal(person,1);
    assert.equal(batchUpdates.length,1);
    assert.equal(broadcasts.length,1);

    const back=await hub.fetch(new Request('https://events.internal/allocate',{method:'POST',body:JSON.stringify({
      sheetRow:3,personColumn:'K',delta:-1,expectedName:'キーボード',expectedPersonName:'佐藤',
      expectedAssigned:'1',expectedSpares:'0',actor:'佐藤'
    })}));
    assert.equal(back.status,200);
    assert.equal(stock,1);assert.equal(person,'');
    assert.equal(batchUpdates.length,2);assert.equal(broadcasts.length,2);
  } finally {globalThis.fetch=originalFetch;}
});
