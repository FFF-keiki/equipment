import test from 'node:test';
import assert from 'node:assert/strict';
import {planAllocation} from '../src/domain.js';

const base = {currentAssigned:'2',currentSpares:'5',expectedAssigned:'2',expectedSpares:'5'};
test('two-unit checkout conserves total', () => {
  const r=planAllocation({...base,delta:2});
  assert.equal(r.nextAssigned,4);
  assert.equal(r.nextSpares,3);
  assert.equal(r.assigned+r.spares,r.nextAssigned+r.nextSpares);
});
test('return restores warehouse quantity and can clear assignment', () => {
  const r=planAllocation({...base,delta:-2});
  assert.equal(r.nextAssigned,0);
  assert.equal(r.nextSpares,7);
});
test('not enough available stock prevents checkout', () => {
  assert.throws(()=>planAllocation({...base,delta:6}),/不足/);
});
test('return cannot exceed assigned units', () => {
  assert.throws(()=>planAllocation({...base,delta:-3}),/返却可能/);
});
test('stale warehouse or allocation values reject both edits', () => {
  assert.throws(()=>planAllocation({...base,expectedSpares:'4',delta:1}),{status:409});
  assert.throws(()=>planAllocation({...base,expectedAssigned:'1',delta:1}),{status:409});
});
test('empty person cells are equivalent to zero', () => {
  const r=planAllocation({currentAssigned:'',expectedAssigned:'0',currentSpares:'1',expectedSpares:'1',delta:1});
  assert.equal(r.nextAssigned,1); assert.equal(r.nextSpares,0);
});
test('negative and fractional changes are invalid', () => {
  assert.throws(()=>planAllocation({...base,delta:1.5}));
  assert.throws(()=>planAllocation({...base,delta:0}));
  assert.throws(()=>planAllocation({...base,currentSpares:'-1',delta:1}));
});

test('formatted thousand separators are accepted in Sheets values', () => {
  const r=planAllocation({currentAssigned:'1,000',currentSpares:'2,000',expectedAssigned:'1000',expectedSpares:'2,000',delta:3});
  assert.equal(r.nextAssigned,1003);assert.equal(r.nextSpares,1997);
});
