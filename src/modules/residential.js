// ===== BEGIN MODULE residential =====
// 参数：CONFIG.residential；生成住宅 SOCKS5 节点、前置选择与测速策略组。
// 阶段：declare / transform；修改 proxies、proxy-groups。
registerModule({
  id: "residential", order: 20, candidates: true,
  declare(ctx, options) {
    const nodes = (options.nodes || []).filter(p => p.server && p.port);
    if (!nodes.length) { ctx.warn("住宅节点未填写，跳过住宅模块。"); return; }
    const names = { node: "住宅节点", exit: "住宅出口", front: "前置选择", auto: "前置测速", ...options.names };
    const proxies = nodes.map((p, i) => ({ ...p, name: names.node + "-" + (p.name || i + 1), type: "socks5", "dialer-proxy": names.front }));
    ctx.state.residential = { names, proxies };
    ctx.addNodes(proxies);
    ctx.addGroups([
      { name: names.exit, type: "select", proxies: proxies.map(p => p.name), "default-selected": proxies[0].name,
        "x-residential-members": proxies.map(p => p.name), "x-v4-role": "residential-exit" },
      { name: names.front, type: "select", proxies: ["DIRECT"], "x-v4-role": "residential-front" },
      { name: names.auto, type: "url-test", proxies: ["REJECT"], "x-v4-role": "residential-auto" },
    ]);
  },
  transform(ctx, options) {
    const state = ctx.state.residential;
    if (!state) return;
    const { names, proxies } = state;
    const graph = ctx.graph;
    const own = proxies.map(p => p.name);
    const transport = graph.nodes.filter(ctx.transportOnly).map(p => p.name);
    const related = graph.nodes.filter(p => !ctx.transportOnly(p) && graph.usesTailscale(p)).map(p => p.name);
    const notice = options.noticeFilter ?? "剩余流量|到期时间|过期时间|套餐到期|官网地址|重置时间";
    const exclusions = values => [ctx.exact(ctx.unique([...own, ...values])), notice].filter(Boolean).join("`");
    const eligible = (ctx.config.proxies || []).filter(p => !own.includes(p.name) && !transport.includes(p.name) &&
      !related.includes(p.name) && !["direct", "reject", "dns", "pass"].includes(p.type)).map(p => p.name);
    const providers = ctx.config["proxy-providers"] || {};
    const base = {
      proxies: eligible.length ? eligible : ["REJECT"], use: Object.keys(providers),
      "exclude-filter": exclusions([...transport, ...related]), "exclude-type": "direct|reject|dns|pass", "empty-fallback": "REJECT",
    };
    if (options.frontFilter) { base.proxies = []; base["include-all-proxies"] = true; base.filter = options.frontFilter; }
    const auto = {
      ...base, name: names.auto, type: "url-test", "x-v4-role": "residential-auto",
      use: base.use.filter(n => !graph.usesTailscale(graph.providerDialer(providers[n]))),
      "exclude-type": "direct|reject|dns|pass|tailscale", url: options.testUrl || "https://www.gstatic.com/generate_204",
      interval: options.interval || 300, timeout: 5000, tolerance: 50, lazy: false,
    };
    const manual = (ctx.config.proxies || []).filter(p => related.includes(p.name) && !own.includes(p.name)).map(p => p.name);
    const front = {
      ...base, name: names.front, type: "select", "x-v4-role": "residential-front",
      proxies: [names.auto, "DIRECT", ...manual, ...base.proxies],
      "exclude-filter": exclusions(transport), "exclude-type": "reject|dns|pass",
      "default-selected": ctx.defaults.get(names.front) || names.auto,
    };
    ctx.sort(front, options.order);
    ctx.addGroups([auto, front]);
    // 保持固定展示顺序，原订阅组的相对顺序不变。
    const byName = new Map(ctx.config["proxy-groups"].map(g => [g.name, g]));
    ctx.config["proxy-groups"] = [byName.get(names.exit), front, auto,
      ...ctx.config["proxy-groups"].filter(g => ![names.exit, names.front, names.auto].includes(g.name))];
    for (const group of ctx.config["proxy-groups"]) {
      if (group["x-v4-role"]?.startsWith("residential")) continue;
      if (group["include-all"] || group["include-all-proxies"]) ctx.hide(group, own);
    }
  },
});
// ===== END MODULE residential =====
