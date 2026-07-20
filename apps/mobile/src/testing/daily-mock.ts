/**
 * Jest never loads the Daily native module — this stands in for both
 * @daily-co/react-native-daily-js and @daily-co/react-native-webrtc via the
 * package.json moduleNameMapper. Belt-and-suspenders on top of the runtime
 * lazy boundary (src/services/video/daily-boundary.ts), so a stray static
 * import can't drag native code into the test runner.
 */
export default {
  createCallObject: (): never => {
    throw new Error('Daily is not available under test — mock the video boundary instead');
  },
};

export const createCallObject = (): never => {
  throw new Error('Daily is not available under test — mock the video boundary instead');
};
