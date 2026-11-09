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
  const [session,setSession]=useState(null),[data,setData]=useState(null),[page,setPage]=useState('dashboard'),[query,setQuery]=useState(''),[category,setCategory]=useState('すべて'),[personColumn,setPersonColumn]=useState(''),[operator,setOperator]=useState(localStorage.getItem('equipment-manager-operator')||''),[modal,setModal]=useState(null),[busy,setBusy]=useState(false),[syncing,setSyncing]=useState(false),[toast,setToast]=useState(null),[sideOpen,setSideOpen]=useState(false),[lastError,setLastError]=useState('');
  const notify=(text,kind='ok')=>{setToast({text,kind,key:Date.now()})};
  useEffect(()=>{if(!toast)return;const h=setTimeout(()=>setToast(null),5200);return()=>clearTimeout(h)},[toast]);
  const refresh=useCallback(async({silent=false,mode=null}={})=>{
    if(!silent)setSyncing(true);
    try{
      const s=await request('/api/snapshot');
      if(s.mode==='demo'){
        const saved=readDemo();const next=saved?.rows?.length?{...s,...saved,syncedAt:new Date().toISOString()}:s;demoRef.current=next;setData(next);
      }else setData(s);
      setLastError('');
    }catch(err){setLastError(err.message);if(!silent)notify(err.message,'err');}
    finally{setSyncing(false)}
  },[]);
  useEffect(()=>{let alive=true;(async()=>{try{const s=await request('/api/session');if(!alive)return;setSession(s);if(s.authorized)await refresh({silent:true})}catch(err){if(alive){setSession({mode:'error',authorized:false});setLastError(err.message)}}})();return()=>{alive=false}},[refresh]);
  useEffect(()=>{if(!session?.authorized||session.mode==='demo')return;const timer=setInterval(()=>{if(!busy&&!document.hidden)refresh({silent:true})},30000);const onFocus=()=>{if(!busy)refresh({silent:true})};window.addEventListener('focus',onFocus);return()=>{clearInterval(timer);window.removeEventListener('focus',onFocus)}},[session?.authorized,session?.mode,busy,refresh]);
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
  const changeAllocation=async(row,p,change)=>{
    if(!ensureOperator()||busy)return;
    const next=Math.max(0,itemCount(row,p)+change);
    if(next===itemCount(row,p))return;
    setBusy(true);
    try{await doEdit({row,column:p.column,value:next===0?'':String(next),reason:change>0?'貸出・割当':'返却・割当解除'});if(session.mode!=='demo')await refresh({silent:true});notify(`${p.name}さんの「${row.name}」を${change>0?'追加':'返却'}しました`)}catch(e){notify(e.message,'err');if(e.status===409)await refresh({silent:true})}finally{setBusy(false)}
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
    <aside className={'sidebar'+(sideOpen?' show':'')}><div className="brand"><div className="brand-icon"><Boxes size={22}/></div><div><strong>機材管理</strong><small>EQUIPMENT DESK</small></div></div><div className="sidebar-label">WORKSPACE</div><nav>{nav.map(n=><button key={n.id} className={'nav-link'+(page===n.id?' active':'')} onClick={()=>switchPage(n.id)}><n.icon size={19}/><span>{n.label}</span>{page===n.id&&<span className="nav-indicator"/>}</button>)}</nav><div className="side-spacer"/><div className="side-bottom"><div className="source-panel"><div className="source-logo"><FileSpreadsheet size={21}/></div><div><strong>Google Sheets連携</strong><small>{session.mode==='demo'?'デモデータを表示中':'原本と双方向で同期'}</small></div><span className={'status-dot'+(lastError?' offline':'')}/></div><div className="source-hint">{session.mode==='demo'?'編集内容はこのブラウザに保存されます。':'変更は原本へ保存。外部の変更は30秒ごとに取得します。'}</div></div></aside>
    {sideOpen&&<div className="mobile-backdrop" onClick={()=>setSideOpen(false)}/>}
    <div className="main-area"><header className="topbar"><div className="topbar-left"><IconButton icon={Menu} title="メニュー" onClick={()=>setSideOpen(true)}/><div className="breadcrumb">ワークスペース <ChevronRight size={14}/> <strong>{nav.find(n=>n.id===page)?.label}</strong></div></div><div className="topbar-right"><div className={'connection'+(lastError?' error-connection':'')}><span className="status-dot"/>{session.mode==='demo'?'デモモード':lastError?'同期エラー':syncing?'同期中':'同期済み'}</div><div className="operator"><UserRound size={17}/><select aria-label="操作する人" value={operator} onChange={e=>setOperatorPersist(e.target.value)}><option value="">操作する人を選択</option>{people.map(p=><option key={p.column} value={p.column}>{p.name}</option>)}</select><ChevronDown size={14}/></div><IconButton icon={RefreshCw} title="最新の状態に更新" onClick={()=>refresh()} disabled={syncing}/></div></header>
    <main className="content"><div className="page-top"><div><div className="eyebrow">EQUIPMENT MANAGEMENT <span className="eyebrow-line"/></div><h1>{page==='dashboard'?'機材管理 ダッシュボード':page==='assets'?'機材一覧':page==='people'?'個人別の使用状況':'変更履歴'}</h1><p>{page==='dashboard'?'事務所全体の保有機材と使用状況を確認できます。':page==='assets'?'機材の情報と貸出状況をまとめて管理します。':page==='people'?'スタッフごとの機材の割当状況を確認・更新します。':'Webから行われた操作を記録しています。'}</p></div><div className="page-actions">{data?.sheetUrl&&<a className="button light" href={data.sheetUrl} target="_blank" rel="noreferrer"><FileSpreadsheet size={16}/> スプシを開く <ExternalLink size={13}/></a>}{page==='assets'&&<button className="button primary" onClick={()=>setModal({kind:'create'})}><Plus size={17}/> 機材を追加</button>}{page==='dashboard'&&<button className="button primary" onClick={()=>switchPage('assets')}><Boxes size={17}/> 機材一覧を見る</button>}</div></div>
    {session.mode==='demo'&&<div className="demo-banner"><CircleAlert size={16}/> これはサンプルデータです。実際のスプシと双方向接続するには README に従って設定してください。</div>}
    {lastError&&<div className="notice error"><CloudOff size={18}/><div><strong>スプレッドシートの更新を取得できませんでした。</strong><p>{lastError}（直前の表示を維持しています）</p></div><button className="text-link" onClick={()=>refresh()}>再試行</button></div>}
    {page==='dashboard'&&<Dashboard summary={summary} rows={rows} people={people} history={history} onNavigate={switchPage} onSelectPerson={col=>{setPersonColumn(col);switchPage('people')}}/>}
    {page==='assets'&&<><div className="toolbar"><div className="search"><Search size={18}/><input aria-label="機材を検索" placeholder="機材名、型番、備考で検索..." value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button title="検索を消去" onClick={()=>setQuery('')}><X size={16}/></button>}</div><div className="category-select"><Filter size={15}/><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select><ChevronDown size={14}/></div><span className="result-count">{filteredRows.length} 件の機材</span></div><div className="table-wrap"><table className="asset-table"><thead><tr><th>機材情報</th><th>カテゴリ</th><th className="num">稼働</th><th className="num">備品</th><th className="num">総数</th><th>個人への割当</th><th className="right">操作</th></tr></thead><tbody>{filteredRows.map(r=><tr key={r.sheetRow}><td><div className="asset-cell"><span className="equipment-icon"><Monitor size={19}/></span><div><strong>{r.name}</strong><small>{r.model||'型番未登録'}</small></div></div></td><td><Tag color={r.category==='作業環境'?'blue':r.category==='周辺機器'?'purple':'neutral'}>{r.category||'未分類'}</Tag></td><td className="num"><b>{r.active===''?'—':r.active}</b></td><td className="num"><b>{r.spares===''?'—':r.spares}</b></td><td className="num"><b>{r.total===''?'—':r.total}</b></td><td><div className="assignment-cell">{people.filter(p=>itemCount(r,p)>0).slice(0,3).map(p=><span key={p.column} className="person-avatar" title={`${p.name}：${itemCount(r,p)}`}>{p.name.slice(0,1)}</span>)}{people.filter(p=>itemCount(r,p)>0).length>3&&<span className="avatar-more">+{people.filter(p=>itemCount(r,p)>0).length-3}</span>}{!people.some(p=>itemCount(r,p)>0)&&<span className="muted">未割当</span>}<span className="assignment-count">{people.filter(p=>itemCount(r,p)>0).length} 人</span></div></td><td className="right"><div className="row-actions"><button className="small-button" onClick={()=>setModal({kind:'assign',row:r})}><Plus size={15}/> 割当</button><button className="small-button subtle" onClick={()=>setModal({kind:'edit',row:r})}>編集 <ChevronRight size={14}/></button></div></td></tr>)}</tbody></table>{filteredRows.length===0&&<Blank icon={Search} title="該当する機材がありません" description="検索条件を変更してください。"/>}</div><p className="table-foot"><ShieldCheck size={15}/>「稼働」「総数」はスプレッドシートの自動計算結果を表示します。Web側で直接書き換えません。</p></>}
    {page==='people'&&<><div className="people-choices">{people.map(p=>{const owned=rows.filter(r=>itemCount(r,p)>0);const qty=owned.reduce((n,r)=>n+itemCount(r,p),0);return <button key={p.column} className={'person-choice'+(selectedPerson?.column===p.column?' selected':'')} onClick={()=>setPersonColumn(p.column)}><span className="person-initial">{p.name.slice(0,1)}</span><span className="person-choice-text"><strong>{p.name}</strong><small>{owned.length}種類 · {qty}点</small></span><ChevronRight size={17}/></button>})}</div>{selectedPerson?<PersonDetail person={selectedPerson} rows={rows} busy={busy} onChange={changeAllocation} onAssign={r=>setModal({kind:'assign',row:r,defaultPerson:selectedPerson.column})}/>:<Blank icon={UsersRound} title="担当者が登録されていません" description="スプシの2行目、K列以降の見出しを確認してください。"/>}</>}
    {page==='history'&&<><div className="history-heading"><div><h3>操作ログ</h3><p>Webで行った編集・割当操作を表示します。スプシで直接編集した操作はGoogle側の変更履歴で確認してください。</p></div><Pill>最新 {history.length} 件</Pill></div><div className="history-list">{history.length?history.map((h,i)=><div className="history-row" key={i}><span className="history-bullet"><History size={17}/></span><div className="history-main"><div><strong>{h.asset}</strong><span className="history-action">{h.action}</span></div><p>{h.person?`${h.person} · `:''}{h.before||'空欄'} <ArrowRight size={13}/> {h.after||'空欄'}</p></div><div className="history-meta"><strong>{h.actor||'未指定'}</strong><small>{dateTime(h.time)}</small></div></div>):<Blank icon={History} title="変更履歴はまだありません" description="Webで編集すると、操作内容が記録されます。"/>}</div></>}
    <footer className="content-footer"><span><span className={'status-dot'+(lastError?' offline':'')}/> {session.mode==='demo'?'デモデータ':'Google Sheetsと接続'} · {data?.syncedAt?`最終取得 ${dateTime(data.syncedAt)}`:'未取得'}</span><span>30秒ごとに自動更新 · 手動更新も可能</span></footer>
    </main></div>
    {modal?.kind==='edit'&&<EditModal row={modal.row} busy={busy} onClose={()=>!busy&&setModal(null)} onSave={values=>saveItem(modal.row,values)}/>}
    {modal?.kind==='create'&&<CreateModal categories={categories.filter(c=>c!=='すべて')} busy={busy} onClose={()=>!busy&&setModal(null)} onSave={createItem}/>}
    {modal?.kind==='assign'&&<AssignModal row={rows.find(r=>r.sheetRow===modal.row.sheetRow)||modal.row} people={people} defaultPerson={modal.defaultPerson||operator||people[0]?.column} busy={busy} onClose={()=>setModal(null)} onChange={changeAllocation}/>}
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
  const [filter,setFilter]=useState('assigned'),[term,setTerm]=useState('');
  const assigned=rows.filter(r=>itemCount(r,person)>0);
  const shown=rows.filter(r=>(filter==='all'||itemCount(r,person)>0)&&[r.name,r.model,r.category].join(' ').toLowerCase().includes(term.toLowerCase()));
  return <div className="person-detail"><div className="person-summary"><span className="person-hero-avatar">{person.name.slice(0,1)}</span><div><h2>{person.name} <small>さんの機材</small></h2><p>現在割り当てられている機材を管理できます。</p></div><div className="person-total"><strong>{assigned.reduce((n,r)=>n+itemCount(r,person),0)}</strong><span>合計点数</span></div><div className="person-total"><strong>{assigned.length}</strong><span>機材の種類</span></div></div><div className="person-tools"><div className="segmented"><button className={filter==='assigned'?'on':''} onClick={()=>setFilter('assigned')}>使用中 ({assigned.length})</button><button className={filter==='all'?'on':''} onClick={()=>setFilter('all')}>すべての機材 ({rows.length})</button></div><div className="search person-search"><Search size={16}/><input value={term} onChange={e=>setTerm(e.target.value)} placeholder="機材を検索"/></div></div><div className="assigned-grid">{shown.map(r=><div className="assigned-card" key={r.sheetRow}><div className="assigned-main"><span className="equipment-icon"><Monitor size={19}/></span><div><strong>{r.name}</strong><small>{r.model||r.category||'機材'}</small></div></div><div className="quantity-row"><span>割当数</span><div className="stepper"><button aria-label={`${r.name}を1つ返却`} disabled={busy||itemCount(r,person)===0} onClick={()=>onChange(r,person,-1)}><Minus size={16}/></button><b>{itemCount(r,person)}</b><button aria-label={`${r.name}を1つ割当`} disabled={busy} onClick={()=>onChange(r,person,1)}><Plus size={16}/></button></div></div></div>)}</div>{shown.length===0&&<Blank icon={Package} title="機材が見つかりません" description="「すべての機材」を選択すると、新たに割り当てられます。"/>}</div>
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
function AssignModal({row,people,defaultPerson,busy,onClose,onChange}){
  const [selected,setSelected]=useState(defaultPerson||people[0]?.column||'');const p=people.find(p=>p.column===selected)||people[0];
  return <Modal title="機材の割当・返却" subtitle={`${row.name} ${row.model?`/ ${row.model}`:''}`} onClose={onClose}><div className="assign-info"><div><span>稼働</span><strong>{row.active||'—'}</strong></div><div><span>備品</span><strong>{row.spares||'—'}</strong></div><div><span>総数</span><strong>{row.total||'—'}</strong></div></div><label className="form-field assign-selector"><span>割当先のスタッフ</span><select value={selected} onChange={e=>setSelected(e.target.value)}>{people.map(x=><option key={x.column} value={x.column}>{x.name}</option>)}</select></label>{p&&<div className="assign-controls"><span className="person-avatar large">{p.name.slice(0,1)}</span><div className="assign-person"><strong>{p.name}</strong><small>現在の割当数 : {itemCount(row,p)}点</small></div><div className="stepper big"><button disabled={busy||!itemCount(row,p)} onClick={()=>onChange(row,p,-1)}><Minus size={18}/></button><b>{itemCount(row,p)}</b><button disabled={busy} onClick={()=>onChange(row,p,1)}><Plus size={18}/></button></div></div>}<p className="modal-note">＋で割当、－で返却（個人のセル値を更新）。備品数 G列は自動では増減しません。</p><div className="modal-actions"><button type="button" className="button light" onClick={onClose}>閉じる</button></div></Modal>
}

createRoot(document.getElementById('root')).render(<App/>);
