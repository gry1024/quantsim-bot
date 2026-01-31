# QuantSim - 全自动美股量化交易模拟终端

QuantSim 是一个基于 Next.js + Supabase 的全栈量化交易模拟系统。它包含一个实时动态更新的 Dashboard 前端，以及一个后台自动运行的交易机器人（Daemon），支持美股实时行情获取、策略自动执行及 K 线数据同步。

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
│   ├── engine.ts              # [逻辑] 交易机器人核心引擎 (判断买卖信号、执行下单、计算净值)
│   └── market-service.ts      # [数据] 历史数据服务 (负责从 Stooq/腾讯 抓取 K 线并存入数据库)
├── scripts/
│   ├── daemon.ts              # [进程] 后台守护进程 (死循环心跳，驱动机器人和数据同步)
│   └── init-data.ts           # [工具] 初始化脚本 (一次性运行，批量下载过去半年的 K 线数据)
├── .env.local                 # [密钥] 环境变量 (Supabase URL, Key 等)
└── package.json

```

---

## 🛠 模块功能详解

### 1. 前端层 (`app/`)

负责数据的展示和实时交互，**只读不写**（不直接操作数据库，通过监听数据库变动更新）。

* **`page.tsx`**:
* **功能**: 服务端入口。
* **作用**: 在用户刷新页面时，一次性从数据库读取 Portfolio、Positions、Trades 和 K 线历史，传给客户端组件，保证首屏速度。


* **`components/DashboardClient.tsx`**:
* **功能**: 前端的大脑。
* **作用**: 初始化 UI，建立 Supabase Realtime WebSocket 连接。一旦数据库变动（如价格更新、新交易产生），立即更新 State，实现“秒级跳动”效果。


* **`components/MiniCandleChart.tsx`**:
* **功能**: 专业的 K 线图表。
* **作用**: 使用 `lightweight-charts` 渲染真实的日线数据。支持动态追加数据点，实现图表实时刷新。



### 2. 核心逻辑层 (`lib/`)

项目的“业务逻辑”，被脚本和前端共用。

* **`config.ts`**:
* **功能**: 项目的配置中心。
* **作用**: 处理 `SUPABASE_KEY` 的读取逻辑（区分前端 Anon Key 和后端 Service Key），定义交易参数（如 `BUY_DIP_THRESHOLD` 补仓阈值）。


* **`engine.ts`**:
* **功能**: 交易员逻辑。
* **作用**: 获取新浪实时行情 -> 对比持仓成本 -> 触发买/卖逻辑 -> 写入 `trades` 表 -> 更新 `portfolio` 净值。


* **`market-service.ts`**:
* **功能**: 数据搬运工。
* **作用**: 处理反爬虫逻辑，从外部源（Stooq/腾讯）下载历史数据，清洗格式后 Upsert 到数据库 `market_candles` 表。



### 3. 后台脚本层 (`scripts/`)

负责驱动系统运行，**只写不读**（主要负责写入数据和交易）。

* **`init-data.ts`**:
* **功能**: 开荒脚本。
* **用法**: `npx tsx --env-file=.env.local scripts/init-data.ts`
* **作用**: 项目初次启动时运行，填充过去半年的历史数据，防止 K 线图空白。


* **`daemon.ts`**:
* **功能**: 心脏起搏器。
* **用法**: `npx tsx --env-file=.env.local scripts/daemon.ts`
* **作用**: 也就是“机器人本体”。它会每隔 60 秒（可调）醒来一次，调用 `engine.ts` 进行交易判断，并顺便同步最新的 K 线数据。



---

## 🚀 快速启动指南

1. **初始化历史数据** (仅需运行一次)：
```bash
npx tsx --env-file=.env.local scripts/init-data.ts

```


2. **启动交易机器人** (保持终端开启)：
```bash
npx tsx --env-file=.env.local scripts/daemon.ts

```


3. **启动前端页面** (新建一个终端)：
```bash
npm run dev

```


访问 `http://localhost:3000` 即可看到实时跳动的量化终端。