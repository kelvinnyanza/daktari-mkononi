/**
 * WEB-ONLY stand-in for expo-secure-store (which has no web implementation),
 * aliased by metro.config.js for platform "web" only — native builds keep the
 * real Keystore/Keychain module.
 *
 * Memory only, on purpose: tokens never touch localStorage/sessionStorage
 * (XSS could read them). A page reload therefore signs you out. The web
 * target exists to preview layouts in a browser, not as a product surface.
 */
type Options = Record<string, unknown>;

const memory = new Map<string, string>();

export const AFTER_FIRST_UNLOCK = 0;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;
export const ALWAYS = 2;
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 3;
export const ALWAYS_THIS_DEVICE_ONLY = 4;
export const WHEN_UNLOCKED = 5;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;

export type SecureStoreOptions = Options;

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}
export async function getItemAsync(key: string, _options?: Options): Promise<string | null> {
  return memory.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string, _options?: Options): Promise<void> {
  memory.set(key, value);
}
export async function deleteItemAsync(key: string, _options?: Options): Promise<void> {
  memory.delete(key);
}
export function getItem(key: string): string | null {
  return memory.get(key) ?? null;
}
export function setItem(key: string, value: string): void {
  memory.set(key, value);
}
export function canUseBiometricAuthentication(): boolean {
  return false;
}
