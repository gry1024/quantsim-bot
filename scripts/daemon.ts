// 运行命令: npx tsx --env-file=.env.local scripts/daemon.ts
// scripts/daemon.ts
// 1. 引入 dns 模块
import { setDefaultResultOrder } from 'node:dns';
// 2. 强制设置 DNS 解析优先使用 IPv4
setDefaultResultOrder('ipv4first');
import { runTradingBot } from '../lib/engine';
import { syncSymbolHistory } from '../lib/market-service';
import { CONFIG } from '../lib/config';

// ⚡️ 核心心跳：每 5 秒醒来一次 (极速更新价格)
const TICK_INTERVAL = 5 * 1000;

// 🐢 K线同步间隔：每 12 个心跳 (即 60 秒) 同步一次历史数据
// 这样可以保证网页上的价格狂跳，但不会触发 Stooq 的反爬封锁
const SYNC_EVERY_TICKS = 12;

// 辅助函数：等待 (用于 K 线同步时的礼貌间隔)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let tickCount = 0;

async function loop() {
  tickCount++;
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  // 1. ⚡️ 极速环节：执行交易 & 更新实时价格 (Sina 接口很稳，随便请求)
  // 这会让网页上的 "当前价格" 和 "总资产" 每 5 秒就变动一次
  try {
    process.stdout.write(`[${now}] 💓 心跳 #${tickCount} | 正在获取实时行情... `);
    await runTradingBot(); // 这里面会打印 "💰 结算完成..."
  } catch (error) {
    console.error("❌ 交易扫描出错:", error);
  }

  // 2. 🐢 慢速环节：同步 K 线 (Stooq 接口易崩，要节省着用)
  if (tickCount % SYNC_EVERY_TICKS === 0) {
    console.log("📊 触发周期性 K 线同步 (每分钟一次)...");
    try {
      for (const sym of CONFIG.SYMBOLS) {
        // 礼貌请求：每只股票中间休息 2 秒
        await sleep(2000); 
        await syncSymbolHistory(sym);
      }
      console.log("✅ K 线同步完成。");
    } catch (error) {
      console.error("❌ K 线同步出错:", error);
    }
  }

  // 安排下一次心跳
  setTimeout(loop, TICK_INTERVAL);
}

console.log(`🚀 QuantSim 极速守护进程已启动`);
console.log(`⚡️ 价格更新频率: 5 秒/次`);
console.log(`🐢 K 线同步频率: 60 秒/次`);
console.log(`----------------------------------------------------`);

// 启动死循环
loop();