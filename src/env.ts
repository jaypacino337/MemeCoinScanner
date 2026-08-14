import { z } from 'zod';

/**
 * Environment validation.
 *
 * Credentials are intentionally optional: the app must boot and be fully
 * navigable without any platform access. When a credential is missing the
 * matching provider registers as a fixture adapter and reports
 * CREDENTIALS_MISSING on the data-source health page, rather than the app
 * pretending it has live access.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),

  /**
   * "fixture"  — always use bundled, clearly-labelled synthetic fixtures.
   * "live"     — use HTTP adapters where credentials exist, fixtures elsewhere.
   */
  DATA_MODE: z.enum(['fixture', 'live']).default('fixture'),

  /** Shared secret required by the /api/cron/* ingestion endpoints. */
  CRON_SECRET: z.string().min(8).default('change-me-local-dev-secret'),

  // --- Optional platform credentials (see .env.example for how to obtain) ---
  TIKTOK_API_BASE_URL: z.string().url().optional(),
  TIKTOK_API_KEY: z.string().optional(),

  INSTAGRAM_API_BASE_URL: z.string().url().optional(),
  INSTAGRAM_API_KEY: z.string().optional(),

  X_API_BASE_URL: z.string().url().optional(),
  X_BEARER_TOKEN: z.string().optional(),

  PUMPFUN_API_BASE_URL: z.string().url().optional(),
  PUMPFUN_API_KEY: z.string().optional(),

  // --- Tunables ---
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Link verification can be disabled in offline/CI environments. */
  ENABLE_LINK_VERIFICATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function readEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (!cached) cached = readEnv();
  return cached;
}

/** Test-only hook so suites can exercise different configurations. */
export function resetEnvCache(): void {
  cached = null;
}

/** Which credentials are present, for the data-source health page. */
export function credentialStatus(): Record<string, boolean> {
  const env = getEnv();
  return {
    tiktok: Boolean(env.TIKTOK_API_KEY && env.TIKTOK_API_BASE_URL),
    instagram: Boolean(env.INSTAGRAM_API_KEY && env.INSTAGRAM_API_BASE_URL),
    x: Boolean(env.X_BEARER_TOKEN && env.X_API_BASE_URL),
    pumpfun: Boolean(env.PUMPFUN_API_BASE_URL),
  };
}
