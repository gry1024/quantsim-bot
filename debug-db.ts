import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debug() {
  console.log("🔍 开始诊断数据库连接...");
  console.log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);

  // 1. 测试连接并获取所有表名（验证 Key 是否有效）
  const { data: tables, error: connError } = await supabase.from('portfolio').select('*');

  if (connError) {
    console.error("❌ 数据库连接失败！具体原因：", connError.message);
    console.error("错误代码 (Code):", connError.code);
    return;
  }

  console.log("✅ 数据库连接成功！");

  // 2. 检查 portfolio 表的数据量
  if (tables && tables.length > 0) {
    console.log(`📈 发现 portfolio 表中有 ${tables.length} 条数据。`);
    console.log("数据内容:", tables[0]);
  } else {
    console.error("⚠️ 警告：portfolio 表是空的！这就是报错原因。");
    console.log("请去 Supabase SQL Editor 再次运行 INSERT 语句。");
  }
}

debug();