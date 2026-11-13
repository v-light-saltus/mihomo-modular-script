// ===== BEGIN MODULE providers =====
// 参数：CONFIG.providers = { enabled, outbound, overrideExisting, healthCheck }。
// 阶段：prepare / finalize；设置配置内 providers 的下载出口与健康检查。
registerModule({
  id: "providers", order: 40,
  prepare(ctx, options) {
    const outbound = options.outbound || "DIRECT";
    if (!ctx.requireTarget(outbound, "资源下载")) return;
    ctx.protectTargets.add(outbound);
    ctx.state.providers = { outbound, overrideExisting: options.overrideExisting !== false };
  },
  finalize(ctx, options) {
    const state = ctx.state.providers;
    if (!state) return;
    const proxies = ctx.config["proxy-providers"] || {};
    for (const provider of [...Object.values(proxies), ...Object.values(ctx.config["rule-providers"] || {})]) {
      if (provider.type === "http" && (state.overrideExisting || !provider.proxy)) provider.proxy = state.outbound;
    }
    if (options.healthCheck !== false) {
      const check = options.healthCheck || { enable: true, url: "https://www.gstatic.com/generate_204", interval: 300, timeout: 5000, lazy: false };
      for (const provider of Object.values(proxies)) {
        if (!provider["health-check"]) provider["health-check"] = ctx.clone(check);
      }
    }
  },
});
// ===== END MODULE providers =====
