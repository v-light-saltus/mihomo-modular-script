// ===== BEGIN CORE =====
// 文件结构：CONFIG → CORE → MODULE；功能模块自注册。
// 模块接口：id / order；declare 声明节点与组，prepare 声明外部引用，
// transform 调整候选，finalize 写入配置。模块通过 ctx 交换配置与分析结果。
const V4_MODULES = [];
function registerModule(module) { V4_MODULES.push(module); }

function main(config, profileName) {
  const modules = V4_MODULES.filter(m => CONFIG[m.id]?.enabled)
    .slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  if (!modules.length) return config;
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  const unique = values => [...new Set(values)];
  const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = values => "^(?:" + unique(values).map(literal).join("|") + ")$";
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaults = new Map();
  const initialNodes = new Set((config.proxies || []).map(p => p.name));
  const candidateWork = modules.some(m => m.candidates);
  if (candidateWork) {
    const initial = candidateGraph(config.proxies || [], config["proxy-groups"] || [], config["proxy-providers"] || {});
    for (const group of config["proxy-groups"] || []) {
      if (group.type !== "select") continue;
      const copy = { ...group };
      defaults.set(group.name, initial.freezeDefault(copy) ? copy["default-selected"] : null);
    }
  }
  const warned = new Set();
  const ctx = {
    config, profileName, list, unique, literal, exact, clone, defaults,
    state: {}, protectTargets: new Set(), generatedRules: [],
    transportOnly: node => node.type === "tailscale" &&
      !(typeof node["exit-node"] === "string" && node["exit-node"].trim()),
    warn(message) {
      if (!warned.has(message)) { console.log("[Mihomo Modular Script] " + message); warned.add(message); }
    },
    addNodes(nodes) {
      const old = new Map((config.proxies || []).map(p => [p.name, p]));
      const names = new Set(nodes.map(p => p.name));
      config.proxies = (config.proxies || []).filter(p => !names.has(p.name))
        .concat(nodes.map(p => ({ ...old.get(p.name), ...clone(p) })));
    },
    addGroups(groups) {
      const old = new Map((config["proxy-groups"] || []).map(g => [g.name, g]));
      const names = new Set(groups.map(g => g.name));
      config["proxy-groups"] = groups.map(g => ({ ...old.get(g.name), ...clone(g) }))
        .concat((config["proxy-groups"] || []).filter(g => !names.has(g.name)));
    },
    addRules(rules, priority = 20) { this.generatedRules.push({ priority, rules }); },
    refresh() {
      this.graph = candidateGraph(config.proxies || [], config["proxy-groups"] || [], config["proxy-providers"] || {});
      const dns = config.dns || {};
      for (const resolver of [...list(dns["proxy-server-nameserver"]),
        ...Object.values(dns["proxy-server-nameserver-policy"] || {}).flatMap(list)]) this.protectResolver(resolver);
      for (const provider of [...Object.values(config["proxy-providers"] || {}), ...Object.values(config["rule-providers"] || {})]) {
        if (provider.proxy) this.graph.protect(provider.proxy);
      }
      this.protectTargets.forEach(name => this.graph.protect(name));
    },
    protectResolver(resolver) {
      for (const name of String(resolver).split("#").slice(1).join("&").split("&")) {
        if (this.hasTarget(name)) { this.protectTargets.add(name); this.graph.protect(name); }
      }
    },
    hasTarget(name) {
      return ["DIRECT", "REJECT", "REJECT-DROP", "COMPATIBLE", "PASS", "PASS-RULE"].includes(name) ||
        (config.proxies || []).some(p => p.name === name) || (config["proxy-groups"] || []).some(g => g.name === name);
    },
    requireTarget(name, feature) {
      if (this.hasTarget(name)) return true;
      this.warn(feature + "的出口 " + name + " 不存在，保留原设置。");
      return false;
    },
    ruleTarget(name) {
      if (this.hasTarget(name)) return name;
      const match = (config.rules || []).find(r => r.startsWith("MATCH,"));
      const target = match && match.split(",")[1];
      const fallback = this.hasTarget(target) ? target : "DIRECT";
      this.warn("规则目标 " + name + " 不存在，使用 " + fallback + "。");
      return fallback;
    },
    preserveDefault(group) {
      if (defaults.has(group.name)) {
        const value = defaults.get(group.name);
        if (value === null) return false;
        group["default-selected"] = value;
        return true;
      }
      return this.graph.freezeDefault(group);
    },
    hide(group, names) {
      if (!names.length) return;
      if (Array.isArray(group.proxies)) group.proxies = group.proxies.filter(n => !names.includes(n));
      const filters = list(group["exclude-filter"]?.split("`")).filter(Boolean);
      group["exclude-filter"] = unique([...filters, exact(names)]).join("`");
      if (!list(group.proxies).length && !list(group.use).length &&
          !group["include-all"] && !group["include-all-proxies"] && !group["include-all-providers"]) group.proxies = ["REJECT"];
    },
    residentialExits() { return (config["proxy-groups"] || []).filter(g => Array.isArray(g["x-residential-members"])); },
    sort(group, order = ["residential", "direct", "tailscale"]) {
      const buckets = {
        residential: this.residentialExits().map(g => g.name).filter(n => list(group.proxies).includes(n)),
        direct: list(group.proxies).includes("DIRECT") ? ["DIRECT"] : [],
        tailscale: this.graph.relatedMembers(group),
      };
      this.graph.prioritize(group, order.map(key => buckets[key] || []));
    },
  };
  ctx.refresh();
  for (const phase of ["declare", "prepare", "transform", "finalize"]) {
    for (const module of modules) {
      if (module[phase]) { module[phase](ctx, CONFIG[module.id]); ctx.refresh(); }
    }
    if (phase === "declare" && candidateWork) {
      const introduced = (config.proxies || []).filter(p => !initialNodes.has(p.name)).map(p => p.name);
      for (const group of config["proxy-groups"] || []) {
        if (ctx.graph.protectedNames.has(group.name)) {
          ctx.hide(group, introduced.filter(name => ctx.graph.dependsOn(name, group.name)));
        }
        if (group.type !== "select" || !defaults.has(group.name)) continue;
        if (!ctx.preserveDefault(group) && (group["include-all"] || group["include-all-proxies"])) ctx.hide(group, introduced);
      }
    }
  }
  const previous = config["x-script-v4"]?.rules || [];
  const generated = unique(ctx.generatedRules.sort((a, b) => a.priority - b.priority).flatMap(item => item.rules));
  if (previous.length || generated.length) {
    const original = (config.rules || []).slice();
    for (const rule of previous) {
      const index = original.indexOf(rule);
      if (index >= 0) original.splice(index, 1);
    }
    config.rules = [...generated, ...original];
    config["x-script-v4"] = { rules: generated };
  }
  return config;
}

function candidateGraph(proxies, groups, providers) {
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  function regex(pattern, flags = "") {
    // 兼容常见的 (?i) / (?m) / (?s)，原配置仍交给 Mihomo 解析。
    const source = pattern.replace(/\(\?([ims]+)\)/g, (_, modes) => {
      flags += modes;
      return "";
    });
    return new RegExp(source, [...new Set(flags)].join(""));
  }
  function matches(patterns, name, absent, unsupported = absent) {
    if (!patterns) return absent;
    return patterns.split("`").some(pattern => {
      try { return regex(pattern).test(name); }
      // JS 不支持的筛选按可能匹配处理，用于识别需从测速排除的链路。
      catch (_) { return unsupported; }
    });
  }
  function allowed(node, scope, dynamic = true, groupScope = true) {
    // provider 在解析前按 ss/ssr 筛选；策略组按内核的 Shadowsocks/Selector 等名称筛选。
    const rawType = node.type.toLowerCase();
    const runtimeType = { ss: "shadowsocks", ssr: "shadowsocksr", select: "selector" }[rawType] || rawType.replace(/-/g, "");
    return (!dynamic || matches(scope.filter, node.name, true)) &&
      !matches(scope["exclude-filter"], node.name, false) &&
      !(scope["exclude-type"] || "").toLowerCase().split("|").includes(groupScope ? runtimeType : rawType);
  }
  const providerDialer = provider => (provider.override || {})["dialer-proxy"] ??
    (provider["dialer-proxy"] || undefined);
  function rename(name, rule) {
    // regexp2 使用 .NET 替换语法；支持 $1、${1}、${name} 及其常用特殊引用。
    return name.replace(regex(rule.pattern, "g"), (...args) => {
      const named = typeof args[args.length - 1] === "object" ? args.pop() : {};
      const input = args.pop(), offset = args.pop(), captures = args;
      return rule.target.replace(/\$(\$|&|`|'|\+|_|\d+|\{\w+\})/g, (token, key) => {
        if (key === "$") return "$";
        if (key === "&") return captures[0];
        if (key === "`") return input.slice(0, offset);
        if (key === "'") return input.slice(offset + captures[0].length);
        if (key === "_") return input;
        if (key === "+") return captures.slice(1).filter(value => value !== undefined).pop() || "";
        key = key.replace(/^\{|\}$/g, "");
        if (/^\d+$/.test(key)) return Number(key) < captures.length ? captures[Number(key)] || "" : token;
        return Object.prototype.hasOwnProperty.call(named, key) ? named[key] || "" : token;
      });
    });
  }
  function ordered(items, filter, appendRest = false) {
    const selected = filter ? filter.split("`").flatMap(pattern => items.filter(node => matches(pattern, node.name, true))) : items;
    return [...new Map([...selected, ...(appendRest ? items : [])].map(node => [node.name, node])).values()];
  }
  const unknownProviders = new Set();
  const providerNodes = Object.fromEntries(Object.entries(providers).map(([name, provider]) => {
    const override = provider.override || {};
    // 完整候选取自可静态解析的 inline provider；其余 provider 由内核解析。
    let known = provider.type === "inline" && !override["override-expr"]?.length;
    if (known) {
      try {
        for (const field of ["filter", "exclude-filter"]) {
          for (const pattern of (provider[field] || "").split("`")) if (pattern) regex(pattern);
        }
        for (const rule of override["proxy-name"] || []) regex(rule.pattern, "g");
      } catch (_) { known = false; }
    }
    if (!known) { unknownProviders.add(name); return [name, []]; }
    const nodes = ordered(provider.payload || [], provider.filter).filter(node => allowed(node, provider, true, false)).map(raw => {
      const node = { ...raw };
      const dialer = providerDialer(provider);
      if (dialer !== undefined) node["dialer-proxy"] = dialer;
      for (const rule of override["proxy-name"] || []) {
        node.name = rename(node.name, rule);
      }
      node.name = (override["additional-prefix"] || "") + node.name + (override["additional-suffix"] || "");
      return node;
    });
    return [name, nodes];
  }));
  const nodes = [...proxies, ...Object.values(providerNodes).flat()];
  const byProxy = new Map(proxies.map(node => [node.name, node]));
  // 保留修改前的组定义，候选分类不受后续注入出口的顺序影响。
  const byGroup = new Map(groups.map(group => [group.name, { ...group, proxies: list(group.proxies).slice() }]));
  const builtins = new Map(["DIRECT", "REJECT", "REJECT-DROP", "COMPATIBLE", "PASS", "PASS-RULE"]
    .map(name => [name, { name, type: name.toLowerCase() }]));
  const resolve = target => typeof target === "string" ? byProxy.get(target) || byGroup.get(target) || builtins.get(target) : target;
  const providerNames = group => group["include-all"] || group["include-all-providers"]
    ? Object.keys(providers).sort() : list(group.use);
  function staticMembers(group) {
    const dynamic = group["include-all"] || group["include-all-proxies"]
      ? proxies.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        .filter(node => matches(group.filter, node.name, true)) : [];
    return [...list(group.proxies).map(resolve).filter(Boolean), ...dynamic]
      .filter(node => allowed(node, group, false));
  }
  function members(group) {
    const statics = staticMembers(group);
    const pools = providerNames(group);
    const items = [...statics, ...pools.flatMap(name =>
      ordered(providerNodes[name] || [], group.filter).filter(node => allowed(node, group, false)))];
    // Mihomo 对多个 provider 的多段 filter 按段顺序整体排序。
    return pools.length + (statics.length ? 1 : 0) > 1 && (group.filter || "").includes("`")
      ? ordered(items, group.filter, true) : items;
  }
  function usesTailscale(target, seen = new Set()) {
    const node = resolve(target);
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (byGroup.get(node.name) === node) {
      return members(node).some(child => usesTailscale(child, seen)) ||
        providerNames(node).some(name => providers[name] && providers[name].type !== "inline" &&
          usesTailscale(providerDialer(providers[name]), seen));
    }
    return node.type === "tailscale" || usesTailscale(node["dialer-proxy"], seen);
  }
  function dependsOn(target, groupName, seen = new Set()) {
    const node = resolve(target);
    if (!node || seen.has(node)) return false;
    if (node.name === groupName) return true;
    seen.add(node);
    if (byGroup.get(node.name) === node) {
      return members(node).some(child => dependsOn(child, groupName, seen)) ||
        providerNames(node).some(name => dependsOn(providerDialer(providers[name] || {}), groupName, seen));
    }
    return dependsOn(node["dialer-proxy"], groupName, seen);
  }
  const protectedNames = new Set();
  const visited = new Set();
  function protect(target) {
    const node = resolve(target);
    if (!node || visited.has(node)) return;
    visited.add(node);
    if (byGroup.get(node.name) === node) {
      protectedNames.add(node.name);
      members(node).forEach(protect);
      providerNames(node).forEach(name => protect(providerDialer(providers[name] || {})));
    } else {
      protect(node["dialer-proxy"]);
    }
  }
  nodes.forEach(node => protect(node["dialer-proxy"]));
  Object.values(providers).forEach(provider => protect(providerDialer(provider)));
  const unique = values => [...new Set(values)];
  const exact = values => "^(?:" + unique(values).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, char => "\\" + char)).join("|") + ")$";
  const isExit = node => node.type === "tailscale" &&
    typeof node["exit-node"] === "string" && node["exit-node"].trim();
  const staticExits = proxies.filter(isExit).map(node => node.name);
  const exitNames = unique(nodes.filter(isExit).map(node => node.name));
  const exitProviders = Object.keys(providers).filter(name => providerNodes[name].some(isExit));
  function includeResidential(group, residential) {
    group.proxies = unique([residential.name, ...list(group.proxies)]);
    const hidden = residential["x-residential-members"].filter(name =>
      !matches(group["exclude-filter"], name, false));
    if (hidden.length) group["exclude-filter"] = [group["exclude-filter"], exact(hidden)].filter(Boolean).join("`");
  }
  function restrictTailscale(group) {
    const knownProvider = name => providers[name] && !unknownProviders.has(name);
    // 测速排除使用“可能经过 TS”；受限出口必须保证所有可选拨号分支均经过 TS。
    function requiresTailscale(target, seen = new Set()) {
      const node = resolve(target);
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (byGroup.get(node.name) === node) {
        // 受限组包含 DIRECT，依赖该组的节点不属于必经 Tailscale 的链路。
        if (node["x-candidate-mode"] === "tailscale") return false;
        const children = members(node);
        return children.length > 0 && providerNames(node).every(knownProvider) &&
          children.every(child => requiresTailscale(child, new Set(seen)));
      }
      return node.type === "tailscale" || requiresTailscale(node["dialer-proxy"], seen);
    }
    const related = node => (node.type !== "tailscale" || isExit(node)) && requiresTailscale(node);
    const staticNames = proxies.filter(related).map(node => node.name);
    // 受限组从可完整分类的 inline provider 中选择相关出口。
    const pools = Object.keys(providers).filter(name => knownProvider(name) &&
      providerNodes[name].some(related));
    const relatedNames = unique([...staticNames,
      ...pools.flatMap(name => providerNodes[name].filter(related).map(node => node.name))]);
    group.proxies = [...staticNames, "DIRECT"];
    group.use = pools;
    for (const key of ["include-all", "include-all-proxies", "include-all-providers", "filter", "exclude-filter", "exclude-type"]) {
      delete group[key];
    }
    if (pools.length) group.filter = exact([...relatedNames, "DIRECT"]);
    if (!relatedNames.includes(group["default-selected"]) && group["default-selected"] !== "DIRECT") {
      console.log(`[自定义分流] ${group.name} 的默认项不在受限候选中，使用 DIRECT。`);
      group["default-selected"] = "DIRECT";
    }
    prioritize(group, [relatedNames, ["DIRECT"]]);
  }
  function deduplicate(group, names) {
    if (!names.length || providerNames(group).length || !(group["include-all"] || group["include-all-proxies"])) return;
    const prefix = "^(?!" + exact(names).slice(1) + ")[\\s\\S]*";
    group.filter = (group.filter || ".*").split("`").map(pattern =>
      names.some(name => matches(pattern, name, true, true)) ? prefix + "(?:" + pattern + ")" : pattern
    ).join("`");
  }
  function addExits(group) {
    if (!exitNames.length) return;
    const previousProviders = providerNames(group);
    const previousNames = new Set([...list(group.proxies), ...members(group).map(node => node.name)]);
    const addedProviders = exitProviders.filter(name => !previousProviders.includes(name));
    // provider 节点沿用 use 引用和原实例身份。
    if (addedProviders.length) group.use = unique([...list(group.use), ...addedProviders]);
    const unwanted = addedProviders.flatMap(name => providerNodes[name])
      .filter(node => !isExit(node) && !previousNames.has(node.name)).map(node => node.name);
    group.proxies = unique([...list(group.proxies), ...staticExits]);
    if (group.filter) {
      const missing = exitProviders.flatMap(name => providerNodes[name]).filter(isExit)
        .map(node => node.name).filter(name => !matches(group.filter, name, true));
      if (missing.length) group.filter += "`" + exact(missing);
    }
    // 有效 Tailscale 出口独立处理类型与名称过滤，其余排除条件沿用原值。
    if (group["exclude-type"]) {
      group["exclude-type"] = group["exclude-type"].split("|")
        .filter(type => type.toLowerCase() !== "tailscale").join("|");
    }
    const prefix = "^(?!" + exact(exitNames).slice(1) + ")[\\s\\S]*";
    const excludes = (group["exclude-filter"] || "").split("`").filter(Boolean).map(pattern =>
      exitNames.some(name => matches(pattern, name, false, true)) ? prefix + "(?:" + pattern + ")" : pattern
    );
    if (unwanted.length) excludes.push(exact(unwanted));
    if (excludes.length) group["exclude-filter"] = unique(excludes).join("`");
    deduplicate(group, staticExits);
  }
  function freezeDefault(group) {
    const original = byGroup.get(group.name) || group;
    if (original["default-selected"]) {
      group["default-selected"] = original["default-selected"];
      return true;
    }
    const pools = providerNames(original);
    const unknown = pools.some(name => !providers[name] || unknownProviders.has(name));
    let supported = true;
    try {
      for (const scope of [original, ...pools.map(name => providers[name] || {})]) {
        for (const field of ["filter", "exclude-filter"]) {
          for (const pattern of (scope[field] || "").split("`")) if (pattern) regex(pattern);
        }
      }
    } catch (_) { supported = false; }
    const first = members(original).find(node => node.type !== "tailscale" || isExit(node));
    if (supported && first && !(unknown && (!staticMembers(original).length || (original.filter || "").includes("`")))) {
      group["default-selected"] = first.name;
      return true;
    }
    console.log("[默认选择] " + group.name + " 无法确定原有效默认项，跳过注入与排序。");
    return false;
  }
  function relatedMembers(group) {
    const visible = new Set(members(group).map(node => node.name));
    return unique(nodes.filter(node => visible.has(node.name) &&
      (node.type !== "tailscale" || isExit(node)) && usesTailscale(node)).map(node => node.name));
  }
  function prioritize(group, buckets) {
    const heads = buckets.filter(names => names.length).map(unique);
    const priority = unique(heads.flat());
    const explicit = list(group.proxies);
    group.proxies = unique([...priority.filter(name => explicit.includes(name) || byProxy.has(name)), ...explicit]);
    if (providerNames(group).length && heads.length) {
      // 多段 filter 同时排序静态项和 provider 项，内核会按名称去重。
      const filters = heads.map(exact);
      const rest = (group.filter || ".*").split("`").filter(pattern => !filters.includes(pattern));
      group.filter = unique([...filters, ...rest]).join("`");
    } else {
      deduplicate(group, priority);
    }
  }
  function allowDirect(group) {
    const types = (group["exclude-type"] || "").split("|");
    const excludes = (group["exclude-filter"] || "").split("`").filter(Boolean).map(pattern =>
      matches(pattern, "DIRECT", false, true) ? "^(?!DIRECT$)[\\s\\S]*(?:" + pattern + ")" : pattern);
    if (types.some(type => type.toLowerCase() === "direct")) {
      group["exclude-type"] = types.filter(type => type.toLowerCase() !== "direct").join("|");
      const otherDirect = nodes.filter(node => node.type === "direct").map(node => node.name);
      if (otherDirect.length) excludes.push(exact(otherDirect));
    }
    if (excludes.length) group["exclude-filter"] = unique(excludes).join("`");
  }
  return { nodes, byProxy, byGroup, members, usesTailscale, dependsOn, protectedNames, protect, providerDialer,
    addExits, deduplicate, freezeDefault, relatedMembers, prioritize, allowDirect, restrictTailscale, includeResidential };
}

// ===== END CORE =====
