// ===== BEGIN MODULE groups =====
// 参数：CONFIG.groups = { enabled, definitions, injectExisting, order }。
// definitions: [{name, candidates:"all"|"tailscale", default:"DIRECT"}]。
// 阶段：declare / prepare / transform；只修改 proxy-groups，默认顺序：住宅 → DIRECT → Tailscale 相关出口 → 原候选。
registerModule({
  id: "groups", order: 30, candidates: true,
  declare(ctx, options) {
    const definitions = options.definitions || [];
    ctx.addGroups(definitions.map(item => {
      if (!["all", "tailscale"].includes(item.candidates)) throw new Error("未知候选范围：" + item.candidates);
      const old = (ctx.config["proxy-groups"] || []).find(g => g.name === item.name);
      return old?.["x-candidate-mode"] === item.candidates ? old : {
        name: item.name, type: "select", proxies: ["DIRECT"], "default-selected": item.default || "DIRECT",
        "x-candidate-mode": item.candidates, ...(item.candidates === "all" ? { "include-all": true } : {}),
      };
    }));
  },
  prepare(ctx, options) {
    // 先建立自定义组的候选，让后续住宅测速和普通组能按完整拨号链分类。
    for (const item of options.definitions || []) {
      const group = ctx.config["proxy-groups"].find(g => g.name === item.name);
      if (item.candidates === "tailscale") ctx.graph.restrictTailscale(group);
      else ctx.hide(group, ctx.graph.nodes.filter(node =>
        ctx.transportOnly(node) || ctx.graph.dependsOn(node, group.name)).map(node => node.name));
    }
  },
  transform(ctx, options) {
    const graph = ctx.graph;
    const definitions = new Map((options.definitions || []).map(d => [d.name, d]));
    const hidden = graph.nodes.filter(ctx.transportOnly).map(p => p.name);
    const related = (ctx.config.proxies || []).filter(p => !ctx.transportOnly(p) && graph.usesTailscale(p)).map(p => p.name);
    for (const group of ctx.config["proxy-groups"] || []) {
      const definition = definitions.get(group.name);
      // 原有内部组不扩展；新定义的组即使用作拨号前置，也必须先建立候选。
      if (group["x-v4-role"]?.startsWith("residential") || (!definition && graph.protectedNames.has(group.name))) continue;
      if (group["x-candidate-mode"] === "tailscale") {
        graph.restrictTailscale(group);
        ctx.sort(group, options.order);
        continue;
      }
      ctx.hide(group, hidden);
      if (group.type !== "select") {
        if (group["include-all"] || group["include-all-proxies"]) ctx.hide(group, related);
        continue;
      }
      if (!definition && options.injectExisting === false) continue;
      if (!ctx.preserveDefault(group)) continue;
      if (definition) {
        const target = definition.default || "DIRECT";
        const unknown = Object.values(ctx.config["proxy-providers"] || {}).some(p => p.type !== "inline");
        group["default-selected"] = graph.nodes.some(p => p.name === target) ||
          (definition.candidates === "all" && unknown) ? target : ctx.ruleTarget(target);
      }
      group.proxies = ctx.unique([...(group.proxies || []), ...related, "DIRECT"]);
      graph.addExits(group);
      for (const exit of ctx.residentialExits()) {
        if (!graph.dependsOn(exit.name, group.name)) graph.includeResidential(group, exit);
      }
      graph.allowDirect(group);
      if (definition) ctx.hide(group, graph.nodes.filter(node => graph.dependsOn(node, group.name)).map(node => node.name));
      ctx.sort(group, options.order);
    }
  },
});
// ===== END MODULE groups =====
