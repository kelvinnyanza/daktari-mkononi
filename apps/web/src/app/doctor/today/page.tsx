'use client';

import { TodayView } from './today-view';

/**
 * Next allows a page's default export only params/searchParams props, so the
 * test clock (`now`) lives on TodayView, not here — a custom prop on the
 * page itself fails `next build` type-checking.
 */
export default function DoctorTodayPage() {
  return <TodayView />;
}
