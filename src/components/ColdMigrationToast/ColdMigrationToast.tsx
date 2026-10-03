import { Archive, Loader2 } from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';

/**
 * 冷存迁移进度提示：
 * 档案分批挪进冷存时，在左下角显示当前进度；中途停下后再次打开会接着挪。
 */
export default function ColdMigrationToast() {
  const { coldMigration } = useBenchStore();

  if (!coldMigration.active) return null;

  const { moved, total } = coldMigration;
  const percent = total > 0 ? Math.round((moved / total) * 100) : 0;

  return (
    <div className="fixed bottom-4 left-4 z-50 paper-texture rounded-xl shadow-paper-hover p-4 w-72 fade-in">
      <div className="flex items-center gap-2 mb-2">
        <Archive className="w-4 h-4 text-ochre flex-shrink-0" />
        <span className="text-sm font-medium text-deep-brown flex-1">
          正在冷存档案
        </span>
        <Loader2 className="w-4 h-4 text-ink-light animate-spin" />
      </div>
      <div className="h-2 bg-warm-beige rounded-full overflow-hidden mb-1.5">
        <div
          className="h-full bg-ochre rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-ink-light">
        已挪入冷存 {moved} / {total} 条，未挪完的会排队接着挪
      </p>
    </div>
  );
}
