const test = require('node:test');
const assert = require('node:assert/strict');
const { run, visible, fixture, customNodes, residential, groups } = require('./helpers');

test('未启用任何模块时不改变订阅', () => {
  assert.deepEqual(run(fixture()), fixture());
});

test('空订阅可组合生成节点、策略组和分流', () => {
  const output = run({}, { customNodes, residential, groups,
    routing: { enabled: true, rules: [['DOMAIN', 'example.org', '缺失目标']] },
  });
  assert.equal(output.rules[0], 'DOMAIN,example.org,DIRECT');
  assert(visible(output, '全部出口').includes('住宅出口'));
  assert.deepEqual(visible(output, '私网选择'), ['DIRECT', '私网出口', '直接出口']);
});
test('自定义节点独立工作，删除模块后参数不产生作用', () => {
  const output = run(fixture(), { customNodes });
  assert(output.proxies.some(p => p.name === '私网出口'));
  assert.deepEqual(run(fixture(), { customNodes }, []), fixture());
  assert.deepEqual(output.dns, fixture().dns);
  assert.deepEqual(output.tun, fixture().tun);
});
test('新顺序为住宅、DIRECT、私网出口，原选择与原 MATCH 保留', () => {
  const output = run(fixture(), { customNodes, residential, groups });
  const original = output['proxy-groups'].find(g => g.name === '原选择');
  assert.deepEqual(original.proxies.slice(0, 4), ['住宅出口', 'DIRECT', '私网出口', '直接出口']);
  assert.equal(original['default-selected'], '普通节点');
  assert(!visible(output, '原选择').includes('私网底层'));
  assert.deepEqual(visible(output, '私网选择'), ['DIRECT', '私网出口', '直接出口']);
  assert.equal(output.rules.at(-1), 'MATCH,原选择');
  assert.deepEqual(output.profile, fixture().profile);
});
test('住宅独立时不修改 DNS、入站和 provider，前置默认测速', () => {
  const input = fixture();
  input['proxy-providers'] = { remote: { type: 'http', url: 'https://example.invalid/pool' } };
  const output = run(input, { residential });
  assert.equal(output['proxy-groups'].find(g => g.name === '前置选择')['default-selected'], '前置测速');
  assert.deepEqual(output.dns, input.dns);
  assert.deepEqual(output['proxy-providers'], input['proxy-providers']);
  assert.equal(output.listeners, undefined);
});
test('前置测速排除私网链路，模块粘贴顺序不影响结果', () => {
  const options = { customNodes, residential, groups };
  const output = run(fixture(), options);
  assert.deepEqual(visible(output, '前置测速'), ['普通节点']);
  assert.deepEqual(output, run(fixture(), options, ['groups', 'residential', 'customNodes']));
  assert.deepEqual(output, run(output, options));
});
test('自定义规则单独使用，目标缺失回落到原 MATCH', () => {
  const options = { routing: { enabled: true, rules: [['DOMAIN', 'research.example', '不存在']], tcpTargets: [['192.0.2.7', 22, '原选择']] } };
  const output = run(fixture(), options);
  assert.equal(output.rules[0], 'DOMAIN,research.example,原选择');
  assert.equal(output.rules[1], 'AND,((NETWORK,TCP),(IP-CIDR,192.0.2.7/32,no-resolve),(DST-PORT,22)),原选择');
  assert.deepEqual(output, run(output, options));
});
