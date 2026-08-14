import type { ReactNode } from 'react';
import { CardSkeleton, Skeleton } from './primitives';

export function FeedSkeleton({ rows = 6 }: { rows?: number }): ReactNode {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
