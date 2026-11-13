// 生成 Mihomo 配置校验用例。
const { run, fixture, customNodes, residential, groups, clone } = require('./helpers');
const options = {
  customNodes, residential, groups,
  dns: { enabled: true, outbound: '原选择', directRuleSet: { name: '测试域名集合', type: 'inline', payload: ['+.cn.example'] } },
  providers: { enabled: true, outbound: 'DIRECT' },
  inbounds: { enabled: true, listeners: [{ name: '示例入站', type: 'socks', listen: '127.0.0.1', port: 19055, target: '原选择' }] },
  routing: { enabled: true, rules: [['DOMAIN', 'research.example', 'DIRECT']], tcpTargets: [['192.0.2.7', 22, '原选择']] },
};
const base = fixture();
base.tun = { enable: false };
base['mixed-port'] = 0;
base['proxy-providers'] = { pool: { type: 'inline', 'health-check': { enable: false }, payload: [
  { name: '池内普通', type: 'socks5', server: '127.0.0.1', port: 19009 },
] } };
const cases = { empty: run(base, {}) };
for (const id of Object.keys(options)) cases[id] = run(base, { [id]: options[id] });
cases.all = run(base, options);
cases.emptySubscription = run({}, options);
const regexpInput = clone(base);
regexpInput['proxy-providers'].pool.override = { 'proxy-name': [{ pattern: '(?>池内)', target: '正则改名' }] };
regexpInput['proxy-groups'].push({ name: '正则组', type: 'select', use: ['pool'] });
cases.nativeRegexp = regexpInput;
cases.regexp = run(regexpInput, { routing: options.routing, groups });
const chainedNodes = clone(customNodes);
chainedNodes.nodes.push({ name: '经组末端', type: 'socks5', server: '127.0.0.1', port: 19008, 'dialer-proxy': '自建前置' });
cases.customGroupFront = run(base, { customNodes: chainedNodes, groups: { enabled: true, definitions: [
  { name: '自建前置', candidates: 'tailscale', default: '直接出口' },
] } });
const dynamicInput = clone(base);
dynamicInput['proxy-groups'].push({ name: '自建前置', type: 'select', 'include-all': true });
cases.dynamicFront = run(dynamicInput, { customNodes: chainedNodes });
process.stdout.write(JSON.stringify(cases));
