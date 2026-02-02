'use client';

import { useState } from 'react';
import { INVESTORS } from '@/lib/config';
import { TrendingUp, TrendingDown, Trophy, ArrowRight, BookOpen, X } from 'lucide-react';

const STRATEGY_DESCRIPTIONS: Record<string, string> = {
    leek: "每支标的买入 $100,000 作为底仓。单日涨幅超过 2%,追高买入 $50,000;单日跌幅超过 5%全部清仓。",
    gambler: "每支标的买入 $100,000 底仓。如果价格较上次买入价下跌超过 3%,则倍量补仓;上涨超 3%,卖出30%仓位。",
    mom: "每支标的买入 $200,000 满仓。如果价格上涨超过 10%,卖出 20% 仓位取现;永不买入。",
    dog: "每支标的买入 $50,000 底仓。涨 5% 卖一半;跌 2% 买入 $10,000。资产低过 $500k 全部清仓。",
    xiaoqing: "每支标的买入 $100,000 底仓。如果价格较上次成交价下跌超过 3%,加仓 $50,000。永不卖出。",
    soldier: "每支标的买入 $100,000 底仓。跌破周低买入50%;突破周高卖出10%。",
    zen: "每支标的买入 $100,000 底仓。每天对每支标的以持仓金额的10%随机买入或卖出。",
    poet: "每支标的（除 COIN 外）每日固定加仓 $2,000。坚决不碰加密资产。"
};

interface Props {
  portfolios: any[];
  currentInvestorId: string;
  onSelect: (id: string) => void;
}

export default function LeaderboardView({ portfolios = [], currentInvestorId, onSelect }: Props) {
  const [viewingStrategyId, setViewingStrategyId] = useState<string | null>(null);

  const safeList = Array.isArray(portfolios) ? portfolios : [];
  const sortedList = [...safeList].sort((a, b) => (b.total_equity || 0) - (a.total_equity || 0));

  return (
    <div className="max-w-5xl mx-auto pb-12 relative">
      <div className="text-center space-y-2 mb-6 md:mb-10 px-4">
        <h2 className="text-xl md:text-3xl font-bold text-slate-900 flex items-center justify-center gap-2">
          <Trophy className="text-yellow-500" size={24} />
          实盘资产排行榜
        </h2>
        <p className="text-xs md:text-sm text-slate-500">
          实时监控所有量化策略的表现。
        </p>
      </div>

      <div className="bg-white rounded-xl md:rounded-2xl border border-slate-200 shadow-sm overflow-hidden mx-1 md:mx-0">
        {/* 表头 - 仅桌面端可见 */}
        <div className="hidden md:grid grid-cols-12 px-6 py-4 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-1">排名</div>
          <div className="col-span-3">投资者</div>
          <div className="col-span-3 text-right">总资产 (USD)</div>
          <div className="col-span-2 text-right">收益率</div>
          <div className="col-span-3 text-center">操作</div>
        </div>

        <div className="divide-y divide-slate-50">
          {sortedList.map((item, index) => {
            const config = INVESTORS.find(i => i.id === item.investor_id);
            const name = config?.name || item.investor_id;
            const initial = item.initial_capital || 1000000;
            const current = item.total_equity || initial;
            const pnl = current - initial;
            const pnlPercent = initial > 0 ? (pnl / initial) * 100 : 0;
            const isProfit = pnl >= 0;
            const isCurrent = currentInvestorId === item.investor_id;

            return (
              <div 
                key={item.investor_id} 
                className={`flex flex-col md:grid md:grid-cols-12 px-4 md:px-6 py-4 items-center transition-colors gap-3 md:gap-0 ${isCurrent ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}
              >
                {/* 手机端第一行：排名 + 名字 + 收益率 */}
                <div className="w-full md:col-span-4 flex items-center justify-between md:justify-start gap-3">
                  <div className="flex items-center gap-3">
                    <div className="font-mono font-bold text-base md:text-lg text-slate-400 w-6">
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm text-sm md:text-base ${index === 0 ? 'bg-yellow-500' : 'bg-slate-900'}`}>
                            {(name || '?').charAt(0)}
                        </div>
                        <div>
                            <div className="font-bold text-slate-900 text-sm md:text-base">{name}</div>
                            <div className="hidden md:block text-[10px] text-slate-400 font-mono">ID: {item.investor_id}</div>
                        </div>
                    </div>
                  </div>
                  
                  {/* 手机端显示的收益率 */}
                  <div className={`md:hidden font-bold text-xs flex items-center gap-1 ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                    {isProfit ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {pnlPercent > 0 ? '+' : ''}{pnlPercent.toFixed(1)}%
                  </div>
                </div>

                {/* 总资产 - 手机端右对齐显示 */}
                <div className="w-full md:col-span-3 flex md:block justify-between items-center border-t md:border-0 pt-2 md:pt-0 border-slate-50">
                   <span className="md:hidden text-[10px] text-slate-400 uppercase font-bold">总资产</span>
                   <div className="text-right font-mono font-bold text-slate-800 text-base md:text-lg">
                     ${Math.round(current).toLocaleString()}
                   </div>
                </div>

                {/* 收益率 - 仅桌面可见 */}
                <div className={`hidden md:flex col-span-2 text-right font-bold items-center justify-end gap-1 ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                   {isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                   {pnlPercent > 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                </div>

                {/* 操作按钮 - 手机端宽度占满 */}
                <div className="w-full md:col-span-3 flex justify-end gap-2">
                   <button 
                     onClick={(e) => {
                       e.stopPropagation();
                       setViewingStrategyId(item.investor_id);
                     }}
                     className="flex-1 md:flex-none px-3 py-2 md:py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition flex items-center justify-center gap-1"
                   >
                     <BookOpen size={14} /> <span className="md:inline">策略</span>
                   </button>
                   <button 
                     onClick={() => onSelect(item.investor_id)}
                     className="flex-1 md:flex-none px-3 py-2 md:py-1.5 rounded-lg text-xs font-medium text-white bg-slate-900 hover:bg-blue-600 transition flex items-center justify-center gap-1 shadow-sm"
                   >
                     视角 <ArrowRight size={14} />
                   </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 弹窗部分保持一致，仅缩小标题 */}
      {viewingStrategyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 relative border border-slate-100">
            <button onClick={() => setViewingStrategyId(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"><X size={20} /></button>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {INVESTORS.find(i => i.id === viewingStrategyId)?.name} 逻辑
              </h3>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-700 text-xs md:text-sm leading-relaxed font-medium">
              {STRATEGY_DESCRIPTIONS[viewingStrategyId] || "暂无说明"}
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={() => setViewingStrategyId(null)} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}