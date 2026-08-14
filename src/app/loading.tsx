import type { ReactNode } from 'react';
import { FeedSkeleton } from '@/components/FeedSkeleton';

export default function Loading(): ReactNode {
  return <FeedSkeleton rows={5} />;
}
