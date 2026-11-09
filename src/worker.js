import { snapshot, editCell, createAsset } from './google.js';
import { demoPeople, demoRows, demoHistory } from './demo.js';

// Service-account credentials remain on the Cloudflare Worker only.
// No application login is required; access to the Worker URL is not restricted.
function json(data,status=200,headers={}) {
  return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
function liveReady(env) {
  return !!(env.SPREADSHEET_ID && env.SERVICE_ACCOUNT_EMAIL && env.SERVICE_ACCOUNT_PRIVATE_KEY);
}
async function bodyOf(req) {
  if (Number(req.headers.get('Content-Length')||0)>12_000) throw new Error('送信データが大きすぎます。');
  const text=await req.text();if(text.length>12_000)throw new Error('送信データが大きすぎます。');
  try{return JSON.parse(text);}catch{throw new Error('JSONが正しくありません。');}
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!['GET','POST'].includes(request.method)) return json({error:'Method not allowed'},405);
    if (request.method==='POST') {
      const origin=request.headers.get('Origin');
      if (origin&&origin!==url.origin)return json({error:'他サイトからのリクエストは許可されていません。'},403);
    }
    const demo=env.DEMO_MODE==='true';
    if (url.pathname==='/api/session'&&request.method==='GET') {
      if (demo)return json({mode:'demo',authorized:true});
      if (!liveReady(env))return json({mode:'unconfigured',authorized:false,missing:'Cloudflare の Sheets API 接続情報が未設定です。'});
      return json({mode:'live',authorized:true});
    }
    if (!demo && !liveReady(env))return json({error:'Cloudflare の Sheets API 接続情報が未設定です。'},503);
    try {
      if (url.pathname==='/api/snapshot'&&request.method==='GET') {
        if (demo)return json({mode:'demo',people:demoPeople,rows:demoRows,history:demoHistory,syncedAt:new Date().toISOString()});
        return json(await snapshot(env));
      }
      if (url.pathname==='/api/edit'&&request.method==='POST') {
        if (demo)return json({ok:true,demo:true});
        const input=await bodyOf(request);
        return json({ok:true,...await editCell(env,input)});
      }
      if (url.pathname==='/api/create'&&request.method==='POST') {
        if (demo)return json({ok:true,demo:true});
        const input=await bodyOf(request);
        return json({ok:true,...await createAsset(env,input)});
      }
      return json({error:'APIが見つかりません。'},404);
    } catch(error) {
      // Conflict 409 is intentionally surfaced to the browser for refresh/retry.
      return json({error:error.message||'処理に失敗しました。'},error.status||400);
    }
  }
};
