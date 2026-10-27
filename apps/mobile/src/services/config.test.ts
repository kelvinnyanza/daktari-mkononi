import { en, sw } from '../i18n/translations';
import { resolveApiConfig } from './config';
import type * as ConfigModule from './config';

describe('resolveApiConfig (EXPO_PUBLIC_API_URL — no localhost fallback)', () => {
  it('is MISSING when the variable is unset or blank', () => {
    expect(resolveApiConfig(undefined)).toEqual({ ok: false, reason: 'MISSING', raw: undefined });
    expect(resolveApiConfig('')).toMatchObject({ ok: false, reason: 'MISSING' });
    expect(resolveApiConfig('   ')).toMatchObject({ ok: false, reason: 'MISSING' });
  });

  it('is INVALID for something that is not an http(s) URL', () => {
    expect(resolveApiConfig('192.168.1.20:4000')).toMatchObject({ ok: false, reason: 'INVALID' });
    expect(resolveApiConfig('not a url')).toMatchObject({ ok: false, reason: 'INVALID' });
    expect(resolveApiConfig('ftp://192.168.1.20')).toMatchObject({ ok: false, reason: 'INVALID' });
  });

  it('accepts a LAN or https URL and strips trailing slashes', () => {
    expect(resolveApiConfig('http://192.168.1.20:4000')).toEqual({
      ok: true,
      baseUrl: 'http://192.168.1.20:4000',
    });
    expect(resolveApiConfig(' https://api.daktari.example/ ')).toEqual({
      ok: true,
      baseUrl: 'https://api.daktari.example',
    });
  });

  it('module export is misconfigured (empty base URL) when the env var is absent', () => {
    const saved = process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./config') as typeof ConfigModule;
        expect(mod.API_CONFIG).toMatchObject({ ok: false, reason: 'MISSING' });
        expect(mod.API_BASE_URL).toBe('');
      });
    } finally {
      if (saved !== undefined) process.env.EXPO_PUBLIC_API_URL = saved;
    }
  });

  it('the misconfiguration screen copy exists in Swahili and English, with 112/115', () => {
    expect(sw['config.misconfigured.title']).toBe('Programu haijasanidiwa ipasavyo');
    expect(en['config.misconfigured.title']).toBe('The app is misconfigured');
    for (const table of [sw, en]) {
      expect(table['config.misconfigured.body']).toContain('EXPO_PUBLIC_API_URL');
      expect(table['config.misconfigured.emergency']).toContain('112');
      expect(table['config.misconfigured.emergency']).toContain('115');
    }
  });
});
