'use client';

import { Shield, Zap, TrendingUp, Anchor, Activity } from 'lucide-react';

export default function StrategyView() {
  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      
      {/* 头部介绍 */}
      <div className="text-center space-y-3 mb-12">
        <h2 className="text-3xl font-bold text-slate-900">核心交易策略 (V2.0)</h2>
        <p className="text-slate-500 max-w-2xl mx-auto">
          基于均值回归与动态网格的自动化交易系统。策略通过大额底仓建立市场敞口，
          利用小额网格捕捉下跌波动降低成本，并通过移动止盈机制锁定利润。
        </p>
      </div>

      {/* 4个核心卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* 卡片 1 */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 mb-4">
            <Anchor size={24} />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">1. 初始重仓构建 (Initial Entry)</h3>
          <p className="text-slate-500 text-sm leading-relaxed mb-4">
            当监控到目标标的无持仓时，系统会直接执行大额买入，建立基础底仓。
          </p>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono text-xs text-slate-600">
            <span className="text-blue-600">IF</span> Position == 0 <br/>
            <span className="text-blue-600">THEN</span> BUY <span className="text-orange-600">$100,000</span> (Market Price)
          </div>
        </div>

        {/* 卡片 2 */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center text-green-600 mb-4">
            <TrendingUp size={24} />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">2. 下跌网格补仓 (Buy the Dip)</h3>
          <p className="text-slate-500 text-sm leading-relaxed mb-4">
            当价格较“上一次成交价”下跌超过阈值时，执行小额买入，摊低持仓成本。
          </p>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono text-xs text-slate-600">
            <span className="text-blue-600">IF</span> Price &lt; LastPrice * <span className="text-purple-600">0.98</span> (-2.0%)<br/>
            <span className="text-blue-600">THEN</span> BUY <span className="text-orange-600">$10,000</span> (Averaging Down)
          </div>
        </div>

        {/* 卡片 3 */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center text-orange-600 mb-4">
            <Zap size={24} />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">3. 动态止盈落袋 (Take Profit)</h3>
          <p className="text-slate-500 text-sm leading-relaxed mb-4">
            当价格较“上一次成交价”上涨超过阈值时，卖出部分持仓锁定利润，释放现金。
          </p>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono text-xs text-slate-600">
            <span className="text-blue-600">IF</span> Price &gt; LastPrice * <span className="text-purple-600">1.02</span> (+2.0%)<br/>
            <span className="text-blue-600">THEN</span> SELL <span className="text-orange-600">20%</span> Position
          </div>
        </div>

        {/* 卡片 4 */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-600 mb-4">
            <Shield size={24} />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">4. 极速熔断机制 (Circuit Breaker)</h3>
          <p className="text-slate-500 text-sm leading-relaxed mb-4">
            全天候监控账户总回撤。一旦总净值回撤超过安全线，立即触发硬熔断，停止买入。
          </p>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono text-xs text-slate-600">
            <span className="text-blue-600">IF</span> Drawdown &gt; <span className="text-red-600">10.0%</span><br/>
            <span className="text-blue-600">THEN</span> HALT_TRADING = <span className="text-red-600">TRUE</span>
          </div>
        </div>

      </div>

      {/* 底部备注 */}
      <div className="bg-slate-100 rounded-xl p-4 flex items-start gap-3">
        <Activity className="text-slate-400 mt-0.5 shrink-0" size={18} />
        <div className="text-xs text-slate-500">
          <span className="font-bold text-slate-700">运行机制说明：</span> 
          机器人采用 5秒/次 的高频扫描机制。所有交易基于实时成交价 (Last Tick Price)。
          K线数据仅用于图表展示，不参与交易决策。资金结算采用 Mark-to-Market (逐日盯市) 制度。
        </div>
      </div>
    </div>
  );
}