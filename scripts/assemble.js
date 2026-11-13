// 维护用单文件拼接器，仅依赖 Node.js 内置模块。
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const available = () => fs.readdirSync(path.join(root, 'src/modules')).filter(n => n.endsWith('.js')).map(n => n.slice(0, -3)).sort();
function assemble({ modules = available(), config = path.join(root, 'src/config/example.js') } = {}) {
  return [read(config), read(path.join(root, 'src/core.js')),
    ...[...new Set(modules)].map(id => read(path.join(root, 'src/modules', id + '.js')))].join('\n\n') + '\n';
}
module.exports = { assemble, available };
if (require.main === module) {
  const { values } = parseArgs({ options: {
    modules: { type: 'string' }, config: { type: 'string' }, output: { type: 'string' }, check: { type: 'boolean' },
  } });
  const code = assemble({ modules: values.modules?.split(',').filter(Boolean), config: values.config });
  const output = values.output || path.join(root, 'global.js');
  if (values.check) {
    if (read(output) + '\n' !== code) throw new Error('成品与源码不一致，请重新生成。');
    console.log('成品与源码一致。');
  } else {
    fs.writeFileSync(output, code, 'utf8');
    console.log('已生成：' + output);
  }
}
