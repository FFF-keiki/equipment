import { snapshot, editCell, createAsset, allocateAsset } from './google.js';
import { demoPeople, demoRows, demoHistory } from './demo.js';

// Service-account credentials remain on the Cloudflare Worker only.
// No application login is required; access to the Worker URL is not restricted.
// Spreadsheet edits notify a hibernating Durable Object through a secret-protected webhook.
function json(data,status=200,headers={}) {
  return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
function liveReady(env) {
  return !!(env.SPREADSHEET_ID && env.SERVICE_ACCOUNT_EMAIL && env.SERVICE_ACCOUNT_PRIVATE_KEY);
}
async function equalSecret(left, right) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
function hub(env) {
  return env.SHEET_EVENTS?.getByName('equipment-manager');
}
async function revision(env) {
  const stub = hub(env);
  if (!stub) return '';
  const response = await stub.fetch('https://events.internal/revision');
  if (!response.ok) throw new Error('変更通知サーバーへの接続に失敗しました。');
  return (await response.json()).revision || '';
}
async function announce(env) {
  const stub = hub(env);
  if (!stub) return;
  const response = await stub.fetch('https://events.internal/notify', {method:'POST'});
  if (!response.ok) throw new Error('変更通知を配信できませんでした。');
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
    // Apps Script's installable edit/change trigger: no Google Sheets read here.
    if (url.pathname === '/api/sheet-change' && request.method === 'POST') {
      if (!env.SHEET_WEBHOOK_SECRET || !hub(env)) return json({error:'変更通知の設定が未完了です。'},503);
      const secret = request.headers.get('X-Equipment-Webhook-Secret') || '';
      if (!secret || !await equalSecret(secret, env.SHEET_WEBHOOK_SECRET)) return json({error:'Unauthorized'},401);
      try {
        const payload = await bodyOf(request);
        if (!['edit','structure'].includes(payload.event)) return json({error:'Invalid event'},400);
        // Ignore edits on unrelated tabs such as the audit tab.
        if (typeof payload.sheet !== 'string' || payload.sheet !== (env.SHEET_TAB || '機材管理')) return json({ok:true,ignored:true});
        await announce(env);
        return json({ok:true});
      } catch(error) {return json({error:error.message},400);}
    }
    if (url.pathname === '/api/events' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({error:'WebSocket required'},426);
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return json({error:'Forbidden'},403);
      const stub = hub(env);
      if (!stub) return json({error:'変更通知の設定がありません。'},503);
      return stub.fetch(request);
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
        // Capture the version BEFORE Sheets is read. A simultaneous edit will
        // then still be observable as a newer version by the connected browser.
        const currentRevision = await revision(env);
        return json({...await snapshot(env), revision:currentRevision});
      }
      if (url.pathname==='/api/allocation' && request.method==='POST') {
        if (demo) return json({ok:true,demo:true});
        if (!hub(env)) return json({error:'在庫操作には SHEET_EVENTS の Durable Object が必要です。'},503);
        const input=await bodyOf(request);
        const response=await hub(env).fetch('https://events.internal/allocate', {
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)
        });
        // Include status for 409 conflicts so the UI can refresh.
        return response;
      }
      if (['/api/edit','/api/create'].includes(url.pathname) && request.method === 'POST') {
        if (demo) return json({ok:true,demo:true});
        if (!hub(env)) return json({error:'在庫操作には SHEET_EVENTS の Durable Object が必要です。'},503);
        const input=await bodyOf(request);
        return hub(env).fetch(`https://events.internal/${url.pathname.slice('/api/'.length)}`, {
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)
        });
      }
      return json({error:'APIが見つかりません。'},404);
    } catch(error) {
      // Conflict 409 is intentionally surfaced to the browser for refresh/retry.
      return json({error:error.message||'処理に失敗しました。'},error.status||400);
    }
  }
};


// SQLite-backed Durable Object using WebSocket Hibernation.
// It stores only a revision marker, never spreadsheet contents or credentials.
export class SheetEventHub {
  constructor(state, env) { this.state = state; this.env = env; this.writeQueue = Promise.resolve(); }
  async broadcast() {
    const revision = crypto.randomUUID();
    await this.state.storage.put('revision', revision);
    const message = JSON.stringify({type:'changed', revision});
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(message); } catch { try { socket.close(1011,'send failed'); } catch {} }
    }
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/revision' && request.method === 'GET') {
      return json({revision: (await this.state.storage.get('revision')) || ''});
    }
    if (path === '/notify' && request.method === 'POST') {
      await this.broadcast();
      return json({ok:true});
    }
    if (path === '/allocate' && request.method === 'POST') {
      // Cloudflare DO requests can interleave across external fetch awaits.
      // Serialize transfers across all Web clients to avoid double spending stock.
      let input;
      try { input = await bodyOf(request); }
      catch (error) { return json({error:error.message},400); }
      const run = this.writeQueue.then(async () => {
        const result = await allocateAsset(this.env, input);
        try { await this.broadcast(); }
        catch(error) { result.warning = [result.warning,`変更通知の配信に失敗しました: ${error.message}`].filter(Boolean).join(' / '); }
        return result;
      });
      this.writeQueue = run.catch(() => {});
      try { return json({ok:true,...await run}); }
      catch(error) { return json({error:error.message||'在庫更新に失敗しました。'},error.status||400); }
    }
    if (['/edit','/create'].includes(path) && request.method === 'POST') {
      let input;
      try { input=await bodyOf(request); }
      catch(error) { return json({error:error.message},400); }
      const run=this.writeQueue.then(async () => {
        const result=path==='/edit' ? await editCell(this.env,input) : await createAsset(this.env,input);
        if(path==='/create'||result.changed) {
          try { await this.broadcast(); }
          catch(error) { result.warning=[result.warning,`変更通知の配信に失敗しました: ${error.message}`].filter(Boolean).join(' / '); }
        }
        return result;
      });
      this.writeQueue=run.catch(()=>{});
      try { return json({ok:true,...await run}); }
      catch(error) { return json({error:error.message||'更新に失敗しました。'},error.status||400); }
    }
    if (path === '/api/events' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({error:'Upgrade required'},426);
      const pair = new WebSocketPair();
      const [client,server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({type:'hello', revision:(await this.state.storage.get('revision')) || ''}));
      return new Response(null,{status:101,webSocket:client});
    }
    return json({error:'Not found'},404);
  }
  // Clients cannot broadcast events; only the Worker can call /notify.
  webSocketMessage(socket, message) {}
  webSocketClose(socket,code,reason) { try{socket.close(code,reason);}catch{} }
  webSocketError(socket) { try{socket.close(1011,'connection error');}catch{} }
}
