// scripts/daemon.ts
// 运行命令: npx tsx --env-file=.env.local scripts/daemon.ts
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
import { runTradingBot } from '../lib/engine';
import { syncSymbolHistory } from '../lib/market-service';
import { CONFIG } from '../lib/config';

// ⚡️ 核心心跳：每 5 秒醒来一次 (极速更新价格)
const TICK_INTERVAL = 5 * 1000;

// 🐢 K线同步间隔：每 12 个心跳 (即 60 秒) 同步一次
const SYNC_EVERY_TICKS = 12;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let tickCount = 0;

async function loop() {
  tickCount++;
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  // 1. ⚡️ 极速环节：执行交易 & 更新实时报价
  try {
    process.stdout.write(`[${now}] 💓 心跳 #${tickCount} | 正在获取实时行情... `);
    await runTradingBot(); 
  } catch (error) {
    console.error("❌ 交易扫描出错:", error);
  }

  // 2. 🐢 慢速环节：K 线增量同步 (只更新最近几天)
  if (tickCount % SYNC_EVERY_TICKS === 0) {
    console.log("\n📊 触发 K 线增量同步 (更新今日及近期数据)...");
    try {
      for (const sym of CONFIG.SYMBOLS) {
        await sleep(2000); // 礼貌请求
        
        // 🔥 修改核心：传入参数 5
        // 含义：只同步最近 5 天的数据。
        // 作用：
        // 1. 实时更新“今天”的 K 线 (开/高/低/收 随市场变化)。
        // 2. 自动修补过去几天的最终收盘价 (防止前几天脚本没开)。
        // 3. 避免每次都覆写过去 260 天的数据，极大节省数据库 IO。
        await syncSymbolHistory(sym, 5); 
      }
      console.log("✅ K 线增量更新完成。");
    } catch (error) {
      console.error("❌ K 线同步出错:", error);
    }
  }

  setTimeout(loop, TICK_INTERVAL);
}

console.log(`🚀 QuantSim 极速守护进程已启动`);
console.log(`⚡️ 价格更新频率: 5 秒/次`);
console.log(`🐢 K 线同步频率: 60 秒/次 (仅更新近5天)`);
console.log(`----------------------------------------------------`);

loop();