// ===== BEGIN MODULE dns =====
// 参数：CONFIG.dns；outbound 接受已有节点或策略组名。
// 阶段：prepare / finalize；修改 dns、自己的 rule-providers，可添加本地域名直连规则。
// upstreams 为默认查询上游；nodeResolvers 为节点解析上游；localResolvers 为本地域名上游。
(function () {
  function expand(policy) {
    const out = {};
    for (const [key, value] of Object.entries(policy || {})) {
      for (const item of /^(geosite|rule-set):/.test(key) ? [key] : key.split(",")) out[item.trim()] = value;
    }
    return out;
  }
  function hostname(url) {
    const match = String(url || "").match(/^https?:\/\/(?:[^/@]+@)?([^/:?#]+)/i);
    return match && !/^[\d.]+$/.test(match[1]) && !match[1].startsWith("[") ? match[1].toLowerCase() : null;
  }
  function realIp(ctx, dns, domains) {
    const filters = ctx.list(dns["fake-ip-filter"]);
    const rules = domains.map(d => `DOMAIN-SUFFIX,${d},real-ip`);
    const mode = dns["fake-ip-filter-mode"] || "blacklist";
    if (mode === "rule") dns["fake-ip-filter"] = ctx.unique([...rules, ...filters]);
    else if (mode === "whitelist") {
      const converted = filters.flatMap(value => {
        if (/^(geosite|rule-set):/.test(value)) {
          const i = value.indexOf(":"), type = value.slice(0, i) === "geosite" ? "GEOSITE" : "RULE-SET";
          return value.slice(i + 1).split(",").map(v => `${type},${v},fake-ip`);
        }
        if (value.startsWith("+.")) return [`DOMAIN-SUFFIX,${value.slice(2)},fake-ip`];
        if (value.startsWith(".")) return [`DOMAIN-REGEX,^.+${ctx.literal(value)}$,fake-ip`];
        if (value.includes("*")) {
          const pattern = value.split(".").map(part => part === "*" ? "[^.]+" : ctx.literal(part)).join("\\.");
          return [`DOMAIN-REGEX,^${pattern}$,fake-ip`];
        }
        return [`DOMAIN,${value},fake-ip`];
      });
      dns["fake-ip-filter-mode"] = "rule";
      dns["fake-ip-filter"] = [...rules, ...converted, "MATCH,real-ip"];
    } else dns["fake-ip-filter"] = ctx.unique([...filters, ...domains.map(d => "+." + d)]);
  }
  registerModule({
    id: "dns", order: 50,
    prepare(ctx, options) {
      const outbound = options.outbound || "DIRECT";
      if (!ctx.requireTarget(outbound, "DNS ")) return;
      const old = ctx.config.dns || {};
      const direct = options.directResolvers || ["https://223.5.5.5/dns-query#DIRECT", "https://223.6.6.6/dns-query#DIRECT"];
      const local = options.localResolvers || ["system"];
      const domains = ctx.unique(["lan", "local", "localhost", "localdomain", "home.arpa", ...(options.localDomains || [])]
        .map(d => d.trim().replace(/^\+\./, "").toLowerCase()).filter(Boolean));
      const localName = options.localRuleSetName || "扩展-本地域名";
      const nodePolicy = expand(old["proxy-server-nameserver-policy"]);
      if (!old["x-v4-managed"]) {
        nodePolicy["rule-set:" + localName] = local;
        for (const [key, value] of Object.entries(expand(old["nameserver-policy"]))) {
          if (!Object.prototype.hasOwnProperty.call(nodePolicy, key)) nodePolicy[key] = value;
        }
      }
      const nodeDns = options.nodeResolvers || (ctx.list(old["proxy-server-nameserver"]).length ? old["proxy-server-nameserver"] : direct);
      for (const resolver of [...ctx.list(nodeDns), ...Object.values(nodePolicy).flatMap(ctx.list)]) ctx.protectResolver(resolver);
      ctx.state.dns = { outbound, old: ctx.clone(old), direct, local, domains, localName, nodePolicy, nodeDns };
    },
    finalize(ctx, options) {
      const state = ctx.state.dns;
      if (!state) return;
      const { outbound, old, direct, local, domains, localName, nodePolicy, nodeDns } = state;
      const ruleProviders = { ...(ctx.config["rule-providers"] || {}) };
      ruleProviders[localName] = { type: "inline", behavior: "domain", payload: domains.map(d => "+." + d) };
      const directSet = options.directRuleSet;
      if (directSet) {
        const { name, ...definition } = directSet;
        const previous = ruleProviders[name];
        ruleProviders[name] = { behavior: "domain", format: "yaml", interval: 86400,
          ...ctx.clone(definition), type: definition.type || (definition.url ? "http" : "inline") };
        if (ruleProviders[name].type === "http") {
          const download = ctx.state.providers;
          ruleProviders[name].proxy = download && (download.overrideExisting || !previous?.proxy)
            ? download.outbound : previous?.proxy || definition.proxy || "DIRECT";
        }
      }
      const priority = {};
      for (const domain of domains) priority["+." + domain] = local;
      const downloadHosts = [
        ...(options.downloadDomains || []),
        ...Object.values(ctx.config["proxy-providers"] || {}).map(p => hostname(p.url)),
        ...Object.values(ruleProviders).map(p => hostname(p.url)),
      ].filter(Boolean);
      for (const host of ctx.unique(downloadHosts)) priority[host] = domains.some(d => host === d || host.endsWith("." + d)) ? local : direct;
      if (directSet) priority["rule-set:" + directSet.name] = direct;
      const policy = { ...priority, ...(old["nameserver-policy"] || {}), ...priority };
      const upstreams = options.upstreams || ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"];
      ctx.config.dns = {
        ...old, enable: true, "x-v4-managed": true,
        "enhanced-mode": old["enhanced-mode"] || "fake-ip", "respect-rules": true, "prefer-h3": false,
        "default-nameserver": direct, "proxy-server-nameserver": nodeDns, "proxy-server-nameserver-policy": nodePolicy,
        nameserver: upstreams.map(url => url.includes("#") || /^(system|dhcp)(:|$)/.test(url) ? url : url + "#" + outbound),
        fallback: [], "direct-nameserver": [], "direct-nameserver-follow-policy": true, "nameserver-policy": policy,
      };
      ctx.config["rule-providers"] = ruleProviders;
      realIp(ctx, ctx.config.dns, domains);
      if (options.directLocalDomains !== false) ctx.addRules((options.localDomains || []).map(d => `DOMAIN-SUFFIX,${d.replace(/^\+\./, "")},DIRECT`), 30);
    },
  });
})();
// ===== END MODULE dns =====
