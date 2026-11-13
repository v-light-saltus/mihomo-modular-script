// ===== BEGIN MODULE customNodes =====
// 参数：CONFIG.customNodes = { enabled, nodes: [原生 Mihomo 节点] }。
// 阶段：declare / transform；修改 proxies、已有组的传输节点过滤。
registerModule({
  id: "customNodes", order: 10, candidates: true,
  declare(ctx, options) { ctx.addNodes(options.nodes || []); },
  transform(ctx) {
    const hidden = ctx.graph.nodes.filter(ctx.transportOnly).map(p => p.name);
    for (const group of ctx.config["proxy-groups"] || []) {
      if (!ctx.graph.protectedNames.has(group.name)) ctx.hide(group, hidden);
    }
  },
});
// ===== END MODULE customNodes =====
