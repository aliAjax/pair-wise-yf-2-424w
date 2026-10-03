import { useEffect } from 'react';
import { Armchair, Snowflake, Layers, Clock3 } from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import { ACTIVE_CAPACITY } from '@/utils/tier';
import FilterBar from '@/components/FilterBar/FilterBar';
import BenchCard from '@/components/BenchCard/BenchCard';

export default function ListPage() {
  const { benches, tier, getFilteredBenches, initialize, initialized, searchQuery } = useBenchStore();
  const filteredBenches = getFilteredBenches();

  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  const activeCount = benches.length - tier.coldIds.length;
  const coldCount = tier.coldIds.length;
  const pendingCount = tier.pendingIds.length;
  const searching = searchQuery.trim().length > 0;
  const coldInResults = filteredBenches.filter((bench) =>
    tier.coldIds.includes(bench.id),
  ).length;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-deep-brown mb-1">
            长椅档案
          </h2>
          <p className="text-ink-light text-sm">
            记录城市中那些被忽略的休憩角落
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-moss-green/10 text-moss-green">
            <Layers className="w-3.5 h-3.5" />
            在库 {activeCount}/{ACTIVE_CAPACITY}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-ink-light/10 text-ink-light">
            <Snowflake className="w-3.5 h-3.5" />
            冷存 {coldCount}
          </span>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ochre/10 text-ochre text-sm">
          <Clock3 className="w-4 h-4 flex-shrink-0" />
          <span>
            在库已满，{pendingCount} 条档案排队等待分批挪入冷存，下次打开时继续
          </span>
        </div>
      )}

      <FilterBar />

      {searching && coldInResults > 0 && (
        <p className="text-xs text-ink-light mb-4">
          搜索结果包含 {coldInResults} 条冷存档案，打开或修改评分即可调回在库
        </p>
      )}

      {filteredBenches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredBenches.map((bench, index) => (
            <BenchCard key={bench.id} bench={bench} index={index} />
          ))}
        </div>
      ) : (
        <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-moss-green/10 flex items-center justify-center mx-auto mb-4">
            <Armchair className="w-8 h-8 text-moss-green/50" />
          </div>
          <h3 className="font-serif text-lg font-medium text-deep-brown mb-2">
            {benches.length === 0
              ? '还没有长椅档案'
              : searching
                ? '没有找到匹配的长椅'
                : '在库中暂无档案'}
          </h3>
          <p className="text-ink-light text-sm">
            {benches.length === 0
              ? '点击右上角的添加按钮，记录第一张长椅档案吧'
              : searching
                ? '试试调整筛选条件或搜索关键词'
                : '档案都在冷存里，用上方搜索可以找到它们'}
          </p>
        </div>
      )}
    </div>
  );
}
