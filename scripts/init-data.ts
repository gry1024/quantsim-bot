// init-data.ts
// 运行命令: npx tsx scripts/init-data.ts

import dotenv from 'dotenv';
import path from 'path';

// 1. 强制加载 .env.local 环境变量
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  console.log("🚀 正在启动数据初始化脚本...");

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("❌ 错误：仍未读取到环境变量！");
    process.exit(1);
  }

  // 2. 动态导入库文件
  const { CONFIG } = await import('../lib/config');
  const { syncSymbolHistory } = await import('../lib/market-service');

  console.log("✅ 环境变量加载成功，开始同步历史数据...");
  
  const symbols = CONFIG.SYMBOLS; 

  for (const sym of symbols) {
    // ✅ 修改处：日志文案改为“近一年”，并没有显式传参（因为默认值已改为260）
    // 或者你可以显式调用：await syncSymbolHistory(sym, 260);
    console.log(`📡 正在下载 ${sym} 的近一年 K 线数据 (约260个交易日)...`);
    await syncSymbolHistory(sym, 260); 
  }

  console.log("-----------------------------------");
  console.log("✅ 初始化完成！所有 K 线数据已存入 Supabase。");
  console.log("⚡️ 请刷新网页，并尝试在 K 线图上向左拖动查看历史。");
}

main();