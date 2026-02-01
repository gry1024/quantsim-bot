// scripts/debug-sina.ts
// 运行命令: npx tsx scripts/debug-sina.ts

const SYMBOLS = ['QQQ', 'GLD', 'SPY', 'NVDA', 'COIN']; // 包含 COIN

async function testFetch() {
  console.log("🔍 1. 正在构造 URL...");
  // 模拟 engine.ts 中的 URL 构造逻辑
  const symbolsStr = SYMBOLS.map(s => s.toLowerCase()).join(',');
  const queryList = SYMBOLS.map(s => `gb_${s.toLowerCase()}`).join(',');
  const url = `https://hq.sinajs.cn/list=${queryList}&t=${Date.now()}`;
  
  console.log(`   👉 请求地址: ${url}`);

  try {
    console.log("🔍 2. 正在发起 Fetch 请求...");
    const res = await fetch(url, { 
      headers: { 'Referer': 'https://finance.sina.com.cn/' }, 
      cache: 'no-store' 
    });
    
    const text = await res.text();
    console.log(`   ✅ 请求成功，收到 ${text.length} 字符`);
    console.log("--------------------------------------------------");
    console.log("🔍 3. 原始返回内容 (Raw Output):");
    console.log(text);
    console.log("--------------------------------------------------");

    console.log("🔍 4. 开始逐行正则匹配测试...");
    const lines = text.split('\n');
    let coinFound = false;

    lines.forEach((line, index) => {
      if (!line.trim()) return;

      // 这里使用和 engine.ts 一模一样的正则
      const regex = /gb_(\w+)="([^"]+)"/;
      const match = line.match(regex);

      if (match) {
        const symbolCode = match[1]; // 可能是 'coin' 或 'COIN'
        const dataStr = match[2];
        const symbol = symbolCode.toUpperCase();
        
        console.log(`   [行 ${index+1}] 匹配成功: code='${symbolCode}' -> symbol='${symbol}'`);
        
        if (symbol === 'COIN') {
          coinFound = true;
          console.log(`   🎉🎉🎉 成功抓取到 COIN ! 数据: ${dataStr.substring(0, 20)}...`);
        }
      } else {
        console.log(`   [行 ${index+1}] ❌ 匹配失败: ${line}`);
      }
    });

    console.log("--------------------------------------------------");
    if (coinFound) {
      console.log("✅ 结论: 代码逻辑没问题，可能是 PM2 没重启或缓存代码未更新。");
    } else {
      console.log("❌ 结论: 代码逻辑无法解析返回的数据 (请检查上方匹配失败的行)。");
    }

  } catch (error) {
    console.error("❌ Fetch 请求炸了:", error);
  }
}

testFetch();