import { loginSchema, patientRegistrationSchema } from '@daktari/schemas';
import { validateForm } from './form';

describe('validateForm (shared Zod schemas — same rules as the server)', () => {
  it('accepts a valid registration and normalizes the phone', () => {
    const result = validateForm(patientRegistrationSchema, {
      phone: '0712 345 678', // local format → normalized to +255
      password: 'Siri-Kali-1!',
      fullName: 'Neema Chuwa',
      dateOfBirth: '1994-06-06',
      gender: 'FEMALE',
      language: 'sw',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phone).toBe('+255712345678');
    }
  });

  it('maps Zod issues to per-field errors (Swahili phone message from the schema)', () => {
    const result = validateForm(patientRegistrationSchema, {
      phone: '12345',
      password: 'short',
      fullName: 'N',
      dateOfBirth: '2099-01-01', // future DOB
      gender: 'FEMALE',
      language: 'sw',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.phone).toMatch(/Namba ya simu/); // schema's Swahili message
      expect(result.fieldErrors.password).toBeDefined();
      expect(result.fieldErrors.fullName).toBeDefined();
      expect(result.fieldErrors.dateOfBirth).toBeDefined();
    }
  });

  it('login schema requires both fields', () => {
    const result = validateForm(loginSchema, { phone: '', password: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.phone).toBeDefined();
      expect(result.fieldErrors.password).toBeDefined();
    }
  });
});
