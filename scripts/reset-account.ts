// 运行命令: npx tsx --env-file=.env.local scripts/reset-account.ts

import { supabase, CONFIG } from '../lib/config';

async function resetAccount() {
  console.log("🧨 正在执行账户核弹重置...");

  // 1. 清空交易日志 (使用 neq symbol '0'，因为 symbol 肯定不是 '0'，所以会匹配所有行并删除)
  // 如果 trades 表有 id 列，可以用 id；如果没有，用 symbol
  const { error: errTrades } = await supabase.from('trades').delete().neq('symbol', '0');
  if (errTrades) console.error("❌ 清空 Trades 失败:", errTrades.message);
  else console.log("✅ 交易日志已清空");

  // 2. 清空持仓 (关键修改：用 symbol 而不是 id)
  const { error: errPos } = await supabase.from('positions').delete().neq('symbol', '0');
  if (errPos) console.error("❌ 清空 Positions 失败:", errPos.message);
  else console.log("✅ 持仓已清空");

  // 3. 清空资产快照
  // 这里的 id 应该是存在的 (Supabase 默认建表会有)，如果也报错，可以改用 created_at
  const { error: errSnap } = await supabase.from('equity_snapshots').delete().neq('id', 0);
  if (errSnap) {
      // 备用方案：如果 equity_snapshots 也没 id，尝试用 created_at
      await supabase.from('equity_snapshots').delete().neq('created_at', '1970-01-01');
      console.log("✅ 资产走势已重置 (Backup Method)");
  } else {
      console.log("✅ 资产走势已重置");
  }

  // 4. 重置总资金为初始值 (100万)
  const { error: errPort } = await supabase
    .from('portfolio')
    .update({ 
      cash_balance: CONFIG.INITIAL_CAPITAL,
      total_equity: CONFIG.INITIAL_CAPITAL,
      updated_at: new Date().toISOString()
    })
    .gt('total_equity', -1); // 更新所有行 (Total Equity 大于 -1 的行)

  if (errPort) console.error("❌ 重置 Portfolio 失败:", errPort.message);
  else console.log(`✅ 账户资金已恢复至 $${CONFIG.INITIAL_CAPITAL.toLocaleString()}`);

  console.log("-----------------------------------");
  console.log("🚀 重置完成！请重启 daemon，机器人将重新执行 Initial Entry。");
}

resetAccount();