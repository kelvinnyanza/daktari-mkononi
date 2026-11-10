/**
 * Password strength HINT for registration. The rules that decide acceptance
 * are the server's passwordSchema (≥ 8 characters, a letter and a digit) —
 * `rules` mirrors them so the checklist can tick them off while typing; the
 * level is advice only (longer and more varied is better).
 */
export interface PasswordRules {
  minLength: boolean;
  letter: boolean;
  digit: boolean;
}

export type StrengthLevel = 'empty' | 'weak' | 'fair' | 'strong';

export function passwordRules(password: string): PasswordRules {
  return {
    minLength: password.length >= 8,
    letter: /[a-zA-Z]/.test(password),
    digit: /\d/.test(password),
  };
}

export function passwordStrength(password: string): StrengthLevel {
  if (password.length === 0) return 'empty';
  const rules = passwordRules(password);
  if (!rules.minLength || !rules.letter || !rules.digit) return 'weak';
  let bonus = 0;
  if (password.length >= 12) bonus += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) bonus += 1;
  if (/[^a-zA-Z0-9]/.test(password)) bonus += 1;
  // Obvious patterns stay "fair" however long: repeated or sequential runs.
  if (/(.)\1{3,}/.test(password) || /(0123|1234|2345|3456|4567|5678|6789|abcd)/i.test(password)) {
    return 'fair';
  }
  return bonus >= 2 ? 'strong' : 'fair';
}
