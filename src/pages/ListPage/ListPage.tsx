import { useEffect } from 'react';
import { useBenchStore } from '@/store/useBenchStore';
import FilterBar from '@/components/FilterBar/FilterBar';
import BenchCard from '@/components/BenchCard/BenchCard';
import { Armchair, Archive } from 'lucide-react';

export default function ListPage() {
  const { benches, getFilteredBenches, initialize, initialized } = useBenchStore();
  const filteredBenches = getFilteredBenches();
  const hotBenches = filteredBenches.filter((bench) => bench.storageTier !== 'cold');
  const coldBenches = filteredBenches.filter((bench) => bench.storageTier === 'cold');
  const totalHot = benches.filter((bench) => bench.storageTier !== 'cold').length;

  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h2 className="font-serif text-2xl font-semibold text-deep-brown mb-1">
          长椅档案
        </h2>
        <p className="text-ink-light text-sm">
          记录城市中那些被忽略的休憩角落
        </p>
      </div>

      <FilterBar />

      {filteredBenches.length > 0 ? (
        <>
          {hotBenches.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {hotBenches.map((bench, index) => (
                <BenchCard key={bench.id} bench={bench} index={index} />
              ))}
            </div>
          )}

          {coldBenches.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-4">
                <Archive className="w-4 h-4 text-ochre" />
                <h3 className="font-serif text-lg font-semibold text-deep-brown">
                  冷存档案
                </h3>
                <span className="text-xs text-ink-light">
                  （搜索命中 {coldBenches.length} 条，打开后自动回到在库）
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {coldBenches.map((bench, index) => (
                  <BenchCard key={bench.id} bench={bench} index={index} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-moss-green/10 flex items-center justify-center mx-auto mb-4">
            <Armchair className="w-8 h-8 text-moss-green/50" />
          </div>
          <h3 className="font-serif text-lg font-medium text-deep-brown mb-2">
            {totalHot === 0 ? '还没有长椅档案' : '没有找到匹配的长椅'}
          </h3>
          <p className="text-ink-light text-sm">
            {totalHot === 0
              ? '点击右上角的添加按钮，记录第一张长椅档案吧'
              : '试试调整筛选条件或搜索关键词（冷存档案也可以被搜到）'}
          </p>
        </div>
      )}
    </div>
  );
}
