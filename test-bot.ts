import * as dotenv from 'dotenv';

// 1. 先加载环境变量 (这行代码现在会最先执行)
dotenv.config({ path: '.env.local' });

async function main() {
  console.log("🚀 Loading Environment...");

  // 2. 关键修改：在这里才导入引擎，确保上面那行代码已经跑完了
  const { runTradingBot } = await import('./lib/engine');

  console.log("🤖 Bot Starting...");
  
  try {
    const result = await runTradingBot();
    
    console.log("------------------------------------------------");
    console.log("✅ Execution Result:", result);
    console.log("------------------------------------------------");
    
  } catch (error) {
    console.error("❌ Error running bot:", error);
  }
}

main();