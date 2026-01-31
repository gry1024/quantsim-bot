'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/config'; 
import { STOCK_NAMES } from '../../lib/constants';
import { 
  TrendingUp, TrendingDown, Activity, Wallet, 
  Clock, RefreshCcw, Layers, BarChart3, PieChart,
  LayoutDashboard, BookOpen
} from 'lucide-react';
import { formatDistanceToNow, isSameDay, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import EquityChart from './EquityChart';
import MiniCandleChart from './MiniCandleChart';
import AssetDonut from './AssetDonut';
import StrategyView from './StrategyView';
import { Time } from 'lightweight-charts';

interface DashboardClientProps {
  portfolio: any;
  positions: any[];
  trades: any[];
  chartData: { time: string; value: number }[]; // 明确类型
  historyMap: Record<string, any[]>;
}

export default function DashboardClient({ 
  portfolio: initialPortfolio, 
  positions: initialPositions, 
  trades: initialTrades, 
  chartData: initialChartData,
  historyMap: initialHistoryMap 
}: DashboardClientProps) {
  
  const [activeView, setActiveView] = useState<'monitor' | 'strategy'>('monitor');
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const [positions, setPositions] = useState(initialPositions);
  const [trades, setTrades] = useState(initialTrades); 
  const [historyMap, setHistoryMap] = useState(initialHistoryMap);
  const [isLive, setIsLive] = useState(false);

  // 基础资产计算
  const initialCapital = portfolio?.initial_capital || 1000000;
  const currentEquity = portfolio?.total_equity || initialCapital;
  const cashBalance = portfolio?.cash_balance || 0;
  const pnl = currentEquity - initialCapital;
  const pnlPercent = (pnl / initialCapital) * 100;
  const isProfit = pnl >= 0;

  useEffect(() => {
    const channel = supabase.channel('realtime-dashboard');
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'portfolio' }, (payload) => setPortfolio(payload.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'positions' }, (payload) => {
          setPositions((prev) => {
             const exists = prev.find(p => p.id === payload.new.id);
             if (exists) return prev.map(p => p.id === payload.new.id ? payload.new : p);
             return [...prev, payload.new];
          });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades' }, (payload) => {
          setTrades((prev) => [payload.new, ...prev]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_candles' }, (payload) => {
          const newCandle = payload.new as any;
          if (!newCandle || !newCandle.symbol) return;
          setHistoryMap((prevMap) => {
            const symbol = newCandle.symbol;
            const oldList = prevMap[symbol] || [];
            const newList = [...oldList];
            const lastIndex = newList.length - 1;
            const chartCandle = { time: newCandle.date, open: newCandle.open, high: newCandle.high, low: newCandle.low, close: newCandle.close };
            if (newList[lastIndex] && newList[lastIndex].time === newCandle.date) {
              newList[lastIndex] = chartCandle;
            } else {
              newList.push(chartCandle);
            }
            return { ...prevMap, [symbol]: newList };
          });
        }
      )
      .subscribe((status) => { if (status === 'SUBSCRIBED') setIsLive(true); });
    return () => { supabase.removeChannel(channel); };
  }, []);

  // =======================================================
  // 💡 关键修复：动态生成包含“今日实时净值”的图表数据
  // =======================================================
  const finalChartData = [...(initialChartData || [])];
  const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  if (finalChartData.length > 0) {
    const lastPoint = finalChartData[finalChartData.length - 1];
    // 如果历史数据的最后一个点不是今天，就把今天的实时数据追加上去
    if (lastPoint.time !== todayStr) {
      finalChartData.push({ time: todayStr, value: currentEquity });
    } else {
      // 如果已经是今天（可能是刚刷新的快照），强制用实时数据更新它，保证“跳动”
      finalChartData[finalChartData.length - 1].value = currentEquity;
    }
  } else {
    // 如果没有历史数据，至少显示当前点
    finalChartData.push({ time: todayStr, value: currentEquity });
  }
  // =======================================================

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-slate-800 overflow-hidden">
      
      {/* 侧边栏 */}
      <aside className="w-72 bg-white border-r border-slate-200 flex-col shadow-sm z-20 hidden md:flex h-full">
        <div className="p-6 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white">
              <Activity size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">QuantSim</h1>
              <p className="text-xs text-slate-400 font-medium">全自动量化终端</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 space-y-1 border-b border-slate-100 shrink-0">
          <button onClick={() => setActiveView('monitor')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeView === 'monitor' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>
            <LayoutDashboard size={18} /> 控制台
          </button>
          <button onClick={() => setActiveView('strategy')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeView === 'strategy' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>
            <BookOpen size={18} /> 策略说明
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-1">
              <Wallet size={14} /> 账户总净值 (USD)
            </div>
            <div className="text-3xl font-light tracking-tight text-slate-900">
              ${currentEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`mt-2 flex items-center gap-1 text-sm font-medium ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
              {isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              <span>{Math.abs(pnl).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} ({Math.abs(pnlPercent).toFixed(2)}%)</span>
            </div>
          </div>
          <hr className="border-slate-100" />
          <div className="min-h-[200px] pb-6">
            <div className="text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-1"><PieChart size={14} /> 仓位分布</div>
            <AssetDonut positions={positions || []} cash={cashBalance} total={currentEquity} />
          </div>
        </div>
      </aside>

      {/* 主界面 */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F8FAFC] relative">
        <header className="px-4 md:px-8 py-4 md:py-5 bg-white border-b border-slate-200 flex justify-between items-center z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="md:hidden w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white">
              <Activity size={18} />
            </div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span className="hidden md:flex items-center gap-2">
                {activeView === 'monitor' ? <Layers size={18} className="text-slate-500" /> : <BookOpen size={18} className="text-blue-500" />}
                {activeView === 'monitor' ? '控制仪表盘' : '策略白皮书'}
              </span>
              <span className="md:hidden">QuantSim</span>
            </h2>
          </div>
          
          <div className="flex gap-2 md:gap-4 items-center">
            <div className="flex items-center gap-1.5 px-2 md:px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
                <span className="text-[9px] md:text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    {isLive ? 'LIVE' : 'WAIT'}
                </span>
            </div>
            <button onClick={() => window.location.reload()} className="p-2 md:px-3 md:py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition flex items-center gap-2 shadow-sm">
              <RefreshCcw size={14} /> <span className="hidden md:inline">刷新</span>
            </button>
          </div>
        </header>

        {/* 手机端总资产 */}
        <div className="md:hidden bg-white border-b border-slate-100 px-4 py-3 shrink-0">
           <div className="flex justify-between items-end">
             <div>
               <div className="text-[10px] font-semibold text-slate-400 uppercase flex items-center gap-1">总净值 (USD)</div>
               <div className="text-2xl font-light tracking-tight text-slate-900 leading-none mt-1">
                 ${currentEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
               </div>
             </div>
             <div className={`text-sm font-medium ${isProfit ? 'text-red-500' : 'text-green-500'} flex items-center gap-1 mb-0.5`}>
                {isProfit ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {Math.abs(pnlPercent).toFixed(2)}%
             </div>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth pb-24 md:pb-8">
          {activeView === 'strategy' ? (
            <StrategyView />
          ) : (
            <>
              {/* 💡 这里的 ChartData 换成了拼接好的 finalChartData */}
              <section className="mb-6 md:mb-8 hidden md:block"><EquityChart data={finalChartData} /></section>
              
              <section className="mb-8">
                <div className="flex items-center justify-between mb-4 px-1">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm md:text-base">
                    <BarChart3 size={18} /> 持仓监控
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                  {positions?.map((pos) => {
                    const currentPrice = pos.last_action_price || 0;
                    const avgCost = pos.average_cost || 0;
                    const quantity = pos.quantity || 0;
                    
                    const investedPrincipal = avgCost * quantity;
                    const marketValue = currentPrice * quantity;
                    const totalReturn = marketValue - investedPrincipal;
                    const totalReturnPercent = avgCost > 0 ? (totalReturn / investedPrincipal) * 100 : 0;
                    
                    const realHistory = historyMap[pos.symbol] || [];
                    const todayStr = new Date().toISOString().split('T')[0];
                    
                    let prevClose = 0;
                    if (realHistory.length > 0) {
                        const lastCandle = realHistory[realHistory.length - 1];
                        if (lastCandle.time === todayStr && realHistory.length > 1) {
                            prevClose = realHistory[realHistory.length - 2].close;
                        } else if (lastCandle.time !== todayStr) {
                            prevClose = lastCandle.close;
                        } else {
                            prevClose = avgCost;
                        }
                    } else {
                        prevClose = avgCost;
                    }

                    const updateTime = pos.updated_at ? parseISO(pos.updated_at) : new Date();
                    const isNewPosition = isSameDay(updateTime, new Date());
                    
                    const referencePrice = isNewPosition ? avgCost : prevClose;
                    
                    const dayReturn = (currentPrice - referencePrice) * quantity;
                    const finalDayReturn = Math.abs(currentPrice - referencePrice) < 0.001 ? 0 : dayReturn;
                    const dayReturnPercent = referencePrice > 0 ? ((currentPrice - referencePrice) / referencePrice) * 100 : 0;

                    const cnName = STOCK_NAMES[pos.symbol] || pos.symbol;

                    return (
                      <div key={pos.symbol} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 md:p-5 border-b border-slate-50">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-lg md:text-xl font-bold text-slate-900">{pos.symbol}</h4>
                                <span className="text-xs text-slate-500 font-medium px-1.5 py-0.5 bg-slate-100 rounded">{cnName}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div key={currentPrice} className="text-xl md:text-2xl font-bold text-slate-800 transition-colors duration-300 font-mono">
                                ${Number(currentPrice).toFixed(2)}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 py-2 bg-slate-50/50 rounded-lg px-2">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-slate-400 mb-0.5">本金</span>
                                <span className="text-xs md:text-sm font-semibold text-slate-700">
                                    ${Math.round(investedPrincipal).toLocaleString()}
                                </span>
                            </div>
                            <div className="flex flex-col text-center border-l border-r border-slate-200/60">
                                <span className="text-[10px] text-slate-400 mb-0.5">当日盈亏</span>
                                <div className={`text-xs md:text-sm font-semibold ${finalDayReturn >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                    {finalDayReturn >= 0 ? '+' : ''}{Math.round(finalDayReturn)}
                                    <span className="text-[9px] ml-0.5 opacity-70">({dayReturnPercent.toFixed(1)}%)</span>
                                </div>
                            </div>
                            <div className="flex flex-col text-right">
                                <span className="text-[10px] text-slate-400 mb-0.5">总收益</span>
                                <div className={`text-xs md:text-sm font-semibold ${totalReturn >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                    {totalReturn >= 0 ? '+' : ''}{Math.round(totalReturn).toLocaleString()}
                                    <span className="text-[9px] ml-0.5 opacity-70">({totalReturnPercent.toFixed(1)}%)</span>
                                </div>
                            </div>
                          </div>
                        </div>
                        <div className="h-40 md:h-48 w-full relative bg-white pt-2">
                           {realHistory.length > 0 ? <MiniCandleChart data={realHistory} /> : <div className="flex items-center justify-center h-full text-slate-400 text-xs">加载中...</div>}
                        </div>
                      </div>
                    );
                  })}
                  {(!positions || positions.length === 0) && (
                    <div className="col-span-full py-8 md:py-12 text-center bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 text-sm">暂无持仓</div>
                  )}
                </div>
              </section>

              <section>
                 <div className="flex items-center justify-between mb-4 px-1"><h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm md:text-base"><Clock size={18} /> 交易日志</h3></div>
                 <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="hidden md:grid grid-cols-6 px-6 py-3 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-500">
                    <div className="col-span-1">时间</div>
                    <div className="col-span-1">标的</div>
                    <div className="col-span-1">操作</div>
                    <div className="col-span-1 text-right">成交价</div>
                    <div className="col-span-1 text-right">成交金额</div>
                    <div className="col-span-1 text-right">策略</div>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {trades?.map((trade) => {
                      const tradeAmount = trade.price * trade.quantity;
                      return (
                        <div key={trade.id} className="grid grid-cols-2 md:grid-cols-6 px-4 md:px-6 py-3 md:py-3.5 items-center hover:bg-slate-50/80 transition-colors text-sm">
                          <div className="md:hidden col-span-2 flex justify-between items-center mb-1">
                              <span className="font-bold text-slate-800">{trade.symbol}</span>
                              <span className="text-xs text-slate-400">{formatDistanceToNow(new Date(trade.created_at), { addSuffix: true, locale: zhCN })}</span>
                          </div>
                          <div className="md:hidden col-span-2 flex justify-between items-center text-xs">
                               <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${trade.action === 'BUY' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}>{trade.action === 'BUY' ? '买入' : '卖出'}</span>
                                  <span className="font-mono">${Number(trade.price).toFixed(2)}</span>
                                  <span className="text-slate-300">|</span>
                                  <span className="font-semibold text-slate-700">总额 ${Math.round(tradeAmount).toLocaleString()}</span>
                                </div>
                          </div>
                          <div className="hidden md:block col-span-1 text-slate-400 text-xs">{formatDistanceToNow(new Date(trade.created_at), { addSuffix: true, locale: zhCN })}</div>
                          <div className="hidden md:block col-span-1 font-bold text-slate-800">{trade.symbol}</div>
                          <div className="hidden md:block col-span-1"><span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${trade.action === 'BUY' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}>{trade.action === 'BUY' ? '买入' : '卖出'}</span></div>
                          <div className="hidden md:block col-span-1 text-right font-medium text-slate-700 font-mono">${Number(trade.price).toFixed(2)}</div>
                          <div className="hidden md:block col-span-1 text-right font-bold text-slate-800">${Math.round(tradeAmount).toLocaleString()}</div>
                          <div className="hidden md:block col-span-1 text-right text-xs text-slate-400 truncate pl-4">{trade.reason?.replace('Dip Buy', '逢低补仓').replace('Take Profit', '止盈卖出')}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-2 flex justify-between items-center z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-safe">
          <button onClick={() => setActiveView('monitor')} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition ${activeView === 'monitor' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
            <LayoutDashboard size={20} className={activeView === 'monitor' ? 'fill-slate-900/10' : ''} />
            <span className="text-[10px] font-medium">控制台</span>
          </button>
          <div className="w-px h-8 bg-slate-100"></div>
          <button onClick={() => setActiveView('strategy')} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition ${activeView === 'strategy' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <BookOpen size={20} className={activeView === 'strategy' ? 'fill-blue-600/10' : ''} />
            <span className="text-[10px] font-medium">策略说明</span>
          </button>
        </div>
      </main>
    </div>
  );
}