import type { PublicHealthTip } from '@daktari/schemas';
import type * as ReactModule from 'react';
import { AccessibilityInfo, FlatList } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useI18nStore } from '../../i18n';
import { AUTO_ADVANCE_MS, TipsCarousel } from './TipsCarousel';

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof ReactModule;
  return { useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]) };
});
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: {} }));

function tip(i: number): PublicHealthTip {
  return {
    id: `id-${i}`,
    slug: `tip-${i}`,
    category: 'MALARIA',
    status: 'PUBLISHED',
    title: { sw: `Kichwa ${i}`, en: `Title ${i}` },
    summary: { sw: 'Muhtasari mfupi wa kidokezo', en: 'A short tip summary' },
    body: { sw: '## A\nB', en: '## A\nB' },
    takeaways: { sw: ['x'], en: ['x'] },
    illustration: 'safe-home',
    imageUrl: null,
    sources: [],
    reviewedBy: 'Dkt. Amina',
    reviewedAt: null,
    publishedAt: null,
    priority: 0,
  };
}

const TIPS = [tip(1), tip(2), tip(3)];

function counter(tree: ReactTestRenderer): string {
  const node = tree.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Kidokezo '))[0];
  return node?.props.accessibilityLabel as string;
}

async function render(reduceMotion = false): Promise<ReactTestRenderer> {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduceMotion);
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<TipsCarousel tips={TIPS} onOpen={jest.fn()} />);
    await Promise.resolve();
  });
  return tree!;
}

beforeEach(() => {
  jest.useFakeTimers();
  act(() => useI18nStore.getState().setLocale('sw'));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('TipsCarousel', () => {
  it('auto-advances every ~6 seconds and shows a small "n/count" counter', async () => {
    const tree = await render();
    expect(counter(tree)).toBe('Kidokezo 1 kati ya 3');
    act(() => jest.advanceTimersByTime(AUTO_ADVANCE_MS));
    expect(counter(tree)).toBe('Kidokezo 2 kati ya 3');
  });

  it('pauses while the user is touching it', async () => {
    const tree = await render();
    const list = tree.root.findByType(FlatList);
    act(() => list.props.onTouchStart());
    act(() => jest.advanceTimersByTime(AUTO_ADVANCE_MS * 3));
    expect(counter(tree)).toBe('Kidokezo 1 kati ya 3');
  });

  it('never auto-scrolls when the system "reduce motion" setting is on', async () => {
    const tree = await render(true);
    act(() => jest.advanceTimersByTime(AUTO_ADVANCE_MS * 3));
    expect(counter(tree)).toBe('Kidokezo 1 kati ya 3');
  });
});
