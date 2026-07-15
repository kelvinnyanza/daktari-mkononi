import { z } from 'zod';
import { languageSchema, tzPhoneSchema } from './common.js';

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
  'REGISTRATION',
  'LOGIN',
  'PASSWORD_RESET',
  'PHONE_CHANGE',
]);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

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
