const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
function source(modules) {
  const body = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
  return body + '\n' + modules.map(id => {
    const file = path.join(root, 'src/modules', id + '.js');
    return fs.readFileSync(file, 'utf8');
  }).join('\n');
}
function run(input, options = {}, modules = Object.keys(options), logs = []) {
  const context = { input: clone(input), options: clone(options), console: { log: x => logs.push(x) } };
  vm.runInNewContext('const CONFIG = options;\n' + source(modules) + '\nresult = main(input, "fixture");', context, { timeout: 3000 });
  return clone(context.result);
}
function visible(config, name) {
  const context = { config: clone(config), name, console };
  vm.runInNewContext(source([]) + '\nresult = candidateGraph(config.proxies || [], config["proxy-groups"] || [], config["proxy-providers"] || {}).members(config["proxy-groups"].find(g => g.name === name)).map(p => p.name);', context);
  return [...new Set(context.result)];
}
function fixture() {
  return {
    proxies: [{ name: '普通节点', type: 'socks5', server: '127.0.0.1', port: 19001 }],
    'proxy-groups': [{ name: '原选择', type: 'select', proxies: ['普通节点', 'DIRECT'] }],
    rules: ['IP-CIDR,192.0.2.0/24,DIRECT,no-resolve', 'MATCH,原选择'],
    dns: { enable: true, nameserver: ['system'] },
    tun: { enable: true, device: 'unchanged' },
    'mixed-port': 7897, profile: { 'store-selected': true },
  };
}
const customNodes = { enabled: true, nodes: [
  { name: '私网底层', type: 'tailscale' },
  { name: '私网出口', type: 'socks5', server: '100.64.0.2', port: 1080, 'dialer-proxy': '私网底层' },
  { name: '直接出口', type: 'tailscale', 'exit-node': 'auto:any' },
] };
const residential = { enabled: true, nodes: [{ name: '测试', server: '127.0.0.1', port: 19002, udp: true }] };
const groups = { enabled: true, definitions: [
  { name: '全部出口', candidates: 'all', default: 'DIRECT' },
  { name: '私网选择', candidates: 'tailscale', default: 'DIRECT' },
] };
module.exports = { root, clone, source, run, visible, fixture, customNodes, residential, groups };
