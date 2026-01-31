// 运行命令: npx tsx scripts/init-data.ts

import dotenv from 'dotenv';
import path from 'path';

// 1. 强制加载 .env.local 环境变量
// process.cwd() 获取当前项目根目录
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  console.log("🚀 正在启动数据初始化脚本...");

  // 检查环境变量是否加载成功
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("❌ 错误：仍未读取到环境变量！");
    console.error("请确认项目根目录下存在 .env.local 文件。");
    process.exit(1);
  }

  // 2. 动态导入库文件 (关键步骤！)
  // 必须在环境变量加载之后再 import 这些文件，否则会报错
  const { CONFIG } = await import('../lib/config');
  const { syncSymbolHistory } = await import('../lib/market-service');

  console.log("✅ 环境变量加载成功，开始同步历史数据...");
  
  const symbols = CONFIG.SYMBOLS; 

  for (const sym of symbols) {
    console.log(`📡 正在下载 ${sym} 的近半年 K 线数据...`);
    await syncSymbolHistory(sym);
  }

  console.log("-----------------------------------");
  console.log("✅ 初始化完成！所有 K 线数据已存入 Supabase。");
  console.log("⚡️ 现在刷新网页，图表将瞬间加载。");
}

main();