import { z } from 'zod';

const publicEnvironmentSchema = z
  .object({
    appEnvironment: z.enum(['development', 'staging', 'production']).default('development'),
    supabaseUrl: z.url().optional(),
    supabasePublishableKey: z
      .string()
      .min(20)
      .regex(/^sb_publishable_[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .refine(
    (environment) =>
      Boolean(environment.supabaseUrl) === Boolean(environment.supabasePublishableKey),
    {
      message: 'Supabase public configuration must be provided as a complete pair.',
    },
  )
  .strict();

export function parsePublicEnvironment(input: unknown) {
  const result = publicEnvironmentSchema.safeParse(input);
  if (!result.success) throw new Error('KitchenCam configuration is invalid.');
  return Object.freeze(result.data);
}

// Expo only inlines static dot-notation access. Never spread process.env or app config extra.
export const publicEnvironment = parsePublicEnvironment({
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || undefined,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
});
