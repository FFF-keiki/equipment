// Pure functions shared by the Worker and tests. A1 columns are 1-based.
export function colToIndex(col) {
  if (!/^[A-Z]+$/.test(col)) throw new Error('Invalid A1 column');
  return [...col].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
}
export function indexToCol(index) {
  if (!Number.isInteger(index) || index < 1) throw new Error('Invalid column index');
  let result = '';
  while (index > 0) { index--; result = String.fromCharCode(65 + (index % 26)) + result; index = Math.floor(index / 26); }
  return result;
}
export function sheetRef(tab, range) { return `'${tab.replaceAll("'", "''")}'!${range}`; }
export function normalizeCell(value) { return value == null ? '' : String(value).trim(); }
export function asCount(value) {
  if (value === '' || value == null) return 0;
  const n = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(n) ? n : 0;
}
export function parseSheet(values, cfg) {
  const headerRow = Number(cfg.HEADER_ROW || 2);
  const firstRow = Number(cfg.FIRST_DATA_ROW || 3);
  const start = colToIndex(cfg.PERSON_START_COLUMN || 'K');
  const end = colToIndex(cfg.PERSON_END_COLUMN || 'BB');
  const header = values[0] || [];
  const people = [];
  for (let idx = start; idx <= end; idx++) {
    const name = normalizeCell(header[idx - 1]);
    if (name) people.push({ id: indexToCol(idx), column: indexToCol(idx), name });
  }
  const rows = [];
  for (let i = Math.max(0, firstRow - headerRow); i < values.length; i++) {
    const cells = values[i] || [];
    if (!normalizeCell(cells[1])) continue;
    const allocations = {};
    for (const person of people) {
      const original = normalizeCell(cells[colToIndex(person.column) - 1]);
      if (original !== '') allocations[person.column] = original;
    }
    rows.push({
      sheetRow: headerRow + i,
      category: normalizeCell(cells[0]),
      name: normalizeCell(cells[1]),
      model: normalizeCell(cells[2]),
      note: normalizeCell(cells[3]),
      updatedAt: normalizeCell(cells[4]),
      active: normalizeCell(cells[5]),
      spares: normalizeCell(cells[6]),
      total: normalizeCell(cells[7]),
      purchasedAt: normalizeCell(cells[8]),
      lifespan: normalizeCell(cells[9]),
      allocations
    });
  }
  return { people, rows };
}
export const EDITABLE_COLUMNS = Object.freeze({
  A: 'カテゴリ', B: '備品名', C: '型番', D: '備考', E: '記載・更新日',
  G: '備品数', I: '購入日', J: '耐用年数'
});
export function validateEdit(input, cfg, people) {
  const column = String(input.column || '').toUpperCase();
  const personnel = people.find(p => p.column === column);
  if (!EDITABLE_COLUMNS[column] && !personnel) throw new Error('この列はWeb側から更新できません（自動計算列は保護します）。');
  const row = Number(input.sheetRow);
  if (!Number.isSafeInteger(row) || row < Number(cfg.FIRST_DATA_ROW || 3) || row > Number(cfg.MAX_DATA_ROWS || 1000)) throw new Error('不正な行番号です。');
  const value = normalizeCell(input.value);
  if (value.length > 2000) throw new Error('入力できる文字数は最大2000文字です。');
  if ((personnel || column === 'G' || column === 'J') && value !== '') {
    if (!/^\d+$/.test(value) || Number(value) > 99999) throw new Error('数量・年数は0以上の整数を入力してください。');
  }
  if (column === 'B' && !value) throw new Error('備品名は必須です。');
  return { row, column, value, personnel, label: EDITABLE_COLUMNS[column] || personnel?.name || '' };
}
