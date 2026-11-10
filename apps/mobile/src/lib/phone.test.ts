import { loginSchema } from '@daktari/schemas';
import { formatLocal, fromE164, localDigits, toE164 } from './phone';
import { passwordRules, passwordStrength } from './password-strength';

describe('phone field (+255 prefix)', () => {
  it.each([
    ['712345678', '712345678'],
    ['0712 345 678', '712345678'],
    ['0712-345-678', '712345678'],
    ['+255 712 345 678', '712345678'],
    ['255712345678', '712345678'],
    ['7123456789999', '712345678'], // capped at 9 digits
    ['', ''],
  ])('%s → %s', (typed, digits) => {
    expect(localDigits(typed)).toBe(digits);
  });

  it('formats in groups of three while typing', () => {
    expect(formatLocal('7')).toBe('7');
    expect(formatLocal('7123')).toBe('712 3');
    expect(formatLocal('712345678')).toBe('712 345 678');
  });

  it('produces exactly what the server schema accepts', () => {
    const phone = toE164(localDigits('0712 345 678'));
    expect(phone).toBe('+255712345678');
    expect(loginSchema.safeParse({ phone, password: 'x' }).success).toBe(true);
    expect(toE164('')).toBe('');
    expect(fromE164('+255712345678')).toBe('712345678');
  });
});

describe('password strength hint', () => {
  it('mirrors the server rules', () => {
    expect(passwordRules('abc')).toEqual({ minLength: false, letter: true, digit: false });
    expect(passwordRules('daktari12')).toEqual({ minLength: true, letter: true, digit: true });
  });

  it('grades empty / weak / fair / strong', () => {
    expect(passwordStrength('')).toBe('empty');
    expect(passwordStrength('abcdefgh')).toBe('weak'); // no digit — the server would refuse it
    expect(passwordStrength('daktari12')).toBe('fair');
    expect(passwordStrength('Mkononi-Afya-2026')).toBe('strong');
    expect(passwordStrength('Aaaaaaaa1111!!')).toBe('fair'); // repeated runs
  });
});
