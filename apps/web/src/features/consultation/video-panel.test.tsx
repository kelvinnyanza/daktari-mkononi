import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { get: (path: string) => get(path) as unknown },
}));

/** Fake Daily frame: join() stays pending until the test resolves it — like
 * Prebuilt's pre-join screen waiting for the user's click inside the iframe. */
interface FakeFrame {
  join: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setLocalVideo: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
  resolveJoin: () => void;
}
const frames: FakeFrame[] = [];
vi.mock('@daily-co/daily-js', () => ({
  default: {
    createFrame: () => {
      let resolveJoin: () => void = () => undefined;
      const frame: FakeFrame = {
        join: vi.fn(() => new Promise<void>((resolve) => { resolveJoin = resolve; })),
        on: vi.fn(),
        setLocalVideo: vi.fn(),
        destroy: vi.fn(async () => undefined),
        enumerateDevices: vi.fn(async () => ({ devices: [] })),
        resolveJoin: () => resolveJoin(),
      };
      frames.push(frame);
      return frame;
    },
  },
}));

import { VideoPanel } from './video-panel';

const container = () => screen.getByTestId('video-frame-container');

describe('VideoPanel', () => {
  beforeEach(() => {
    frames.length = 0;
    get.mockResolvedValue({ meetingToken: 'tok', roomUrl: 'https://x.daily.co/room' });
  });

  it('shows the Daily frame WHILE joining, so the pre-join screen can be clicked', async () => {
    render(<VideoPanel consultationId="c1" />);
    expect(container().className).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: /join video|jiunge na video/i }));
    await waitFor(() => expect(frames).toHaveLength(1));

    // join() is still pending (pre-join screen) — the frame must be visible.
    expect(container().classList.contains('hidden')).toBe(false);
    expect(screen.getByText(/press Join inside the video window|bonyeza Join ndani/i)).toBeTruthy();

    await act(async () => frames[0]!.resolveJoin());
    expect(container().classList.contains('hidden')).toBe(false);
    expect(screen.queryByText(/press Join inside the video window|bonyeza Join ndani/i)).toBeNull();
    expect(screen.getByRole('button', { name: /leave video|ondoka kwenye video/i })).toBeTruthy();
  });

  it('Leave on the pre-join screen releases the camera and the abandoned join cannot flip to joined', async () => {
    render(<VideoPanel consultationId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: /join video|jiunge na video/i }));
    await waitFor(() => expect(frames).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /leave video|ondoka kwenye video/i }));
    await waitFor(() => expect(frames[0]!.destroy).toHaveBeenCalledTimes(1));
    expect(container().className).toBe('hidden');

    await act(async () => frames[0]!.resolveJoin()); // late resolution of the abandoned join
    expect(container().className).toBe('hidden');
    expect(screen.getByRole('button', { name: /join video|jiunge na video/i })).toBeTruthy();
  });
});
