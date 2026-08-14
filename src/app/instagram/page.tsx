import type { ReactNode } from 'react';
import { RadarPage } from '@/components/RadarPage';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  return <RadarPage platform="INSTAGRAM" searchParams={params} limit={25} />;
}
