import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

export const emailSchema = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email addresses are at most 254 characters.')
  .pipe(z.email('Enter a valid email address.'));

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Enter your password.' })
    .min(1, 'Enter your password.')
    .max(128, 'Passwords are at most 128 characters.'),
});

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES,
    `Use at most ${PASSWORD_MAX_BYTES} bytes.`,
  );
