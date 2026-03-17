import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().startsWith("https://"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .optional(),
});

type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Missing or invalid environment variables:\n${formatted}\n\nCheck your .env.local file.`,
    );
  }

  _env = result.data;
  return _env;
}
