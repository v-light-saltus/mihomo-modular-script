# Mihomo Modular Script

[![版本](https://img.shields.io/badge/version-v1.0.0-blue)](#维护与校验)

面向 **Clash Verge Rev + Mihomo** 的可组合全局扩展脚本。通过顶部 `CONFIG` 配置节点、策略组、分流、DNS 和资源下载，使用者直接复制 [global.js](global.js) 即可。

## 开始使用

1. 打开 [global.js](global.js)，复制完整内容到 Clash Verge Rev 的「全局扩展脚本」。
2. 在顶部 `CONFIG` 填写参数，将所需模块的 `enabled` 设为 `true`。住宅代理参数位于第一项。
3. 保存后检查生成的策略组与规则。已有扩展中的重复功能可集中到此脚本管理。

所有模块默认关闭。例如，在 `CONFIG.routing` 中启用一条域名规则：

```javascript
routing: {
  enabled: true,
  rules: [
    ["DOMAIN-SUFFIX", "example.org", "DIRECT"],
  ],
  tcpTargets: [],
},
```

`rules` 的条目格式是 `[类型, 内容, 目标, ...附加参数]`；`tcpTargets` 的条目格式是 `[IPv4, TCP端口, 目标]`。目标可以是已有节点、策略组或 `DIRECT` 等内置策略。

## 功能模块

| CONFIG 区块 | 功能 |
| --- | --- |
| `residential` | 住宅 SOCKS5 节点、前置选择与前置测速 |
| `customNodes` | 原生 Mihomo 节点，包括 Tailscale、网关和 `dialer-proxy` 拨号链 |
| `groups` | 自定义手动组、已有手动组的出口注入、候选范围及排序 |
| `routing` | 域名、IP、进程规则与精确 TCP 地址端口匹配 |
| `dns` | 默认查询、节点解析、本地域名与独立解析出口 |
| `providers` | 配置内 provider 的下载出口及健康检查 |
| `inbounds` | 专用监听入口及其出口规则 |

内置 Tailscale 自动选网卡时，省略节点和全局的 `interface-name`，并在客户端启用 TUN 的 `auto-detect-interface`。Mihomo 会跟随默认出口选择 Wi-Fi 或有线，并避开自己的 TUN；脚本不修改客户端的 TUN 设置。[自动出口检测说明](https://wiki.metacubex.one/config/inbound/tun/#auto-detect-interface)

需要固定网卡时，在 `customNodes.nodes` 的对应节点对象中添加 `"interface-name": "网卡名称"`，该原生参数会直接保留。Windows 多网卡同时连接时，自动检测按默认路由与接口的综合优先级选择，不进行网速比较。

`groups.definitions` 支持两种候选范围：

```javascript
definitions: [
  { name: "全部出口", candidates: "all", default: "DIRECT" },
  { name: "组网出口", candidates: "tailscale", default: "DIRECT" },
],
```

`default` 应填写该组实际候选项的名称；其他策略组不会因为被写入 `default` 而自动加入候选。

- `all` 提供普通节点、provider 节点和可用的 Tailscale 相关出口。
- `tailscale` 提供 `DIRECT` 与可确定必经 Tailscale 的出口。配置了 `exit-node` 的 Tailscale 节点可以作为出口；其余 Tailscale 节点用于底层传输。
- 普通手动组默认按「住宅出口 → DIRECT → Tailscale 相关出口 → 原有候选」排序，可编辑 `order` 调整。
- 原订阅的可确定默认项通过 `default-selected` 保留；历史选择由 Mihomo 的 `profile.store-selected` 管理。原默认项无法静态确定时，沿用原组并输出提示。
- provider 节点沿用原 `use` 引用。受限组使用能够完整分类的 inline provider；远程 provider 的内容由 Mihomo 解析。
- 前置测速排除 Tailscale 相关链路。`noticeFilter` 可按订阅的提示条目名称设置筛选正则。

DNS、资源下载和入站可直接使用原订阅中的出口，各模块独立配置。出口缺失时，这些模块沿用原设置并输出提示；普通自定义规则则使用原 `MATCH` 目标，原目标也不可用时使用 `DIRECT`。订阅原有 `MATCH` 保持原位。

Clash Verge Rev 的订阅扩展与客户端设置仍按其执行顺序参与最终配置。`providers` 管理的是 Mihomo 配置内的资源下载，客户端的订阅更新使用客户端自己的设置。

## 使用 AI 组合脚本

脚本由 `CONFIG`、公共 `CORE` 和自注册 `MODULE` 组成，入口为 `main(config, profileName)`。

- 保留 `CONFIG` 和 `CORE`，按需选取完整的 `BEGIN MODULE` / `END MODULE` 区块。
- 删除整个模块后，对应的顶部参数被忽略，入口保持一致。
- 模块按声明、引用准备、候选调整、配置写入的固定阶段运行，代码粘贴顺序不决定执行顺序。
- 调整模块组合后，从原订阅重新生成配置。

**1. 准备源码和需求**

最简单的方式是将 [global.js](global.js) 作为附件或完整文本交给 AI，再描述需要的功能。它包含参数模板、公共核心和全部模块，无需安装 Node.js。

支持读取本地仓库的 AI 也可以直接使用 [src/config/example.js](src/config/example.js)、[src/core.js](src/core.js) 和 [src/modules/](src/modules/)。这些文件应来自同一版本；若 AI 无法访问仓库链接，直接提供文件内容即可。

需求中说明已有的节点或策略组名称、想添加的功能、匹配规则和默认出口。AI 可据此选择模块，例如：

| 需求 | 模块组合 |
| --- | --- |
| 给现有出口添加域名、进程或 IP 分流 | `routing` |
| 新增节点并加入手动策略组 | `customNodes` + `groups` |
| 住宅代理、手动组入口和自定义分流 | `residential` + `groups` + `routing` |
| 调整 DNS，解析出口使用已有策略组 | `dns` |
| 配置 provider 下载出口和健康检查 | `providers` |
| 将独立监听端口交给已有出口 | `inbounds` |

模块可以继续组合。依赖以实际引用的节点和策略组为准，例如 DNS 使用订阅已有策略组时，只需要 `dns`；需要新建目标组时，再加入 `groups`。

**2. 复制提示词**

```text
请根据我提供的 Mihomo Modular Script 同版本源码，组合一个可直接粘贴到
Clash Verge Rev「全局扩展脚本」的完整 JavaScript 文件。

我的环境与需求：
- 已有节点或策略组：[填写名称；如不需要引用，可以写“无”]
- 想添加的功能：[填写需求]
- 域名、IP、进程或监听端口：[按需填写]
- 默认出口及已有手动组是否需要注入新出口：[填写偏好]
- 其他参数：[按需填写]

组合要求：
1. 从源码中选取满足需求的模块，简要说明所选模块及用途。
2. 保留完整 CONFIG、CORE 和入口 main(config, profileName)。只修改 CONFIG，
   保持公共核心和所选模块的实现原样。
3. 按 CONFIG → CORE → MODULE 顺序拼接；每个模块仅保留一次，
   删除未选模块的完整 BEGIN MODULE / END MODULE 区块，包含其自注册代码。
4. 将所选模块的 enabled 设为 true，其余设为 false。核对引用的节点和策略组
   来自现有订阅或所选模块；利用已提供的信息，只询问缺失的必要参数。
5. 保留版本标识和许可证声明，输出完整单文件代码，不使用省略号、补丁、
   import、require 或外部运行依赖。
6. 最后列出已填写的关键参数，以及应用后需要检查的策略组和规则。

如果你有本地命令执行能力，可以用 scripts/assemble.js 组合所选模块，
再进行语法和内容检查；没有执行环境时，请说明哪些检查尚未运行。
```

例如，可以把需求部分填写为：

```text
我已有可用订阅。新增手动组“工作访问”，候选包含全部可用出口和 DIRECT，
首次默认选 DIRECT。让 example.org 及其子域名使用“工作访问”。
现有手动组不注入新出口，其他分流继续使用订阅原规则。
```

这个例子只需 `groups` 和 `routing`：前者创建手动组，后者添加 `DOMAIN-SUFFIX` 规则。

**3. 使用生成结果**

将完整代码粘贴到全局扩展脚本，核对顶部 `CONFIG` 后保存。检查生成的节点、策略组候选、默认选择和规则目标是否符合需求。应用环境与原始订阅也参与最终配置，代码语法检查不能代替实际验证。

调整需求时，将当前脚本和新的需求一起交给 AI，沿用上述方式重新组合。模块被删除后，从原订阅重新生成配置。

## 维护与校验

当前版本：**v1.0.0**。验证环境：Node.js 24、Mihomo v1.19.33。

版本采用 [语义化版本](https://semver.org/lang/zh-CN/)：兼容修复递增修订号（如 `1.0.1`），兼容功能递增次版本号（如 `1.1.0`），不兼容的配置或接口变更递增主版本号（如 `2.0.0`）。

源码与参数位于 `src/`，完整脚本保留在根目录：

```text
mihomo-modular-script/
├── .github/workflows/verify.yml
├── src/
│   ├── config/example.js
│   ├── core.js
│   └── modules/
├── scripts/assemble.js
├── tests/
├── global.js
├── README.md
├── LICENSE
├── .gitignore
└── .gitattributes
```

使用脚本本身无需构建工具。维护源码时使用 Node.js 24，以下命令均使用内置模块：

```sh
node scripts/assemble.js
node scripts/assemble.js --check
node --test tests/*.test.js

# 生成指定模块的版本
node scripts/assemble.js --modules customNodes,groups,routing --output selected.js
```

`--config` 可指定其他参数文件；默认读取 [src/config/example.js](src/config/example.js)。模块源码位于 [src/modules](src/modules)，候选分析与调度位于 [src/core.js](src/core.js)。

使用本机 Mihomo 进行额外校验：

```sh
python tests/check_mihomo.py --mihomo /path/to/mihomo --node node
```

该检查使用 `.cache` 下的示例配置与独立内核，验证配置解析、实际候选、默认项和选择持久化。GitHub Actions 运行 JavaScript 回归及单文件一致性检查。

## 上游与许可证

- [Clash Verge Rev 扩展脚本说明](https://www.clashverge.dev/guide/extend.html)
- [Mihomo 配置文档](https://wiki.metacubex.one/config/)
- DNS 默认参数为中国大陆场景示例，其中的国内域名集合来自 [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)。解析器与规则集合均可在 `CONFIG` 中替换。

本项目采用 [MIT License](LICENSE)。
