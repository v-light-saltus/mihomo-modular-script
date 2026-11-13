const test = require('node:test');
const assert = require('node:assert/strict');
const { run, visible, fixture, customNodes, residential, groups, clone } = require('./helpers');
const find = (c, n) => c['proxy-groups'].find(g => g.name === n);

test('显式默认、过滤后的默认及 include-all 的原默认均保留', () => {
  const input = fixture();
  input.proxies.push({ name: 'A', type: 'socks5', server: '127.0.0.1', port: 19003 });
  input['proxy-groups'].push(
    { name: '显式', type: 'select', proxies: ['普通节点', 'A'], 'default-selected': 'A' },
    { name: '过滤', type: 'select', proxies: ['普通节点', 'A'], 'exclude-filter': '^普通节点$' },
    { name: '动态', type: 'select', 'include-all': true },
  );
  const output = run(input, { customNodes, residential, groups });
  for (const name of ['显式', '过滤', '动态']) assert.equal(find(output, name)['default-selected'], 'A');
});
test('未知远程 provider 默认不猜测，已明确默认时可注入', () => {
  const input = fixture();
  input['proxy-providers'] = { remote: { type: 'http', url: 'https://example.invalid/pool' } };
  input['proxy-groups'].push({ name: '未知组', type: 'select', use: ['remote'] });
  const output = run(input, { customNodes, residential, groups });
  assert(!find(output, '未知组').proxies?.length);
  assert.equal(find(output, '未知组')['default-selected'], undefined);
  find(input, '未知组')['default-selected'] = '远程已知默认';
  assert.equal(find(run(input, { groups }), '未知组')['default-selected'], '远程已知默认');
});
test('inline provider 改名与拨号覆写被识别，保留 provider 节点身份', () => {
  const input = fixture();
  input['proxy-providers'] = { pool: { type: 'inline', override: { 'additional-prefix': '池-', 'dialer-proxy': '私网底层' }, payload: [
    { name: '网关', type: 'socks5', server: '100.64.0.3', port: 1080 },
    { name: '出口', type: 'tailscale', 'exit-node': 'auto:any' },
  ] } };
  const output = run(input, { customNodes, groups });
  assert(visible(output, '私网选择').includes('池-网关'));
  assert(visible(output, '私网选择').includes('池-出口'));
  assert(!output.proxies.some(p => p.name.startsWith('池-')));
  assert.deepEqual(output['proxy-providers'], input['proxy-providers']);
});
test('受限组排除混合拨号链、未知远程池及表达式覆写', () => {
  const input = fixture();
  input.proxies.push({ name: '混合末端', type: 'socks5', server: '127.0.0.1', port: 19005, 'dialer-proxy': '混合前置' });
  input['proxy-groups'].push({ name: '混合前置', type: 'select', proxies: ['普通节点', '私网出口'] });
  input['proxy-providers'] = {
    remote: { type: 'http', url: 'https://example.invalid/pool', payload: [{ name: '未知', type: 'tailscale', 'exit-node': 'auto:any' }] },
    expression: { type: 'inline', override: { 'override-expr': ['true'] }, payload: [{ name: '表达式', type: 'tailscale', 'exit-node': 'auto:any' }] },
  };
  const output = run(input, { customNodes, residential, groups });
  for (const name of ['混合末端', '未知', '表达式', '住宅节点-测试']) assert(!visible(output, '私网选择').includes(name));
});
test('拨号内部组保留底层节点，普通组中隐藏', () => {
  const input = fixture();
  input.proxies.push({ name: '链末端', type: 'socks5', server: '100.64.0.4', port: 1080, 'dialer-proxy': '内部组' });
  input['proxy-groups'].push({ name: '内部组', type: 'select', proxies: ['私网底层'] });
  const output = run(input, { customNodes, residential, groups });
  assert.deepEqual(find(output, '内部组').proxies, ['私网底层']);
  assert(!visible(output, '全部出口').includes('私网底层'));
  assert(!visible(output, '全部出口').includes('住宅节点-测试'));
});
test('无有效 exit-node 的节点不可用作普通出口，有效出口同步加入', () => {
  for (const exit of [undefined, '', ' ', null, 'auto:any']) {
    const nodes = clone(customNodes);
    nodes.nodes[0]['exit-node'] = exit;
    const output = run(fixture(), { customNodes: nodes, groups });
    assert.equal(visible(output, '全部出口').includes('私网底层'), exit === 'auto:any');
  }
});
test('多个 provider 分段过滤的有效首项保留', () => {
  const input = fixture();
  input['proxy-providers'] = { pool: { type: 'inline', payload: [{ name: 'A', type: 'socks5', server: '127.0.0.1', port: 19006 }] } };
  input['proxy-groups'].push({ name: '池组', type: 'select', use: ['pool'], proxies: ['普通节点'], filter: '^A$`^普通节点$' });
  assert.equal(find(run(input, { customNodes, groups }), '池组')['default-selected'], 'A');
});
test('自定义组可以使用 inline 和已知远程默认，不把池节点复制为静态节点', () => {
  const input = fixture();
  input['proxy-providers'] = { pool: { type: 'inline', payload: [{ name: '池首选', type: 'socks5', server: '127.0.0.1', port: 19007 }] } };
  const options = { groups: { enabled: true, definitions: [{ name: '池选择', candidates: 'all', default: '池首选' }] } };
  const output = run(input, options);
  assert.equal(find(output, '池选择')['default-selected'], '池首选');
  assert(!output.proxies.some(p => p.name === '池首选'));
});
test('原规则中的同文项保持原位置且重复执行不累加', () => {
  const input = fixture();
  input.rules.unshift('DOMAIN,example.invalid,DIRECT');
  const options = { routing: { enabled: true, rules: [['DOMAIN', 'example.invalid', 'DIRECT']] } };
  const output = run(input, options);
  assert.deepEqual(output.rules.slice(1), input.rules);
  assert.deepEqual(output, run(output, options));
});
test('全部模块组合与移除目标模块', () => {
  const options = { customNodes, residential, groups,
    dns: { enabled: true, outbound: '住宅出口' },
    providers: { enabled: true, outbound: 'DIRECT' },
    inbounds: { enabled: true, listeners: [{ name: '示例入站', type: 'socks', listen: '127.0.0.1', port: 19055, target: '住宅出口' }] },
    routing: { enabled: true, rules: [['DOMAIN', 'example.invalid', '全部出口']] },
  };
  const output = run(fixture(), options);
  assert.deepEqual(output, run(output, options));
  const removed = run(fixture(), options, Object.keys(options).filter(n => n !== 'residential'));
  assert.deepEqual(removed.dns, fixture().dns);
  assert.equal(removed.listeners, undefined);
});

test('远程 provider 的备用内容不能触发向原普通组注入整个池', () => {
  const input = fixture();
  input['proxy-providers'] = { remote: { type: 'http', url: 'https://example.invalid/pool', payload: [
    { name: '备用出口', type: 'tailscale', 'exit-node': 'auto:any' },
  ] } };
  const output = run(input, { groups });
  assert(!find(output, '原选择').use?.includes('remote'));
  assert.deepEqual(output['proxy-providers'], input['proxy-providers']);
});

test('Mihomo 专属改名正则交给内核处理，不打断独立分流模块', () => {
  const input = fixture();
  input['proxy-providers'] = { pool: { type: 'inline', payload: [
    { name: 'US-A', type: 'socks5', server: '127.0.0.1', port: 19006 },
  ], override: { 'proxy-name': [{ pattern: '(?>US)', target: 'America' }] } } };
  const options = { routing: { enabled: true, rules: [['DOMAIN', 'example.org', 'DIRECT']] } };
  const output = run(input, options);
  assert.equal(output.rules[0], 'DOMAIN,example.org,DIRECT');
  assert.deepEqual(output['proxy-providers'], input['proxy-providers']);
  input['proxy-groups'].push({ name: '原池组', type: 'select', use: ['pool'] });
  const logs = [];
  const grouped = run(input, { groups }, ['groups'], logs);
  assert.deepEqual(find(grouped, '原池组'), find(input, '原池组'));
  assert(!find(grouped, '私网选择').use.includes('pool'));
  assert(logs.some(line => line.includes('原有效默认项')));
});

test('表达式修改后的 provider 内容未知，不能推断原默认或扩展出口', () => {
  const input = fixture();
  input['proxy-providers'] = { pool: { type: 'inline', payload: [
    { name: '原名', type: 'tailscale', 'exit-node': 'auto:any' },
  ], override: { 'override-expr': ['name = "新名"'] } } };
  input['proxy-groups'].push({ name: '表达式原组', type: 'select', use: ['pool'] });
  const output = run(input, { groups });
  assert.deepEqual(find(output, '表达式原组'), find(input, '表达式原组'));
  assert(!find(output, '原选择').use?.includes('pool'));
});

test('新建拨号前置组先完成初始化，再保护依赖且不收录自己的末端', () => {
  for (const candidates of ['tailscale', 'all']) {
    const nodes = clone(customNodes);
    nodes.nodes.push({ name: '经组末端', type: 'socks5', server: '127.0.0.1', port: 19008, 'dialer-proxy': '自建前置' });
    const options = { customNodes: nodes, groups: { enabled: true, definitions: [
      { name: '自建前置', candidates, default: '直接出口' },
    ] } };
    const output = run(fixture(), options);
    assert(visible(output, '自建前置').includes('直接出口'));
    assert(!visible(output, '自建前置').includes('经组末端'));
    assert.equal(find(output, '自建前置')['default-selected'], '直接出口');
    assert.deepEqual(output, run(output, options));
  }
});

test('已有动态前置组排除新增的依赖末端并保留原默认', () => {
  const input = fixture();
  input['proxy-groups'].push({ name: '动态前置', type: 'select', 'include-all': true });
  const nodes = clone(customNodes);
  nodes.nodes.push({ name: '新增末端', type: 'socks5', server: '127.0.0.1', port: 19008, 'dialer-proxy': '动态前置' });
  const output = run(input, { customNodes: nodes });
  assert(!visible(output, '动态前置').includes('新增末端'));
  assert.equal(find(output, '动态前置')['default-selected'], '普通节点');
  assert.deepEqual(output, run(output, { customNodes: nodes }));
});
