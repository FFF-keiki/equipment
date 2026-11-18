// Pure validation: an edited matrix cell represents the new TOTAL assigned to a person.
// The backend /api/allocation receives only the delta, preserving warehouse stock.
export function allocationDelta(current,raw) {
  const before=Number(current);
  if(!Number.isSafeInteger(before)||before<0||before>99999)throw new Error('現在の割当数が不正です。最新データに更新してください。');
  const value=String(raw??'').trim();
  if(value!==''&&!/^\d{1,5}$/.test(value))throw new Error('割当数は0〜99999の整数で入力してください。');
  const next=value===''?0:Number(value);
  if(!Number.isSafeInteger(next)||next>99999)throw new Error('割当数は0〜99999の整数で入力してください。');
  return next-before;
}
