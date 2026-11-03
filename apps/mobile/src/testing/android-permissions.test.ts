import fs from 'node:fs';
import path from 'node:path';

/**
 * The Android permission set is a deliberate, reviewed list (phase 13b):
 * exactly what react-native-daily-js documents for camera + microphone calls
 * with its ongoing-meeting foreground service, nothing the app does not use.
 * Plugins (Daily's, react-native-webrtc's) and Expo's template add more on
 * their own — those are removed via android.blockedPermissions
 * (tools:node="remove" in the merged manifest). Changing either list needs a
 * new EAS build and a privacy-listing review, so it must be a conscious edit.
 */
const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../app.json'), 'utf8')) as {
  expo: { android: { permissions: string[]; blockedPermissions: string[] } };
};

describe('Android permissions (app.json)', () => {
  it('requests exactly the reviewed set', () => {
    expect([...app.expo.android.permissions].sort()).toEqual(
      [
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.CAMERA',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_CAMERA',
        'android.permission.FOREGROUND_SERVICE_MICROPHONE',
        'android.permission.INTERNET',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.RECORD_AUDIO',
        'android.permission.WAKE_LOCK',
      ].sort(),
    );
  });

  it('blocks what plugins / the Expo template add but the app does not use', () => {
    expect([...app.expo.android.blockedPermissions].sort()).toEqual(
      [
        'android.permission.BLUETOOTH',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ].sort(),
    );
    for (const blocked of app.expo.android.blockedPermissions) {
      expect(app.expo.android.permissions).not.toContain(blocked);
    }
  });
});
