import { supabase, CONFIG } from '../lib/config';

async function resetAccount() {
  console.log("🧨 正在执行账户深度重置...");

  // 1. 清空所有交易数据
  await supabase.from('trades').delete().neq('symbol', 'FORCE_DELETE');
  await supabase.from('positions').delete().neq('symbol', 'FORCE_DELETE');
  await supabase.from('equity_snapshots').delete().neq('investor_id', 'FORCE_DELETE');

  // 2. 重置所有人的资金
  const { error: errPort } = await supabase
    .from('portfolio')
    .update({ 
      cash_balance: CONFIG.INITIAL_CAPITAL,
      total_equity: CONFIG.INITIAL_CAPITAL,
      peak_equity: CONFIG.INITIAL_CAPITAL,
      updated_at: new Date().toISOString()
    })
    .gt('total_equity', -1);

  if (errPort) console.error("❌ 重置失败:", errPort.message);
  else console.log(`✅ 账户已重置为 $${CONFIG.INITIAL_CAPITAL.toLocaleString()}`);
}

resetAccount();