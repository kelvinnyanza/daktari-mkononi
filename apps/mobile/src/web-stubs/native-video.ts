/**
 * WEB-ONLY stand-in for @daily-co/react-native-daily-js and
 * @daily-co/react-native-webrtc (native modules with no web build), aliased
 * by metro.config.js for platform "web" only.
 *
 * Throwing at import makes loadDaily() (services/video/daily-boundary.ts) take
 * its existing "video needs the Daktari dev build" path, so the call screen
 * shows its normal video-error state in the browser. Native is unaffected.
 */
throw new Error('Video calling is not available on web');
export {};
