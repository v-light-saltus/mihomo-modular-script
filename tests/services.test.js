const test = require('node:test');
const assert = require('node:assert/strict');
const { run, fixture, groups, customNodes, residential } = require('./helpers');
const dns = { enabled: true, outbound: '原选择', upstreams: ['https://resolver.example/dns-query'], directResolvers: ['system'], localDomains: ['campus.example'], localResolvers: ['system'] };

test('DNS 单独指向原策略组，与住宅模块无依赖', () => {
  const output = run(fixture(), { dns });
  assert.deepEqual(output.dns.nameserver, ['https://resolver.example/dns-query#原选择']);
  assert.deepEqual(output.dns['nameserver-policy']['+.campus.example'], ['system']);
  assert.deepEqual(output.proxies, fixture().proxies);
  assert.deepEqual(output, run(output, { dns }));
});
test('缺失 DNS 出口保留完整原设置，不降级直连', () => {
  const logs = [];
  const output = run(fixture(), { dns: { ...dns, outbound: '被删除的出口' } }, ['dns'], logs);
  assert.deepEqual(output, fixture());
  assert(logs.some(m => m.includes('被删除的出口')));
});
test('provider 下载与健康检查可单用，保留已有检查和可选的已有出口', () => {
  const input = fixture();
  input['proxy-providers'] = { one: { type: 'http', url: 'https://pool.example/sub' }, two: { type: 'http', url: 'https://pool.example/other', proxy: '原选择', 'health-check': { enable: false } } };
  const output = run(input, { providers: { enabled: true, outbound: 'DIRECT', overrideExisting: false } });
  assert.equal(output['proxy-providers'].one.proxy, 'DIRECT');
  assert(output['proxy-providers'].one['health-check'].enable);
  assert.equal(output['proxy-providers'].two.proxy, '原选择');
  assert.deepEqual(output['proxy-providers'].two['health-check'], { enable: false });
  assert.deepEqual(output.dns, input.dns);
});
test('DNS 与下载组合优先解析资源域名，保留原节点解析策略', () => {
  const input = fixture();
  input['proxy-providers'] = { one: { type: 'http', url: 'https://pool.example/sub' } };
  input.dns['nameserver-policy'] = { 'node.example': ['system'] };
  const output = run(input, { dns, providers: { enabled: true, outbound: 'DIRECT' } });
  assert.deepEqual(output.dns['nameserver-policy']['pool.example'], ['system']);
  assert.deepEqual(output.dns['proxy-server-nameserver-policy']['node.example'], ['system']);
  assert.deepEqual(output, run(output, { dns, providers: { enabled: true, outbound: 'DIRECT' } }));
});
test('专用入站不依赖住宅模块，规则优先且缺失目标不影响其他条目', () => {
  const input = fixture();
  input.listeners = [{ name: '保留', type: 'socks', listen: '127.0.0.1', port: 19050 }];
  const options = { inbounds: { enabled: true, listeners: [
    { name: '独立入站', type: 'socks', listen: '127.0.0.1', port: 19051, udp: true, target: '原选择' },
    { name: '保留', type: 'socks', port: 19052, target: '缺失' },
  ] }, routing: { enabled: true, rules: [['DOMAIN', 'a.example', 'DIRECT']] } };
  const output = run(input, options);
  assert.equal(output.rules[0], 'IN-PORT,19051,原选择');
  assert.equal(output.listeners.length, 2);
  assert.deepEqual(output.listeners.find(l => l.name === '保留'), input.listeners[0]);
  assert.equal(output.listeners[0].target, undefined);
  assert.deepEqual(output, run(output, options));
});
test('节点 DNS 和下载依赖组不被加入反向依赖的住宅出口', () => {
  const input = fixture();
  input.dns['proxy-server-nameserver'] = ['https://node.example/dns-query#原选择'];
  const output = run(input, { customNodes, residential, groups, dns });
  assert.deepEqual(output['proxy-groups'].find(g => g.name === '原选择').proxies, ['普通节点', 'DIRECT']);
});
test('Fake-IP 三种模式均保留本地域名真实解析', () => {
  for (const mode of ['blacklist', 'whitelist', 'rule']) {
    const input = fixture();
    input.dns['fake-ip-filter-mode'] = mode;
    input.dns['fake-ip-filter'] = mode === 'rule' ? ['DOMAIN,old.example,real-ip'] : ['+.old.example'];
    const output = run(input, { dns });
    const rules = output.dns['fake-ip-filter'];
    assert(rules.includes(mode === 'blacklist' ? '+.campus.example' : 'DOMAIN-SUFFIX,campus.example,real-ip'));
    if (mode === 'whitelist') assert.equal(output.dns['fake-ip-filter-mode'], 'rule');
    assert.deepEqual(output, run(output, { dns }));
  }
});
