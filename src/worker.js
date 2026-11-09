import { snapshot, editCell, createAsset } from './google.js';
import { demoPeople, demoRows, demoHistory } from './demo.js';

const encoder = new TextEncoder();
const COOKIE = 'equipment_session';
function json(data,status=200,headers={}) {
  return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
function liveReady(env) {
  return !!(env.SPREADSHEET_ID && env.SERVICE_ACCOUNT_EMAIL && env.SERVICE_ACCOUNT_PRIVATE_KEY && env.APP_PASSWORD && env.APP_SESSION_SECRET);
}
const encode = bytes => {
  let binary=''; for (const b of bytes) binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
};
const decode = str => Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4)), c=>c.charCodeAt(0));
async function sign(input,secret) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(input))));
}
async function safeEqual(a,b) {
  const [aHash,bHash]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);
  const aa=new Uint8Array(aHash),bb=new Uint8Array(bHash);
  let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
async function sessionValid(request,env) {
  const cookie=request.headers.get('Cookie')||'';
  const raw=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  if (!raw) return false;
  const split=raw.lastIndexOf('.');if(split<0)return false;
  const payload=raw.slice(0,split),signature=raw.slice(split+1);
  if (!await safeEqual(signature,await sign(payload,env.APP_SESSION_SECRET)))return false;
  try { const value=JSON.parse(new TextDecoder().decode(decode(payload)));return value.v===1&&value.exp>Date.now(); }
  catch {return false;}
}
function cookieHeader(token,request,age) {
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${age}${secure}`;
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
      if (!liveReady(env))return json({mode:'unconfigured',authorized:false,missing:'Cloudflare の Secrets / スプレッドシート設定が未完了です。'});
      return json({mode:'live',authorized:await sessionValid(request,env)});
    }
    if (url.pathname==='/api/login'&&request.method==='POST') {
      if (demo)return json({ok:true,mode:'demo'});
      if (!liveReady(env))return json({error:'先にCloudflareの設定を完了してください。'},503);
      try {
        const data=await bodyOf(request);
        if (typeof data.password!=='string'||!await safeEqual(data.password,env.APP_PASSWORD))return json({error:'パスワードが正しくありません。'},401);
        const payload=encode(encoder.encode(JSON.stringify({v:1,exp:Date.now()+7*24*3600*1000})));
        const token=`${payload}.${await sign(payload,env.APP_SESSION_SECRET)}`;
        return json({ok:true,mode:'live'},200,{'Set-Cookie':cookieHeader(token,request,604800)});
      } catch(error){return json({error:error.message},400);}
    }
    if (url.pathname==='/api/logout'&&request.method==='POST')return json({ok:true},200,{'Set-Cookie':cookieHeader('',request,0)});
    if (!demo && (!liveReady(env)||!await sessionValid(request,env))) return json({error:'ログインが必要です。'},401);
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
