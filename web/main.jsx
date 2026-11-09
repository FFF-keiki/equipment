import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Boxes, CalendarClock,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardList,
  Cloud, CloudOff, ExternalLink, FileSpreadsheet, Filter, History, LayoutDashboard,
  LoaderCircle, Menu, Minus, Monitor, Package,
  PackageCheck, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal,
  UserRound, UsersRound, Warehouse, X
} from 'lucide-react';
import './style.css';

const FIELD_MAP={A:'category',B:'name',C:'model',D:'note',E:'updatedAt',G:'spares',I:'purchasedAt',J:'lifespan'};
const FIELDS=[['A','カテゴリ'],['B','備品名'],['C','型番'],['D','備考'],['E','記載・更新日'],['G','備品数（保管分）'],['I','購入日'],['J','耐用年数']];
const DEMO_KEY='equipment-manager-demo-v1';
const nav=[{id:'dashboard',label:'ダッシュボード',icon:LayoutDashboard},{id:'assets',label:'機材一覧',icon:Boxes},{id:'people',label:'個人別の使用状況',icon:UsersRound},{id:'history',label:'変更履歴',icon:History}];
const count=n=>{const x=Number(String(n??'').replaceAll(',',''));return Number.isFinite(x)?x:0};
const fmt=n=>new Intl.NumberFormat('ja-JP').format(n||0);
const dateTime=iso=>{if(!iso)return '—'; const d=new Date(iso);return Number.isNaN(d.valueOf())?iso:d.toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
const itemCount=(row,person)=>count(row.allocations?.[person.column]);
function getPeopleCount(row){return Object.values(row.allocations||{}).reduce((n,v)=>n+count(v),0)}
function readDemo(){try{return JSON.parse(localStorage.getItem(DEMO_KEY))}catch{return null}}
async function request(path,opts={}){
  let res;try{res=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts,headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers}})}catch{throw new Error('サーバーに接続できません。APIが起動しているか確認してください。')}
  const data=await res.json().catch(()=>({}));if(!res.ok) {const e=new Error(data.error||`通信エラー (${res.status})`);e.status=res.status;throw e} return data;
}
function IconButton({icon:Icon,title,onClick,disabled=false,small=false}){return <button className={'icon-button'+(small?' small':'')} title={title} aria-label={title} onClick={onClick} disabled={disabled}><Icon size={small?15:18}/></button>}
function Modal({title,subtitle,onClose,children,wide=false}){useEffect(()=>{const handler=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[onClose]);return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={'modal'+(wide?' modal-wide':'')} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><IconButton icon={X} title="閉じる" onClick={onClose}/></div>{children}</section></div>}
function Tag({children,color='blue'}){return <span className={'tag tag-'+color}>{children}</span>}
function Blank({icon:Icon=Package,title,description}){return <div className="blank"><div className="blank-icon"><Icon size={24}/></div><strong>{title}</strong><p>{description}</p></div>}
function Pill({children}){return <span className="pill">{children}</span>}
function Spinner(){return <span className="spin"><LoaderCircle size={17}/></span>}

function App(){
  const demoRef=useRef(null);
  const revisionRef=useRef(null);
  const busyRef=useRef(false);
  const refreshSeq=useRef(0);
  const pendingRevisionRef=useRef(null);
  const [peopleMode,setPeopleMode]=useState('selected'),[personQuery,setPersonQuery]=useState(''),[session,setSession]=useState(null),[data,setData]=useState(null),[page,setPage]=useState('dashboard'),[query,setQuery]=useState(''),[category,setCategory]=useState('すべて'),[personColumn,setPersonColumn]=useState(''),[operator,setOperator]=useState(localStorage.getItem('equipment-manager-operator')||''),[modal,setModal]=useState(null),[busy,setBusy]=useState(false),[syncing,setSyncing]=useState(false),[toast,setToast]=useState(null),[sideOpen,setSideOpen]=useState(false),[lastError,setLastError]=useState('');
  const notify=(text,kind='ok')=>{setToast({text,kind,key:Date.now()})};
  useEffect(()=>{if(!toast)return;const h=setTimeout(()=>setToast(null),5200);return()=>clearTimeout(h)},[toast]);
  useEffect(()=>{busyRef.current=busy},[busy]);
  const refresh=useCallback(async({silent=false}={})=>{
    const seq=++refreshSeq.current;
    if(!silent)setSyncing(true);
    try{
      const s=await request('/api/snapshot');
      // A slower earlier fetch must not overwrite a more recent snapshot.
      if(seq!==refreshSeq.current)return;
      revisionRef.current=s.revision??null;
      if(s.mode==='demo'){
        const saved=readDemo();const next=saved?.rows?.length?{...s,...saved,syncedAt:new Date().toISOString()}:s;demoRef.current=next;setData(next);
      }else setData(s);
      setLastError('');
    }catch(err){if(seq===refreshSeq.current){setLastError(err.message);if(!silent)notify(err.message,'err');}}
    finally{if(seq===refreshSeq.current)setSyncing(false)}
  },[]);
  useEffect(()=>{let alive=true;(async()=>{try{const s=await request('/api/session');if(!alive)return;setSession(s);if(s.authorized)await refresh({silent:true})}catch(err){if(alive){setSession({mode:'error',authorized:false});setLastError(err.message)}}})();return()=>{alive=false}},[refresh]);
  // Only read Google Sheets on initial opening, actual edits, a webhook push,
  // or an explicit manual reload. A reconnect with an unchanged revision reads nothing.
  useEffect(()=>{
    if(!session?.authorized||session.mode==='demo'||!data)return;
    let disposed=false, socket=null, retryTimer=null, debounceTimer=null, failures=0;
    const scheduleRefresh=(version)=>{
      if(version===revisionRef.current)return;
      pendingRevisionRef.current=version;
      if(document.hidden||busyRef.current)return;
      clearTimeout(debounceTimer);
      debounceTimer=setTimeout(()=>{
        if(disposed||document.hidden||busyRef.current)return;
        pendingRevisionRef.current=null;
        refresh({silent:true});
      },400);
    };
    const reconnect=()=>{
      if(disposed)return;
      const url=new URL('/api/events',window.location.href);
      url.protocol=url.protocol==='https:'?'wss:':'ws:';
      socket=new WebSocket(url.href);
      socket.onopen=()=>{failures=0};
      socket.onmessage=({data:raw})=>{
        try {const msg=JSON.parse(raw);if(['hello','changed'].includes(msg.type)&&typeof msg.revision==='string')scheduleRefresh(msg.revision);} catch {}
      };
      socket.onerror=()=>{try{socket.close()}catch{}};
      socket.onclose=()=>{
        // No Google Sheets requests while disconnected. Retry socket only.
        if(!disposed&&failures<5) retryTimer=setTimeout(reconnect,Math.min(60000,1000*2**failures++));
      };
    };
    const onVisible=()=>{if(!document.hidden&&pendingRevisionRef.current!==null)scheduleRefresh(pendingRevisionRef.current)};
    reconnect();
    document.addEventListener('visibilitychange',onVisible);
    return()=>{disposed=true;clearTimeout(retryTimer);clearTimeout(debounceTimer);document.removeEventListener('visibilitychange',onVisible);if(socket)socket.close()};
  },[session?.authorized,session?.mode,Boolean(data),refresh]);
  useEffect(()=>{
    if(!busy&&pendingRevisionRef.current!==null&&!document.hidden){
      const version=pendingRevisionRef.current;
      if(version!==revisionRef.current){pendingRevisionRef.current=null;refresh({silent:true})}
      else pendingRevisionRef.current=null;
    }
  },[busy,refresh]);
  const rows=data?.rows||[],people=data?.people||[],history=data?.history||[];
  const categories=useMemo(()=>['すべて',...new Set(rows.map(r=>r.category).filter(Boolean))],[rows]);
  const availablePeople=useMemo(()=>people.filter(p=>p.name),[people]);
  useEffect(()=>{if(availablePeople.length&&!availablePeople.some(p=>p.column===personColumn))setPersonColumn(availablePeople[0].column)},[availablePeople,personColumn]);
  const summary=useMemo(()=>({assetTypes:rows.length,total:rows.reduce((a,r)=>a+count(r.total),0),assigned:rows.reduce((a,r)=>a+getPeopleCount(r),0),spares:rows.reduce((a,r)=>a+count(r.spares),0),people:people.length}),[rows,people]);
  const filteredRows=useMemo(()=>rows.filter(r=>{
    const search=[r.category,r.name,r.model,r.note].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase());
    return search&&(category==='すべて'||r.category===category);
  }),[rows,query,category]);
  const selectedPerson=people.find(p=>p.column===personColumn)||people[0];
  const currentOperator=people.find(p=>p.column===operator);
  const setOperatorPersist=(value)=>{setOperator(value);localStorage.setItem('equipment-manager-operator',value)};
  const updateDemo=(next)=>{demoRef.current=next;setData(next);localStorage.setItem(DEMO_KEY,JSON.stringify({rows:next.rows,history:next.history}))};
  const ensureOperator=()=>{if(!currentOperator){notify('右上で「操作する人」を選択してください。','err');return false}return true};
  const doEdit=async({row,column,value,reason=''})=>{
    const key=FIELD_MAP[column];const p=people.find(p=>p.column===column);
    const expected=p?(row.allocations[column]||''):String(row[key]||'');
    const input={sheetRow:row.sheetRow,column,value:String(value),expected,expectedName:row.name,actor:currentOperator?.name||'',note:reason};
    if(session.mode==='demo'){
      const current=demoRef.current||data;
      const next={...current,rows:current.rows.map(r=>{
        if(r.sheetRow!==row.sheetRow)return r;
        const x={...r,allocations:{...r.allocations}};
        if(p)x.allocations[column]=String(value);
        else x[key]=String(value);
        if(p||column==='G'){x.active=String(getPeopleCount(x));x.total=String(count(x.active)+count(x.spares))}
        return x;
      }),history:[{time:new Date().toISOString(),actor:currentOperator.name,action:p?'割当変更':'備品情報更新',sheetRow:row.sheetRow,asset:row.name,person:p?.name||(FIELDS.find(f=>f[0]===column)?.[1]||''),before:expected,after:String(value),detail:reason},...current.history].slice(0,150)};
      updateDemo(next);return {ok:true};
    }
    const out=await request('/api/edit',{method:'POST',body:JSON.stringify(input)});
    if(out.warning)notify(out.warning,'err');return out;
  };
  // An allocation is a STOCK TRANSFER, not a stand-alone person-cell edit:
  // person increases => G warehouse count decreases, and vice versa.
  const changeAllocation=async(row,p,delta,closeAfter=false)=>{
    if(!ensureOperator()||busy)return;
    if(!Number.isSafeInteger(delta)||delta===0)return;
    const assigned=itemCount(row,p), spares=count(row.spares);
    if(delta>spares){notify(`備品が不足しています（残り${spares}点）。`,'err');return}
    if(-delta>assigned){notify(`返却できるのは${assigned}点までです。`,'err');return}
    setBusy(true);
    try{
      if(session.mode==='demo'){
        const current=demoRef.current||data;
        const next={...current,rows:current.rows.map(r=>{
          if(r.sheetRow!==row.sheetRow)return r;
          const x={...r,allocations:{...r.allocations}};
          const nextAssigned=assigned+delta, nextSpares=spares-delta;
          if(nextAssigned)x.allocations[p.column]=String(nextAssigned);
          else delete x.allocations[p.column];
          x.spares=String(nextSpares);
          x.active=String(getPeopleCount(x));
          x.total=String(count(x.active)+nextSpares);
          return x;
        }),history:[{time:new Date().toISOString(),actor:currentOperator.name,action:delta>0?'貸出・割当':'返却・在庫戻し',sheetRow:row.sheetRow,asset:row.name,person:p.name,before:String(assigned),after:String(assigned+delta),detail:`備品数 ${spares} → ${spares-delta}`} ,...current.history].slice(0,150)};
        updateDemo(next);
      }else{
        const out=await request('/api/allocation',{method:'POST',body:JSON.stringify({
          sheetRow:row.sheetRow, personColumn:p.column, delta,
          expectedName:row.name,expectedPersonName:p.name,
          expectedAssigned:String(row.allocations?.[p.column]??''),
          expectedSpares:String(row.spares??''),
          actor:currentOperator.name
        })});
        if(out.warning)notify(out.warning,'err');
        await refresh({silent:true});
      }
      if(closeAfter)setModal(null);
      notify(`${p.name}さんの「${row.name}」を${Math.abs(delta)}点${delta>0?'割り当て':'返却'}しました`);
    }catch(e){notify(e.message,'err');if(session.mode!=='demo'&&e.status===409)await refresh({silent:true})}
    finally{setBusy(false)}
  };
  const saveItem=async(row,fields)=>{
    if(!ensureOperator()||busy)return;
    const changes=['A','C','D','E','G','I','J','B'].filter(col=>String(fields[FIELD_MAP[col]]??'')!==String(row[FIELD_MAP[col]]??''));
    if(!changes.length){setModal(null);return}
    setBusy(true);
    try{
      for(const column of changes)await doEdit({row,column,value:fields[FIELD_MAP[column]]||''});
      if(session.mode!=='demo')await refresh({silent:true});setModal(null);notify(`${row.name} の情報を更新しました`);
    }catch(e){notify(`保存が途中で停止しました：${e.message}`,'err');if(session.mode!=='demo')await refresh({silent:true})}finally{setBusy(false)}
  };
  const createItem=async(fields)=>{
    if(!ensureOperator()||busy)return;
    if(!fields.name?.trim()){notify('備品名を入力してください。','err');return}
    setBusy(true);
    try{
      if(session.mode==='demo'){
        const sheetRow=Math.max(2,...rows.map(r=>r.sheetRow))+1;
        const item={sheetRow,category:fields.category||'',name:fields.name,model:fields.model||'',note:fields.note||'',updatedAt:new Date().toLocaleDateString('ja-JP'),active:'0',spares:String(fields.spares||0),total:String(fields.spares||0),purchasedAt:fields.purchasedAt||'',lifespan:fields.lifespan||'',allocations:{}};
        updateDemo({...data,rows:[...rows,item],history:[{time:new Date().toISOString(),actor:currentOperator.name,action:'備品追加',sheetRow,asset:fields.name,person:'',before:'',after:fields.spares||'0'},...history]});
      }else{const result=await request('/api/create',{method:'POST',body:JSON.stringify({...fields,actor:currentOperator.name})});if(result.warning)notify(result.warning,'err');await refresh({silent:true})}
      setModal(null);notify('新しい機材を登録しました');
    }catch(e){notify(e.message,'err');if(e.status===409)await refresh({silent:true})}finally{setBusy(false)}
  };
  const switchPage=(id)=>{setPage(id);setSideOpen(false)};
  if(!session)return <div className="center-screen"><Spinner/> <span>読み込み中...</span></div>;
  if(!session.authorized)return <div className="auth-page"><div className="auth-mark"><Boxes size={30}/></div><div className="auth-panel"><div className="auth-heading"><div className="eyebrow">EQUIPMENT DESK</div><h1>事務所の機材を、<br/>ひとつの場所で。</h1><p>Google スプレッドシートを原本にした機材管理システム</p></div><div className="notice error"><CircleAlert size={20}/><div><strong>初期設定が必要です</strong><p>{session.missing||lastError||'Cloudflare の接続設定を確認してください。'}<br/>SERVICE_ACCOUNT_EMAIL / SERVICE_ACCOUNT_PRIVATE_KEY / SPREADSHEET_ID を確認してください。</p></div></div><p className="auth-bottom"><ShieldCheck size={15}/> Google の認証キーはサーバー側で保護されます</p></div></div>;
  return <div className="app-shell">
    <aside className={'sidebar'+(sideOpen?' show':'')}><div className="brand"><div className="brand-icon"><Boxes size={22}/></div><div><strong>機材管理</strong><small>EQUIPMENT DESK</small></div></div><div className="sidebar-label">WORKSPACE</div><nav>{nav.map(n=><button key={n.id} className={'nav-link'+(page===n.id?' active':'')} onClick={()=>switchPage(n.id)}><n.icon size={19}/><span>{n.label}</span>{page===n.id&&<span className="nav-indicator"/>}</button>)}</nav><div className="side-spacer"/><div className="side-bottom"><div className="source-panel"><div className="source-logo"><FileSpreadsheet size={21}/></div><div><strong>Google Sheets連携</strong><small>{session.mode==='demo'?'デモデータを表示中':'原本と双方向で同期'}</small></div><span className={'status-dot'+(lastError?' offline':'')}/></div><div className="source-hint">{session.mode==='demo'?'編集内容はこのブラウザに保存されます。':'変更は原本へ保存。外部の変更は通知を受けて取得します。定期取得は行いません。'}</div></div></aside>
    {sideOpen&&<div className="mobile-backdrop" onClick={()=>setSideOpen(false)}/>}
    <div className="main-area"><header className="topbar"><div className="topbar-left"><IconButton icon={Menu} title="メニュー" onClick={()=>setSideOpen(true)}/><div className="breadcrumb">ワークスペース <ChevronRight size={14}/> <strong>{nav.find(n=>n.id===page)?.label}</strong></div></div><div className="topbar-right"><div className={'connection'+(lastError?' error-connection':'')}><span className="status-dot"/>{session.mode==='demo'?'デモモード':lastError?'同期エラー':syncing?'同期中':'同期済み'}</div><div className="operator"><UserRound size={17}/><select aria-label="操作する人" value={operator} onChange={e=>setOperatorPersist(e.target.value)}><option value="">操作する人を選択</option>{people.map(p=><option key={p.column} value={p.column}>{p.name}</option>)}</select><ChevronDown size={14}/></div><IconButton icon={RefreshCw} title="最新の状態に更新" onClick={()=>refresh()} disabled={syncing}/></div></header>
    <main className="content"><div className="page-top"><div><div className="eyebrow">EQUIPMENT MANAGEMENT <span className="eyebrow-line"/></div><h1>{page==='dashboard'?'機材管理 ダッシュボード':page==='assets'?'機材一覧':page==='people'?'個人別の使用状況':'変更履歴'}</h1><p>{page==='dashboard'?'事務所全体の保有機材と使用状況を確認できます。':page==='assets'?'機材の登録情報・稼働数・保管在庫を管理します。':page==='people'?'スタッフごとの機材の割当状況を確認・更新します。':'Webから行われた操作を記録しています。'}</p></div><div className="page-actions">{data?.sheetUrl&&<a className="button light" href={data.sheetUrl} target="_blank" rel="noreferrer"><FileSpreadsheet size={16}/> スプシを開く <ExternalLink size={13}/></a>}{page==='assets'&&<button className="button primary" onClick={()=>setModal({kind:'create'})}><Plus size={17}/> 機材を追加</button>}{page==='dashboard'&&<button className="button primary" onClick={()=>switchPage('assets')}><Boxes size={17}/> 機材一覧を見る</button>}</div></div>
    {session.mode==='demo'&&<div className="demo-banner"><CircleAlert size={16}/> これはサンプルデータです。実際のスプシと双方向接続するには README に従って設定してください。</div>}
    {lastError&&<div className="notice error"><CloudOff size={18}/><div><strong>スプレッドシートの更新を取得できませんでした。</strong><p>{lastError}（直前の表示を維持しています）</p></div><button className="text-link" onClick={()=>refresh()}>再試行</button></div>}
    {page==='dashboard'&&<Dashboard summary={summary} rows={rows} people={people} history={history} onNavigate={switchPage} onSelectPerson={col=>{setPersonColumn(col);setPeopleMode('selected');switchPage('people')}}/>}
    {page==='assets'&&<><div className="toolbar"><div className="search"><Search size={18}/><input aria-label="機材を検索" placeholder="機材名、型番、備考で検索..." value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button title="検索を消去" onClick={()=>setQuery('')}><X size={16}/></button>}</div><div className="category-select"><Filter size={15}/><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select><ChevronDown size={14}/></div><span className="result-count">{filteredRows.length} 件の機材</span></div><div className="table-wrap"><table className="asset-table"><thead><tr><th>機材情報</th><th>カテゴリ</th><th className="num">稼働</th><th className="num">備品</th><th className="num">総数</th><th className="right">操作</th></tr></thead><tbody>{filteredRows.map(r=><tr key={r.sheetRow}><td><div className="asset-cell"><span className="equipment-icon"><Monitor size={19}/></span><div><strong>{r.name}</strong><small>{r.model||'型番未登録'}</small></div></div></td><td><Tag color={r.category==='作業環境'?'blue':r.category==='周辺機器'?'purple':'neutral'}>{r.category||'未分類'}</Tag></td><td className="num"><b>{r.active===''?'—':r.active}</b></td><td className="num"><b>{r.spares===''?'—':r.spares}</b></td><td className="num"><b>{r.total===''?'—':r.total}</b></td><td className="right"><div className="row-actions"><button className="small-button subtle" onClick={()=>setModal({kind:'edit',row:r})}>編集 <ChevronRight size={14}/></button></div></td></tr>)}</tbody></table>{filteredRows.length===0&&<Blank icon={Search} title="該当する機材がありません" description="検索条件を変更してください。"/>}</div><p className="table-foot"><ShieldCheck size={15}/>「稼働」「総数」はスプレッドシートの自動計算結果です。割当・返却は「個人別の使用状況」から操作できます。</p></>}
    {page==='people'&&<>
      <div className="people-toolbar">
        <div className="people-toolbar-left">
          <label className="person-picker-label" htmlFor="person-selector">スタッフを選択</label>
          <div className="person-picker-control"><UsersRound size={17}/><select id="person-selector" value={selectedPerson?.column||''} onChange={e=>{setPersonColumn(e.target.value);setPeopleMode('selected')}}>{availablePeople.map(p=><option key={p.column} value={p.column}>{p.name}</option>)}</select><ChevronDown size={16}/></div>
          <span className="people-roster-count">{availablePeople.length} 名登録</span>
        </div>
        <div className="segmented people-display-mode"><button className={peopleMode==='selected'?'on':''} onClick={()=>setPeopleMode('selected')}><UserRound size={15}/> 選択したスタッフ</button><button className={peopleMode==='all'?'on':''} onClick={()=>setPeopleMode('all')}><UsersRound size={15}/> 全員一覧</button></div>
      </div>
      {peopleMode==='selected'&&selectedPerson?<PersonDetail person={selectedPerson} rows={rows} busy={busy} onChange={changeAllocation} onAssign={()=>setModal({kind:'allocate',personColumn:selectedPerson.column})}/>:peopleMode==='all'?<PeopleOverview rows={rows} people={availablePeople} query={personQuery} onQueryChange={setPersonQuery} onSelect={col=>{setPersonColumn(col);setPeopleMode('selected')}}/>:<Blank icon={UsersRound} title="担当者が登録されていません" description="スプシの2行目、K列以降の見出しを確認してください。"/>}
    </>}
    {page==='history'&&<><div className="history-heading"><div><h3>操作ログ</h3><p>Webで行った編集・割当操作を表示します。スプシで直接編集した操作はGoogle側の変更履歴で確認してください。</p></div><Pill>最新 {history.length} 件</Pill></div><div className="history-list">{history.length?history.map((h,i)=><div className="history-row" key={i}><span className="history-bullet"><History size={17}/></span><div className="history-main"><div><strong>{h.asset}</strong><span className="history-action">{h.action}</span></div><p>{h.person?`${h.person} · `:''}{h.before||'空欄'} <ArrowRight size={13}/> {h.after||'空欄'}</p></div><div className="history-meta"><strong>{h.actor||'未指定'}</strong><small>{dateTime(h.time)}</small></div></div>):<Blank icon={History} title="変更履歴はまだありません" description="Webで編集すると、操作内容が記録されます。"/>}</div></>}
    <footer className="content-footer"><span><span className={'status-dot'+(lastError?' offline':'')}/> {session.mode==='demo'?'デモデータ':'Google Sheetsと接続'} · {data?.syncedAt?`最終取得 ${dateTime(data.syncedAt)}`:'未取得'}</span><span>変更通知で更新 · 定期取得なし · 手動更新可能</span></footer>
    </main></div>
    {modal?.kind==='edit'&&<EditModal row={modal.row} busy={busy} onClose={()=>!busy&&setModal(null)} onSave={values=>saveItem(modal.row,values)}/>}
    {modal?.kind==='create'&&<CreateModal categories={categories.filter(c=>c!=='すべて')} busy={busy} onClose={()=>!busy&&setModal(null)} onSave={createItem}/>}
    {modal?.kind==='allocate'&&<AssignToPersonModal person={people.find(p=>p.column===modal.personColumn)} rows={rows} busy={busy} onClose={()=>!busy&&setModal(null)} onSubmit={(row,p,amount)=>changeAllocation(row,p,amount,true)}/>}
    {toast&&<div key={toast.key} className={'toast '+(toast.kind==='err'?'toast-error':'')}><span>{toast.kind==='err'?<CircleAlert size={18}/>:<CheckCircle2 size={18}/>}</span>{toast.text}<button onClick={()=>setToast(null)} aria-label="閉じる"><X size={15}/></button></div>}
  </div>
}

function Dashboard({summary,rows,people,history,onNavigate,onSelectPerson}){
  const stats=[{label:'登録機材',value:summary.assetTypes,unit:'種類',icon:Boxes,kind:'blue',detail:'管理中の機材タイプ'},{label:'総保有数',value:summary.total,unit:'点',icon:PackageCheck,kind:'purple',detail:'スプシの総数列の合計'},{label:'個人への割当',value:summary.assigned,unit:'点',icon:UsersRound,kind:'orange',detail:'個人別の数量合計'},{label:'備品・予備',value:summary.spares,unit:'点',icon:Warehouse,kind:'green',detail:'備品列の合計'}];
  const topPeople=people.map(p=>({...p,qty:rows.reduce((a,r)=>a+itemCount(r,p),0),types:rows.filter(r=>itemCount(r,p)>0).length})).sort((a,b)=>b.qty-a.qty).slice(0,6);
  const cat=Object.entries(rows.reduce((a,r)=>{const k=r.category||'未分類';a[k]=(a[k]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(...topPeople.map(p=>p.qty),1);
  return <><div className="stat-grid">{stats.map(s=><div className="stat-card" key={s.label}><div className="stat-first"><span>{s.label}</span><span className={'stat-icon '+s.kind}><s.icon size={21}/></span></div><div className="stat-value">{fmt(s.value)} <small>{s.unit}</small></div><p>{s.detail}</p></div>)}</div><div className="dash-grid"><section className="panel"><div className="panel-title"><div><h3>スタッフ別 使用状況</h3><p>現在の割当点数が多い順</p></div><button className="text-link" onClick={()=>onNavigate('people')}>すべて見る <ArrowRight size={15}/></button></div><div className="people-bars">{topPeople.length?topPeople.map((p,i)=><button key={p.column} className="people-bar" onClick={()=>onSelectPerson(p.column)}><span className="person-avatar large">{p.name.slice(0,1)}</span><span className="bar-body"><span className="bar-label"><strong>{p.name}</strong><small>{p.types}種類 / {p.qty}点</small></span><span className="bar-track"><span style={{width:`${Math.max(2,p.qty/max*100)}%`}}/></span></span></button>):<Blank icon={UsersRound} title="割当がありません" description="スタッフの列を設定してください。"/>}</div></section><section className="panel"><div className="panel-title"><div><h3>カテゴリ別 機材</h3><p>カテゴリごとの登録種類数</p></div><span className="mini-icon"><SlidersHorizontal size={18}/></span></div><div className="category-list">{cat.slice(0,7).map(([name,n],i)=><div className="category-row" key={name}><div className="category-name"><span className={'category-dot d'+(i%5)}/><strong>{name}</strong></div><div className="category-progress"><span style={{width:`${n/Math.max(rows.length,1)*100}%`}}/></div><span className="category-n">{n} 種類</span></div>)}{cat.length===0&&<Blank icon={Package} title="機材がありません" description="機材一覧から追加してください。"/>}</div><div className="panel-bottom">全 {rows.length} 種類を管理中</div></section></div><section className="panel recent-panel"><div className="panel-title"><div><h3>最近の操作</h3><p>Webで更新された内容</p></div><button className="text-link" onClick={()=>onNavigate('history')}>履歴を見る <ArrowRight size={15}/></button></div>{history.length?<div className="recent-list">{history.slice(0,4).map((h,i)=><div className="recent-row" key={i}><div className="recent-icon"><ClipboardList size={17}/></div><div><strong>{h.actor||'担当者'} <span>が「{h.asset}」を{h.action}</span></strong><p>{h.person||'備品情報'} · {h.before||'空欄'} → {h.after||'空欄'}</p></div><time>{dateTime(h.time)}</time></div>)}</div>:<Blank icon={History} title="操作履歴はまだありません" description="機材の編集や割当を行うとここに表示されます。"/>}</section></>
}
function PersonDetail({person,rows,busy,onChange,onAssign}){
  const [term,setTerm]=useState('');
  const assigned=rows.filter(r=>itemCount(r,person)>0);
  const shown=assigned.filter(r=>[r.name,r.model,r.category].join(' ').toLowerCase().includes(term.toLowerCase()));
  const qty=assigned.reduce((n,r)=>n+itemCount(r,person),0);
  return <div className="person-workspace">
    <section className="person-summary compact-person-summary">
      <span className="person-hero-avatar">{person.name.slice(0,1)}</span>
      <div className="person-summary-title"><h2>{person.name} <small>さんの使用機材</small></h2><p>スプレッドシート上の個人列と同期しています</p></div>
      <div className="person-total"><strong>{assigned.length}</strong><span>種類</span></div>
      <div className="person-total"><strong>{qty}</strong><span>使用点数</span></div>
      <button className="button primary assign-person-button" onClick={onAssign} disabled={busy}><Plus size={17}/> 機材を割り当て</button>
    </section>
    <section className="person-list-panel">
      <div className="person-list-heading"><div><h3>現在使用している機材</h3><p>＋で追加割当、－で返却します。備品数も同時に更新されます。</p></div><div className="search small-search"><Search size={16}/><input value={term} onChange={e=>setTerm(e.target.value)} placeholder="使用中の機材を検索"/></div></div>
      <div className="person-assets-list"><div className="person-assets-head"><span>機材情報</span><span>備品（残数）</span><span>個人使用数・操作</span></div>
      {shown.map(r=><div className="person-asset-row" key={r.sheetRow}>
        <div className="person-asset-main"><span className="equipment-icon"><Monitor size={18}/></span><div><strong>{r.name}</strong><small>{r.model||r.category||'型番未登録'}</small></div></div>
        <div className="person-stock-cell"><span className={'stock-chip'+(count(r.spares)===0?' empty':'')}>{count(r.spares)} 点</span></div>
        <div className="person-count-control"><span className="count-text">使用 {itemCount(r,person)} 点</span><div className="stepper"><button aria-label={`${r.name}を1点返却`} title="返却して備品数を1点増やす" disabled={busy||itemCount(r,person)===0} onClick={()=>onChange(r,person,-1)}><Minus size={16}/></button><b>{itemCount(r,person)}</b><button aria-label={`${r.name}を1点割当`} title="割り当てて備品数を1点減らす" disabled={busy||count(r.spares)===0} onClick={()=>onChange(r,person,1)}><Plus size={16}/></button></div></div>
      </div>)}</div>
      {shown.length===0&&<Blank icon={Package} title={assigned.length?'該当する機材がありません':'このスタッフの使用機材はありません'} description="「機材を割り当て」から保管中の機材を選択できます。"/>}
    </section>
  </div>
}
function PeopleOverview({rows,people,query,onQueryChange,onSelect}){
  const results=people.filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="roster-panel"><div className="roster-top"><div><h3>全員の機材使用状況</h3><p>使用機材を一覧で比較できます。スタッフを選択すると割当・返却ができます。</p></div><div className="search small-search"><Search size={16}/><input value={query} onChange={e=>onQueryChange(e.target.value)} placeholder="スタッフを検索"/></div></div><div className="roster-rows">
    {results.map(p=>{const assigned=rows.filter(r=>itemCount(r,p)>0);const total=assigned.reduce((n,r)=>n+itemCount(r,p),0);return <button type="button" key={p.column} className="roster-row" onClick={()=>onSelect(p.column)}><span className="roster-identity"><span className="person-initial">{p.name.slice(0,1)}</span><strong>{p.name}</strong></span><span className="roster-chips">{assigned.slice(0,6).map(r=><span className="roster-chip" key={r.sheetRow}>{r.name} <b>×{itemCount(r,p)}</b></span>)}{assigned.length>6&&<span className="roster-more">ほか {assigned.length-6} 種類</span>}{!assigned.length&&<span className="muted">割当なし</span>}</span><span className="roster-totals">{assigned.length} 種類 <b>{total} 点</b></span><ChevronRight size={17}/></button>})}
    {!results.length&&<Blank icon={Search} title="スタッフが見つかりません" description="検索条件を変更してください。"/>}
  </div></section>
}
function AssignToPersonModal({person,rows,busy,onClose,onSubmit}){
  const inStock=rows.filter(r=>count(r.spares)>0);
  const [filter,setFilter]=useState('');
  const [selected,setSelected]=useState(inStock[0]?.sheetRow||'');
  const [quantity,setQuantity]=useState('1');
  const filtered=inStock.filter(r=>[r.name,r.model,r.category].join(' ').toLowerCase().includes(filter.toLowerCase()));
  const chosen=filtered.find(r=>String(r.sheetRow)===String(selected))||filtered[0];
  const q=Number(quantity),stock=count(chosen?.spares);
  const valid=chosen&&Number.isSafeInteger(q)&&q>=1&&q<=stock;
  return <Modal title={`${person?.name||'スタッフ'}さんへ機材を割り当て`} subtitle="備品（G列）から移動し、使用数と在庫を同時に更新します。" onClose={onClose}>
    <form className="edit-form" onSubmit={e=>{e.preventDefault();if(valid&&person)onSubmit(chosen,person,q)}}>
      <label className="form-field"><span>機材を検索</span><input value={filter} onChange={e=>{setFilter(e.target.value);setSelected('')}} placeholder="機材名・型番・カテゴリ"/></label>
      <label className="form-field"><span>割り当てる機材</span><select value={chosen?.sheetRow||''} onChange={e=>setSelected(e.target.value)} disabled={!filtered.length}>{filtered.map(r=><option key={r.sheetRow} value={r.sheetRow}>{r.name} {r.model?`／ ${r.model}`:''} （備品 {count(r.spares)}点）</option>)}</select></label>
      <label className="form-field"><span>割当数量</span><input type="number" min="1" max={stock||1} step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} required disabled={!chosen}/></label>
      {chosen?<div className="allocation-preview"><div><small>現在の備品数</small><strong>{stock} 点</strong></div><ArrowRight size={18}/><div><small>割当後の備品数</small><strong>{valid?stock-q:'—'} 点</strong></div><div><small>{person?.name}さんの割当数</small><strong>{itemCount(chosen,person)+(valid?q:0)} 点</strong></div></div>:<div className="notice error">{inStock.length?'検索に該当する機材がありません。':'割当できる備品がありません。'}</div>}
      <div className="modal-hint"><ShieldCheck size={16}/> 在庫が不足している場合や他の人が先に更新した場合は保存されません。</div>
      <div className="modal-actions"><button type="button" className="button light" onClick={onClose} disabled={busy}>キャンセル</button><button type="submit" className="button primary" disabled={busy||!valid}>{busy?<Spinner/>:<Check size={16}/>} {valid?`${q}点を割り当て`:'数量を確認'}</button></div>
    </form>
  </Modal>
}
function EditModal({row,busy,onClose,onSave}){
  const [values,setValues]=useState(Object.fromEntries(FIELDS.map(([col])=>[FIELD_MAP[col],String(row[FIELD_MAP[col]]||'')])));
  const set=(field,value)=>setValues(v=>({...v,[field]:value}));
  return <Modal title="機材情報を編集" subtitle={`スプレッドシート ${row.sheetRow} 行目 / F・H列は自動計算のため編集不可`} onClose={onClose} wide><form onSubmit={e=>{e.preventDefault();onSave(values)}} className="edit-form"><div className="form-grid">{FIELDS.map(([col,label])=><label key={col} className={'form-field '+(['D'].includes(col)?'full-col':'')}><span>{label}{col==='B'&&<span className="required"> *</span>}</span>{col==='D'?<textarea value={values.note} onChange={e=>set('note',e.target.value)} rows={3} placeholder="補足情報や保管場所"/>:<input value={values[FIELD_MAP[col]]} onChange={e=>set(FIELD_MAP[col],e.target.value)} required={col==='B'} type={['G','J'].includes(col)?'number':'text'} min={['G','J'].includes(col)?'0':undefined} placeholder={col==='I'||col==='E'?'YYYY/MM/DD':''}/>}</label>)}</div><div className="modal-hint"><ShieldCheck size={16}/> 変更内容は原本シートに書き込まれます。計算式・書式は保持します。</div><div className="modal-actions"><button type="button" className="button light" disabled={busy} onClick={onClose}>キャンセル</button><button className="button primary" type="submit" disabled={busy}>{busy?<Spinner/>:<Check size={16}/>} 変更を保存</button></div></form></Modal>
}
function CreateModal({categories,busy,onClose,onSave}){
  const [values,setValues]=useState({category:categories[0]||'作業環境',name:'',model:'',note:'',spares:'1',purchasedAt:'',lifespan:''});const set=(key,value)=>setValues(v=>({...v,[key]:value}));
  return <Modal title="新しい機材を追加" subtitle="スプレッドシートの最終データ行の下に登録します。" onClose={onClose}><form className="edit-form" onSubmit={e=>{e.preventDefault();onSave(values)}}><label className="form-field"><span>機材名 <span className="required">*</span></span><input autoFocus required value={values.name} onChange={e=>set('name',e.target.value)} placeholder="例：モニター"/></label><label className="form-field"><span>カテゴリ</span><input list="category-list" value={values.category} onChange={e=>set('category',e.target.value)} placeholder="作業環境"/><datalist id="category-list">{categories.map(c=><option key={c} value={c}/>)}</datalist></label><label className="form-field"><span>型番</span><input value={values.model} onChange={e=>set('model',e.target.value)} placeholder="製品・型番"/></label><label className="form-field"><span>備品数（保管分）</span><input type="number" min="0" required value={values.spares} onChange={e=>set('spares',e.target.value)}/></label><label className="form-field"><span>購入日</span><input value={values.purchasedAt} placeholder="YYYY/MM/DD" onChange={e=>set('purchasedAt',e.target.value)}/></label><label className="form-field"><span>耐用年数</span><input type="number" min="0" value={values.lifespan} onChange={e=>set('lifespan',e.target.value)}/></label><label className="form-field"><span>備考</span><textarea rows="2" value={values.note} onChange={e=>set('note',e.target.value)}/></label><div className="modal-hint"><CircleAlert size={16}/> 新規行では上の行の書式・入力規則・数式を引き継ぎます。原本の数式構成は事前に確認してください。</div><div className="modal-actions"><button type="button" className="button light" onClick={onClose} disabled={busy}>キャンセル</button><button type="submit" className="button primary" disabled={busy}>{busy?<Spinner/>:<Plus size={17}/>} 登録する</button></div></form></Modal>
}
createRoot(document.getElementById('root')).render(<App/>);
