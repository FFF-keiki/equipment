const names = ['佐藤', '田中', '鈴木', '高橋', '伊藤', '山本', '中村', '小林'];
export const demoPeople = names.map((name, i) => ({ id: String.fromCharCode(75 + i), column: String.fromCharCode(75 + i), name }));
const source = [
  ['作業環境','有線キーボード','USB Keyboard','共用スペース',3,12,15,'2024/04/01',5,[2,2,1,2,1,1,1,2]],
  ['作業環境','無線マウス','MX Master','',4,8,12,'2025/02/01',5,[1,1,1,1,1,1,1,1]],
  ['作業環境','モニター','DELL 27インチ FHD','会議室用含む',2,11,13,'2023/06/12',7,[2,1,2,2,1,1,1,1]],
  ['作業環境','モニター','EIZO ColorEdge','色管理用',1,3,4,'2023/03/10',7,[0,0,1,0,1,0,1,0]],
  ['作業環境','液晶タブレット','Wacom Cintiq 16','',3,6,9,'2024/11/03',6,[1,1,1,1,1,1,0,0]],
  ['作業環境','ペンタブレット','Wacom Intuos','',5,5,10,'2022/10/13',6,[1,1,0,0,1,0,1,1]],
  ['作業環境','作業用デスク','昇降デスク','',1,8,9,'2021/02/10',10,[1,1,1,1,1,1,1,1]],
  ['作業環境','作業用イス','オフィスチェア','',2,8,10,'2021/02/10',8,[1,1,1,1,1,1,1,1]],
  ['撮影機材','WEBカメラ','ELECOM HD','',2,3,5,'2025/05/24',5,[0,1,0,0,1,0,1,0]],
  ['周辺機器','USBハブ','Anker 7-in-1','',3,4,7,'2025/09/20',5,[1,0,1,0,1,0,1,0]],
  ['周辺機器','ヘッドホン','SONY MDR','',1,5,6,'2024/01/20',5,[1,1,0,1,0,1,1,0]],
  ['周辺機器','HDMIケーブル','2m','',7,7,14,'2025/08/01',3,[1,1,1,1,1,1,1,0]],
  ['撮影機材','三脚','Manfrotto 190','',2,2,4,'2024/07/01',7,[1,0,0,1,0,0,0,0]],
  ['撮影機材','LEDライト','Aputure','',2,2,4,'2025/03/12',6,[0,1,1,0,0,0,0,0]],
];
export const demoRows = source.map((r, i) => ({
  sheetRow: i + 3, category: r[0], name: r[1], model: r[2], note: r[3],
  updatedAt: '2026/11/09', active: String(r[5]), spares: String(r[4]), total: String(r[6]), purchasedAt: r[7], lifespan: String(r[8]),
  allocations: Object.fromEntries(demoPeople.map((p, j) => [p.column, r[9][j] ? String(r[9][j]) : '']).filter(([, n]) => n))
}));
export const demoHistory = [
  { time:'2026/11/09 10:42', actor:'佐藤', action:'割当変更', asset:'モニター', person:'田中', before:'0', after:'1' },
  { time:'2026/11/09 09:18', actor:'中村', action:'割当変更', asset:'USBハブ', person:'小林', before:'2', after:'1' },
  { time:'2026/11/08 16:24', actor:'鈴木', action:'備品情報更新', asset:'液晶タブレット', person:'', before:'', after:'点検完了' }
];
