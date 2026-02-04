# QuantSim - 全自动美股量化交易模拟终端

QuantSim 是一个基于 Next.js + Supabase 的全栈量化交易模拟系统。它包含一个实时动态更新的 Dashboard 前端，以及一个后台自动运行的交易机器人（Daemon），支持美股实时行情获取、策略自动执行及价格数据同步。

## 📂 项目文件结构

```text
quantsim-bot/
├── app/
│   ├── components/            # 前端 UI 组件库
│   │   ├── AssetDonut.tsx     # [UI] 侧边栏资产分布甜甜圈图 (Recharts)
│   │   ├── DashboardClient.tsx# [核心] 客户端主容器，负责 Supabase Realtime 监听与状态管理
│   │   ├── EquityChart.tsx    # [UI] 顶部总资产走势面积图 (Recharts)
│   │   ├── MiniCandleChart.tsx# [UI] 个股日 K 线图组件 (Lightweight Charts)
│   │   └── StrategyView.tsx   # [UI] 策略说明书静态展示页面
│   └── page.tsx               # [入口] 服务端组件，负责页面首屏数据的 SSR 拉取
├── lib/
│   ├── config.ts              # [配置] 环境变量加载、Supabase 客户端初始化、全局策略参数
│   ├── constants.ts           # [常量] 股票代码与中文名称的映射表
│   ├── engine.ts              # [逻辑] 交易机器人核心引擎 (实时行情抓取、策略撮合、净值结算)
│   ├── market-service.ts      # [数据] K 线数据服务 (支持全量初始化与近 5 日增量同步)
│   ├── strategies.ts          # [策略] 多样化投资策略库 (包含韭菜、赌怪、诗人等 8 种角色)
│   └── type.ts                # [类型] 核心接口与数据结构定义
├── scripts/
│   ├── daemon.ts              # [进程] 高频守护进程 (5秒/次心跳，驱动机器人和增量同步)
│   └── init-data.ts           # [工具] 初始化脚本 (一次性运行，批量下载过去 260 天的历史 K 线)
├── .env.local                 # [密钥] 环境变量 (Supabase URL, Key 等)
└── package.json               # [依赖] 包含 Next.js 15+, Supabase, Recharts 等

```

---

## 🛠 模块功能详解

### 1. 前端层 (`app/`)

负责数据的展示和实时交互，通过 **Supabase Realtime** 实现无刷新更新。

* **`page.tsx`**: 服务端入口，负责首屏数据的 SSR 拉取，确保页面加载即有数据。
* **`DashboardClient.tsx`**: 前端核心控制器，建立 WebSocket 连接，监听价格跳动及交易产生的数据库变动。
* **`MiniCandleChart.tsx`**: 基于 `lightweight-charts` 渲染专业级日 K 线，支持动态追加实时数据点。

### 2. 核心逻辑层 (`lib/`)

系统的“业务逻辑”枢纽，实现复杂的交易撮合与行情计算。

* **`engine.ts`**:
* **实时行情**: 每 5 秒通过新浪 API 获取美股报价，支持抓取最新价、涨跌幅及涨跌额。
* **策略引擎**: 自动为每位投资者匹配策略，计算持仓成本，执行买入/卖出逻辑，并实时更新 `market_quotes` 表。
* **动态指标**: 支持计算最近 7 天的高低点，为“兵王”等高级策略提供情报支持。


* **`strategies.ts`**: 预设 8 种截然不同的交易人格：
* **诗人 (Poet)**: 坚决不碰加密货币，每日固定金额定投。
* **兵王 (Soldier)**: 监控周线高低位，破位抄底，新高减仓。
* **高僧 (Zen)**: 随缘买卖，入定观望。
* **韭菜 (Leek)** & **赌怪 (Gambler)**: 追涨杀跌或马丁补仓。


* **`market-service.ts`**: 负责从 Stooq/新浪 抓取 K 线。支持传入 `days` 参数进行**增量同步**，极大节省数据库 I/O 压力。

### 3. 后台脚本层 (`scripts/`)

系统的动力核心。

* **`daemon.ts`**: **极速守护进程**。
* **5秒/次心跳**: 极速触发交易引擎，实现秒级行情响应。
* **60秒/次同步**: 每隔 12 个心跳自动执行一次 K 线增量同步（仅更新最近 5 天数据），确保图表数据准确。


* **`init-data.ts`**: “开荒”专用，项目初次启动时运行，下载过去半年的历史数据以填充图表。

---

## 🚀 快速启动指南

1. **环境配置**:
在 `.env.local` 中填写 Supabase URL 和 Key。
2. **初始化历史数据** (仅需运行一次)：
```bash
npx tsx --env-file=.env.local scripts/init-data.ts

```


3. **启动高频交易机器人** (保持此终端开启)：
```bash
# 价格 5 秒更新一次，K 线 60 秒同步一次
npx tsx --env-file=.env.local scripts/daemon.ts

```


4. **启动 Web Dashboard**:
```bash
npm run dev

```



访问 `http://localhost:3000` 即可在美股开盘期间看到实时跳动的量化模拟终端。