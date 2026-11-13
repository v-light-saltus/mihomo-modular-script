const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { root, fixture, clone } = require('./helpers');
test('公开完整脚本与模块源码一致，默认不改变原配置', () => {
  const { assemble } = require('../scripts/assemble');
  const code = fs.readFileSync(path.join(root, 'global.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(code, assemble());
  const ctx = { input: fixture(), console };
  vm.runInNewContext(code + '\nresult=main(input);', ctx);
  assert.deepEqual(clone(ctx.result), fixture());
});
