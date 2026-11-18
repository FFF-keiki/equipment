import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationDelta } from '../web/grid-edit.js';

test('direct matrix entry yields one inventory transfer delta', () => {
  assert.equal(allocationDelta(1,'4'),3); // +3 assigned, -3 warehouse
  assert.equal(allocationDelta(4,'1'),-3); // -3 assigned, +3 warehouse
  assert.equal(allocationDelta(2,'2'),0); // no request should be sent
  assert.equal(allocationDelta(2,'0'),-2);
  assert.equal(allocationDelta(2,''),-2); // clearing a cell means zero
});
test('invalid input is rejected before reaching the Sheets API', () => {
  for (const invalid of ['-1', '1.5', '1e3', '100000', '123abc', '1,000', '１２']) {
    assert.throws(()=>allocationDelta(2,invalid), /整数/);
  }
});
