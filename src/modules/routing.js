// ===== BEGIN MODULE routing =====
// 参数：CONFIG.routing.rules = [[类型, 内容, 目标, ...参数]]；
// tcpTargets = [[IPv4, 端口, 目标]]，匹配 TCP 目的地址与端口。
// 阶段：finalize；修改 rules，保留原订阅 MATCH。
registerModule({
  id: "routing", order: 70,
  finalize(ctx, options) {
    const rules = (options.rules || []).map(([type, value, target, ...params]) => {
      if (type === "MATCH") throw new Error("自定义分流不接管原订阅 MATCH。");
      return [type, value, ctx.ruleTarget(target), ...params].join(",");
    });
    const tcp = (options.tcpTargets || []).map(([ip, port, target]) =>
      `AND,((NETWORK,TCP),(IP-CIDR,${ip}/32,no-resolve),(DST-PORT,${port})),${ctx.ruleTarget(target)}`);
    ctx.addRules([...rules, ...tcp]);
  },
});
// ===== END MODULE routing =====
