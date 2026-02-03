// scripts/inspect-sina.ts
// 运行命令: npx tsx scripts/inspect-sina.ts

import { CONFIG } from '../lib/config';

async function inspectSinaData() {
  console.log("🔍 开始字段探测...");

  const symbols = CONFIG.SYMBOLS.map(s => `gb_${s.toLowerCase()}`).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols}&t=${Date.now()}`;

  try {
    const res = await fetch(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn/' },
      cache: 'no-store'
    });
    
    const text = await res.text();
    const lines = text.split('\n');

    lines.forEach((line) => {
      const match = line.match(/gb_(\w+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const dataStr = match[2];
        const parts = dataStr.split(',');

        console.log(`\n================== [${symbol}] ==================`);
        console.log(`原始完整字符串: "${dataStr}"`);
        console.log(`--------------------------------------------------`);
        
        parts.forEach((value, index) => {
          // 高亮可能包含 2026 (日期) 或 涨跌幅的索引
          let note = "";
          if (value.includes("2026")) note = "  <-- ⚠️ 这里是日期，不是涨跌幅";
          if (parseFloat(value) > -50 && parseFloat(value) < 50 && value.includes(".")) note = "  <-- 💎 可能是涨跌幅";
          if (index === 1) note = "  <-- 💰 当前价格";

          console.log(`Index [${index.toString().padStart(2, '0')}]: ${value}${note}`);
        });
      }
    });

    console.log("\n✅ 探测结束。请查看上方输出，找到正确的涨跌幅索引。");
  } catch (error) {
    console.error("❌ 获取数据失败:", error);
  }
}

inspectSinaData();