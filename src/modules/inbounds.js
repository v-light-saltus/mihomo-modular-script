// ===== BEGIN MODULE inbounds =====
// 参数：CONFIG.inbounds.listeners = [{name, type, listen, port, udp, target, ...原生字段}]。
// 阶段：finalize；target 为已有节点或策略组，写入前移除该扩展字段。
registerModule({
  id: "inbounds", order: 60,
  finalize(ctx, options) {
    const listeners = [];
    const rules = [];
    for (const { target, ...listener } of options.listeners || []) {
      if (!ctx.requireTarget(target, "入站 " + listener.name + " ")) continue;
      listeners.push(ctx.clone(listener));
      rules.push(`IN-PORT,${listener.port},${target}`);
    }
    if (listeners.length) {
      const names = new Set(listeners.map(l => l.name));
      ctx.config.listeners = [...listeners, ...(ctx.config.listeners || []).filter(l => !names.has(l.name))];
      ctx.addRules(rules, 10);
    }
  },
});
// ===== END MODULE inbounds =====
