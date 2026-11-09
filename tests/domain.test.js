import test from 'node:test';
import assert from 'node:assert/strict';
import {colToIndex,indexToCol,sheetRef,parseSheet,validateEdit} from '../src/domain.js';

test('A1 index supports multi-letter columns',()=>{
  assert.equal(colToIndex('A'),1);
  assert.equal(colToIndex('K'),11);
  assert.equal(colToIndex('BB'),54);
  assert.equal(indexToCol(54),'BB');
  assert.equal(indexToCol(703),'AAA');
});
test('Sheet tab names are safely escaped',()=>{
  assert.equal(sheetRef("制作'資材",'A2:BB100'),"'制作''資材'!A2:BB100");
});
test('Rows and staff columns preserve sheet coordinates',()=>{
  const header=['カテゴリ','備品名','型番','備考','更新日','稼働','備品','総数','購入日','耐用年数','佐藤','田中'];
  const values=[header,['作業環境','モニター','EIZO','','2026/11/09','2','1','3','','5','1','1'],[],['周辺機器','USBハブ','','','','0','4','4','','3','','']];
  const actual=parseSheet(values,{HEADER_ROW:'2',FIRST_DATA_ROW:'3',PERSON_START_COLUMN:'K',PERSON_END_COLUMN:'L'});
  assert.deepEqual(actual.people,[{id:'K',column:'K',name:'佐藤'},{id:'L',column:'L',name:'田中'}]);
  assert.equal(actual.rows.length,2);
  assert.equal(actual.rows[0].sheetRow,3);
  assert.equal(actual.rows[1].sheetRow,5);
  assert.equal(actual.rows[0].allocations.K,'1');
  assert.equal(actual.rows[0].allocations.L,'1');
});
test('Formula columns F/H and invalid fields cannot be edited',()=>{
  const config={FIRST_DATA_ROW:'3',MAX_DATA_ROWS:'1000'};
  const people=[{column:'K',name:'佐藤'}];
  assert.throws(()=>validateEdit({column:'F',sheetRow:3,value:'99'},config,people));
  assert.throws(()=>validateEdit({column:'H',sheetRow:3,value:'99'},config,people));
  assert.throws(()=>validateEdit({column:'K',sheetRow:3,value:'-1'},config,people));
  assert.equal(validateEdit({column:'K',sheetRow:3,value:'2'},config,people).value,'2');
  assert.equal(validateEdit({column:'B',sheetRow:3,value:'新モニター'},config,people).value,'新モニター');
});
