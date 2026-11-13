/**
 * Mihomo Modular Script v1.0.0 / Clash Verge Rev + Mihomo。
 * 将完整 global.js 粘贴到「全局扩展脚本」，填写 CONFIG 并启用所需模块。
 * CONFIG 集中定义参数；CORE 提供入口与调度；MODULE 为可组合的功能模块。
 * 所有模块默认关闭，按 enabled 开关和固定阶段执行。
 * 组合时保留 CONFIG、CORE，并按需选取完整的 BEGIN MODULE / END MODULE 区块。
 * 候选顺序：住宅 → DIRECT → Tailscale 相关出口 → 原候选；历史/原默认选择不变。
 * 参数与模块说明：https://github.com/v-light-saltus/mihomo-modular-script
 * Copyright (c) 2026 v-light-saltus · SPDX-License-Identifier: MIT
 */
const CONFIG = {
  residential: {
    enabled: false,
    nodes: [
      { name: "1", server: "", port: 0, username: "", password: "", udp: true },
    ],
    names: { node: "住宅节点", exit: "住宅出口", front: "前置选择", auto: "前置测速" },
    frontFilter: "", // Mihomo 正则，例如 (?i)US|United States；空字符串不限定地区。
    noticeFilter: "剩余流量|到期时间|过期时间|套餐到期|官网地址|重置时间",
    order: ["residential", "direct", "tailscale"],
    testUrl: "https://www.gstatic.com/generate_204",
    interval: 300,
  },
  customNodes: {
    enabled: false,
    nodes: [
      // 填写原生 Mihomo 节点对象；name/type/server/port 等以对应协议为准。
      // Tailscale 的 hostname、state-dir 按需填写。
      // 自动选网卡：省略节点和全局的 interface-name，并在客户端启用 TUN 的 auto-detect-interface。
      // Mihomo 跟随默认出口选择 Wi-Fi/有线，并避开自己的 TUN。
      // 固定网卡：在节点对象中添加 "interface-name": "网卡名称"。
      // 网关节点通过 "dialer-proxy": "传输节点名" 连接组网节点。
    ],
  },
  groups: {
    enabled: false,
    injectExisting: true, // 向普通手动组添加出口；拨号、节点解析和下载依赖组沿用原候选。
    order: ["residential", "direct", "tailscale"],
    definitions: [
      // { name: "自定义出口", candidates: "all", default: "DIRECT" },
      // { name: "仅组网出口", candidates: "tailscale", default: "DIRECT" },
    ],
  },
  routing: {
    enabled: false,
    rules: [
      // ["DOMAIN-SUFFIX", "example.org", "自定义出口"],
      // ["IP-CIDR", "192.0.2.10/32", "DIRECT", "no-resolve"],
      // 含反斜杠的正则可使用 String.raw 模板字符串。
    ],
    tcpTargets: [
      // ["192.0.2.20", 22, "仅组网出口"], // 只匹配这个地址和 TCP 端口。
    ],
  },
  dns: {
    // 默认参数为中国大陆场景示例，可按所在网络替换解析器与域名集合。
    enabled: false,
    outbound: "DIRECT", // 默认查询使用的节点或组；可填写任意原订阅策略组。
    upstreams: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
    directResolvers: ["https://223.5.5.5/dns-query#DIRECT", "https://223.6.6.6/dns-query#DIRECT"],
    // nodeResolvers: ["system"], // 不填写：沿用原节点解析上游，没有时使用 directResolvers。
    localDomains: [], // 域名及子域名走 localResolvers，排除 Fake-IP。
    localResolvers: ["system"],
    localRuleSetName: "扩展-本地域名",
    directLocalDomains: true,
    downloadDomains: [], // provider 跨域下载时可补充最终主机名。
    directRuleSet: {
      name: "扩展-国内域名", type: "http", behavior: "domain", format: "yaml",
      url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
      path: "./ruleset/v4-direct.yaml", interval: 86400,
    }, // 不需要国内域名集合时设为 null。
  },
  providers: {
    enabled: false,
    outbound: "DIRECT", // provider 下载连接使用的出口。
    overrideExisting: false, // true 才覆盖 provider 原本显式指定的下载出口。
    healthCheck: { enable: true, url: "https://www.gstatic.com/generate_204", interval: 300, timeout: 5000, lazy: false },
    // healthCheck: false 表示不补充检查；已有 health-check 始终保留。
  },
  inbounds: {
    enabled: false,
    listeners: [
      // { name: "专用入站", type: "socks", listen: "127.0.0.1", port: 18080, udp: true, target: "自定义出口" },
    ],
  },
};
