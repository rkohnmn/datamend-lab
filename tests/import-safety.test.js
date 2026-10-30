import test from 'node:test';
import assert from 'node:assert/strict';
import {assertInputSize, assertTableSize, readDelimitedRecords, missingNumber} from '../js/import-safety.js';
test('interactive byte and cell bounds reject large inputs', () => {
  assert.doesNotThrow(()=>assertInputSize(2*1024*1024));
  assert.throws(()=>assertInputSize(2*1024*1024+1), /2 MB/);
  assert.throws(()=>assertInputSize('🙂'.repeat(600000)), /2 MB/);
  assert.throws(()=>assertTableSize(5001,2), /5,000/);
  assert.throws(()=>assertTableSize(3000,40), /100,000/);
});
test('quoted records preserve commas, escaped quotes, BOM and embedded newlines', () => {
  const {records} = readDelimitedRecords('\uFEFFlabel,value\r\n"A, B",2\r\n"A\nB",3\r\n"He said ""yes""",4');
  assert.deepEqual(records, [['label','value'],['A, B','2'],['A\nB','3'],['He said "yes"','4']]);
});
test('malformed quoted records are rejected',()=>{
  assert.throws(()=>readDelimitedRecords('a,b\n"open,2'),/Unclosed/);
  assert.throws(()=>readDelimitedRecords('a,b\n"closed"oops,2'),/Unexpected/);
});
test('missing values are never converted to observed zero',()=>{
  for (const x of [null,undefined,'',' ','NA','null',false,{}]) assert.ok(Number.isNaN(missingNumber(x)));
  assert.equal(missingNumber('0'),0);
  assert.equal(missingNumber('-12.5'),-12.5);
});
import {parseDelimitedText, parseJsonContent} from '../js/parsers.js';
test('DataMend applies bounds to file and paste parser paths',()=>{
  assert.throws(()=>parseDelimitedText('a,b\n'+'1,2\n'.repeat(5001)),/5,000/);
  assert.throws(()=>parseJsonContent(JSON.stringify(Array.from({length:5001},()=>({a:1})))),/5,000/);
  const result=parseDelimitedText('id,value\n001,2\n002,3');
  assert.equal(result.rawRows[0][0],'001');
});
