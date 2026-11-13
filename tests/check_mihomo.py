"""隔离校验：python tests/check_mihomo.py --mihomo <可执行文件> --node <node路径>。"""
import argparse
import copy
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--mihomo', required=True)
parser.add_argument('--node', default='node')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
cache = root / '.cache'
cache.mkdir(exist_ok=True)
folder = Path(tempfile.mkdtemp(prefix='mihomo-', dir=cache))
flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
cases = json.loads(subprocess.check_output([args.node, str(root / 'tests/generate-cases.js')], creationflags=flags))
for name, config in cases.items():
    case_dir = folder / name
    case_dir.mkdir()
    for index, node in enumerate(config.get('proxies', [])):
        if node.get('type') == 'tailscale':
            node['state-dir'] = str(case_dir / f'ts-{index}')
    file = case_dir / 'config.json'
    file.write_text(json.dumps(config, ensure_ascii=False), encoding='utf-8')
    result = subprocess.run([args.mihomo, '-t', '-d', str(case_dir), '-f', str(file)],
                            capture_output=True, text=True, encoding='utf-8', errors='replace',
                            creationflags=flags, timeout=25)
    assert result.returncode == 0, name + ': ' + (result.stdout + result.stderr)[-4000:]
    print(json.dumps({'case': name, 'parse': 'PASS'}), flush=True)

# 使用本地 SOCKS5 桩配置核对候选、默认项和选择持久化。
live = copy.deepcopy(cases['all'])
def fake(node):
    return {'name': node['name'], 'type': 'socks5', 'server': '127.0.0.1', 'port': 19009}
live['proxies'] = [fake(node) for node in live['proxies']]
for provider in live.get('proxy-providers', {}).values():
    provider['payload'] = [fake(node) for node in provider['payload']]
    provider['health-check'] = {'enable': False}
for group in live['proxy-groups']:
    if group['type'] == 'url-test':
        group['type'] = 'select'
    for key in ['url', 'interval', 'lazy']:
        group.pop(key, None)
live['listeners'] = []
live['dns'] = {'enable': False}
live['tun'] = {'enable': False}
live['profile'] = {'store-selected': True}
with socket.socket() as reservation:
    reservation.bind(('127.0.0.1', 0))
    port = reservation.getsockname()[1]
secret = secrets.token_hex(16)
live['external-controller'] = f'127.0.0.1:{port}'
live['secret'] = secret
file = folder / 'live.json'
file.write_text(json.dumps(live, ensure_ascii=False), encoding='utf-8')
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def request(path, body=None):
    req = urllib.request.Request(f'http://127.0.0.1:{port}' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json'},
        method='GET' if body is None else 'PUT')
    with opener.open(req, timeout=1) as response:
        raw = response.read()
        return json.loads(raw) if raw else None
def start():
    process = subprocess.Popen([args.mihomo, '-d', str(folder), '-f', str(file)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
    try:
        for _ in range(80):
            if process.poll() is not None:
                raise RuntimeError('隔离内核提前退出')
            try:
                request('/version')
                return process
            except OSError:
                time.sleep(0.1)
        raise RuntimeError('隔离内核未启动')
    except BaseException:
        stop(process)
        raise
def stop(process):
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)

process = start()
try:
    proxies = request('/proxies')['proxies']
    assert proxies['原选择']['now'] == '普通节点'
    assert proxies['原选择']['all'][:4] == ['住宅出口', 'DIRECT', '私网出口', '直接出口']
    assert proxies['私网选择']['now'] == 'DIRECT'
    assert proxies['私网选择']['all'] == ['DIRECT', '私网出口', '直接出口']
    assert '私网底层' not in proxies['全部出口']['all']
    rules = request('/rules')['rules']
    assert rules[0]['type'] == 'InPort'
    assert any(r['type'] == 'AND' and '192.0.2.7/32' in r['payload'] for r in rules)
    request('/proxies/' + urllib.parse.quote('原选择'), {'name': 'DIRECT'})
    time.sleep(0.6)
finally:
    stop(process)
process = start()
try:
    assert request('/proxies')['proxies']['原选择']['now'] == 'DIRECT'
finally:
    stop(process)
print(json.dumps({'runtimeCandidates': 'PASS', 'defaultSelection': 'PASS', 'savedSelection': 'PASS', 'tcpRules': 'PASS'}), flush=True)
