import { z } from 'zod';
import { languageSchema, tzPhoneSchema } from './common.js';
import { adultDateOfBirthSchema } from './health-profile.schema.js';
import { genderSchema } from './patient.schema.js';

export const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(128)
  .regex(/[a-zA-Z]/, 'password must contain a letter')
  .regex(/\d/, 'password must contain a digit');

/** Roles a user may self-register as. Staff/admin roles are provisioned, not registered. */
export const selfRegisterRoleSchema = z.enum(['PATIENT', 'DOCTOR']);

export const registerSchema = z.object({
  phone: tzPhoneSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email().optional(),
  role: selfRegisterRoleSchema.default('PATIENT'),
  language: languageSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  phone: tzPhoneSchema,
  password: z.string().min(1, 'password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const otpPurposeSchema = z.enum([
  'PHONE_VERIFY',
  'LOGIN',
  'PASSWORD_RESET',
  'PHONE_CHANGE',
]);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

/**
 * Patient self-registration (POST /api/v1/auth/register).
 * UI Phase 2: date of birth and sex moved to the health profile, so both are
 * OPTIONAL here (older app builds still send them and keep working). When a
 * date of birth is sent it must be an adult's (MIN_PATIENT_AGE_YEARS).
 */
export const patientRegistrationSchema = z.object({
  phone: tzPhoneSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: adultDateOfBirthSchema().optional(),
  gender: genderSchema.optional(),
  language: languageSchema,
});
export type PatientRegistrationInput = z.infer<typeof patientRegistrationSchema>;

export const forgotPasswordSchema = z.object({
  phone: tzPhoneSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  phone: tzPhoneSchema,
  code: z.string().regex(/^\d{6}$/, 'OTP code is 6 digits'),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** POST /api/v1/auth/resend-otp — registration OTP re-send (Phase 9). */
export const resendOtpSchema = z.object({
  phoneNumber: tzPhoneSchema,
  purpose: z.literal('phone_verify'),
});
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;

export const requestOtpSchema = z.object({
  phone: tzPhoneSchema,
  purpose: otpPurposeSchema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: tzPhoneSchema,
  purpose: otpPurposeSchema,
  code: z.string().regex(/^\d{6}$/, 'OTP code is 6 digits'),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'new password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
