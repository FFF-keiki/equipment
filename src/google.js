import { asCount, colToIndex, indexToCol, normalizeCell, parseSheet, sheetRef, validateEdit } from './domain.js';

const tokens = new Map();
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function utf8B64(text) { return base64url(new TextEncoder().encode(text)); }
function pemBytes(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  return Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
}
async function bearer(env) {
  const cached = tokens.get(env.SERVICE_ACCOUNT_EMAIL);
  if (cached && cached.expiry > Date.now() + 120_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: env.SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const header = { alg: 'RS256', typ: 'JWT' };
  const unsigned = `${utf8B64(JSON.stringify(header))}.${utf8B64(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(env.SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')), {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const json = await response.json();
  if (!response.ok || !json.access_token) throw new Error(`Google 認証エラー: ${json.error_description || json.error || response.status}`);
  tokens.set(env.SERVICE_ACCOUNT_EMAIL, { token: json.access_token, expiry: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}
async function request(env, path, options={}) {
  const token = await bearer(env);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SPREADSHEET_ID)}${path}`, {
    ...options, headers: {Authorization: `Bearer ${token}`, ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers}
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = json?.error?.message || response.statusText;
    const error = new Error(`Google Sheets API (${response.status}): ${msg}`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  return json;
}
function cfg(env) {
  return {
    SHEET_TAB: env.SHEET_TAB || '機材管理', HEADER_ROW: env.HEADER_ROW || '2',
    FIRST_DATA_ROW: env.FIRST_DATA_ROW || '3', PERSON_START_COLUMN: env.PERSON_START_COLUMN || 'K',
    PERSON_END_COLUMN: env.PERSON_END_COLUMN || 'BB', MAX_DATA_ROWS: env.MAX_DATA_ROWS || '1000',
    AUDIT_TAB: env.AUDIT_TAB || '操作履歴'
  };
}
function getRange(env) {
  const c = cfg(env);
  return sheetRef(c.SHEET_TAB, `A${c.HEADER_ROW}:${c.PERSON_END_COLUMN}${c.MAX_DATA_ROWS}`);
}
async function getValues(env, range, option='FORMATTED_VALUE') {
  const json = await request(env, `/values/${encodeURIComponent(range)}?valueRenderOption=${option}`);
  return json.values || [];
}
export async function snapshot(env) {
  const c = cfg(env);
  const values = await getValues(env, getRange(env));
  const parsed = parseSheet(values, c);
  const audit = await readAudit(env).catch(() => []);
  return { ...parsed, history: audit, mode: 'live', sheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(env.SPREADSHEET_ID)}/edit`, syncedAt: new Date().toISOString() };
}
async function metadata(env) {
  return request(env, '?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))');
}
async function writeValues(env, data, mode='RAW') {
  return request(env, '/values:batchUpdate', { method:'POST', body:JSON.stringify({ valueInputOption:mode, data }) });
}
async function appendAudit(env, record) {
  const tab = cfg(env).AUDIT_TAB;
  const payload = { values:[record.map(v => v == null ? '' : String(v))] };
  const path = `/values/${encodeURIComponent(sheetRef(tab, 'A:I'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  try { await request(env, path, { method:'POST', body:JSON.stringify(payload) }); }
  catch (error) {
    // Auto-create the dedicated audit tab on first use; do not alter the existing equipment tab.
    if (!/Unable to parse range|not found/i.test(error.message)) throw error;
    try {
      await request(env, ':batchUpdate', { method:'POST', body: JSON.stringify({ requests:[{addSheet:{properties:{title:tab}}}] }) });
    } catch (createError) {
      if (!/already exists/i.test(createError.message)) throw createError;
    }
    await writeValues(env, [{range:sheetRef(tab,'A1:I1'),values:[['日時','操作者','操作','シート行','備品名','対象者 / 項目','変更前','変更後','詳細']]}]);
    await request(env, path, { method:'POST', body:JSON.stringify(payload) });
  }
}
async function readAudit(env) {
  const values = await getValues(env, sheetRef(cfg(env).AUDIT_TAB, 'A2:I1000'));
  return values.slice(-100).reverse().map(r => ({ time:r[0]||'', actor:r[1]||'', action:r[2]||'', sheetRow:r[3]||'', asset:r[4]||'', person:r[5]||'', before:r[6]||'', after:r[7]||'', detail:r[8]||'' }));
}
export class ConflictError extends Error { constructor(message) { super(message); this.status = 409; } }
export async function editCell(env, input) {
  const c = cfg(env);
  const header = await getValues(env, sheetRef(c.SHEET_TAB, `A${c.HEADER_ROW}:${c.PERSON_END_COLUMN}${c.HEADER_ROW}`));
  const people = parseSheet(header, {...c, FIRST_DATA_ROW: String(Number(c.HEADER_ROW)+1)}).people;
  const target = validateEdit(input, c, people);
  const rowCells = (await getValues(env, sheetRef(c.SHEET_TAB, `A${target.row}:${c.PERSON_END_COLUMN}${target.row}`)))[0] || [];
  const currentName = normalizeCell(rowCells[1]);
  if (!currentName || currentName !== normalizeCell(input.expectedName)) throw new ConflictError('対象行が変更されています。再読み込みしてください。');
  const actual = normalizeCell(rowCells[colToIndex(target.column) - 1]);
  if (actual !== normalizeCell(input.expected)) throw new ConflictError(`他の人が「${target.label}」を更新しました。最新の状態を確認してください。`);
  if (actual === target.value) return { changed:false };
  const cell = sheetRef(c.SHEET_TAB, `${target.column}${target.row}`);
  // RAW prevents text input from being interpreted as executable formulas.
  const numeric = !!target.personnel || ['G','J'].includes(target.column);
  const value = numeric && target.value !== '' ? Number(target.value) : target.value;
  const mode = ['I','E'].includes(target.column) ? 'USER_ENTERED' : 'RAW';
  await writeValues(env, [{ range:cell, values:[[value]] }], mode);
  let warning = '';
  try {
    await appendAudit(env, [new Date().toISOString(), input.actor || '未指定', target.personnel ? '割当変更' : '備品情報更新', String(target.row), currentName, target.label, actual, target.value, input.note || '']);
  } catch (error) { warning = `変更は保存されましたが、履歴の記録に失敗しました: ${error.message}`; }
  return { changed:true, warning };
}
export async function createAsset(env, input) {
  const c = cfg(env);
  const name = normalizeCell(input.name);
  if (!name || name.length > 150) throw new Error('備品名は1～150文字で入力してください。');
  for (const key of ['category','model','note']) if (normalizeCell(input[key]).length > 2000) throw new Error('入力値が長すぎます。');
  const spares = normalizeCell(input.spares || '0');
  if (!/^\d{1,5}$/.test(spares)) throw new Error('備品数は0以上の整数を指定してください。');
  const values = await getValues(env, getRange(env));
  const { rows } = parseSheet(values, c);
  const lastRow = Math.max(Number(c.FIRST_DATA_ROW)-1, ...rows.map(r=>r.sheetRow));
  const nextRow = lastRow+1;
  if (nextRow > Number(c.MAX_DATA_ROWS)) throw new Error('管理可能な行数を超えました。MAX_DATA_ROWS を増やしてください。');
  const occupied = (await getValues(env, sheetRef(c.SHEET_TAB, `A${nextRow}:${c.PERSON_END_COLUMN}${nextRow}`)))[0] || [];
  if (occupied.some(v => normalizeCell(v))) throw new ConflictError('追加先に既存データがあります。原本シートで行の状態を確認してください。');
  const md = await metadata(env);
  const sheet = (md.sheets || []).find(s => s.properties.title === c.SHEET_TAB);
  if (!sheet) throw new Error(`「${c.SHEET_TAB}」タブが見つかりません。`);
  const id = sheet.properties.sheetId;
  const gridRows = sheet.properties.gridProperties.rowCount;
  const endColumn = Math.min(colToIndex(c.PERSON_END_COLUMN), sheet.properties.gridProperties.columnCount);
  const requests = [];
  if (nextRow > gridRows) requests.push({appendDimension:{sheetId:id,dimension:'ROWS',length:nextRow-gridRows}});
  // Preserve the previous row's validation/formatting/formulas, without copying its values.
  if (lastRow >= Number(c.FIRST_DATA_ROW)) {
    const source = {sheetId:id,startRowIndex:lastRow-1,endRowIndex:lastRow,startColumnIndex:0,endColumnIndex:endColumn};
    const destination = {sheetId:id,startRowIndex:nextRow-1,endRowIndex:nextRow,startColumnIndex:0,endColumnIndex:endColumn};
    requests.push({copyPaste:{source,destination,pasteType:'PASTE_FORMAT'}});
    requests.push({copyPaste:{source,destination,pasteType:'PASTE_DATA_VALIDATION'}});
    requests.push({copyPaste:{source,destination,pasteType:'PASTE_FORMULA'}});
  }
  if (requests.length) await request(env, ':batchUpdate', {method:'POST',body:JSON.stringify({requests})});
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','/');
  await writeValues(env, [
    {range:sheetRef(c.SHEET_TAB, `A${nextRow}:E${nextRow}`),values:[[input.category||'',name,input.model||'',input.note||'',today]]},
    {range:sheetRef(c.SHEET_TAB, `G${nextRow}`),values:[[Number(spares)]]},
    {range:sheetRef(c.SHEET_TAB, `I${nextRow}:J${nextRow}`),values:[[input.purchasedAt||'',input.lifespan ? Number(input.lifespan) : '']]}
  ],'RAW');
  let warning = '';
  try { await appendAudit(env, [new Date().toISOString(),input.actor||'未指定','備品追加',String(nextRow),name,'', '',spares,'新規登録']); }
  catch (err) { warning = `機材は追加されましたが、履歴の記録に失敗しました: ${err.message}`; }
  return {sheetRow:nextRow,warning};
}
