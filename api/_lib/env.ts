/**
 * Reading server configuration from environment variables. Every reader takes the
 * environment as an argument (process.env by default) and is called per request, so a
 * changed variable or a test's stand-in environment is seen without reloading a module.
 * A variable that is set but unreadable falls back to the default and says so once in
 * the log by name, never by value.
 */
export type Env = Record<string, string | undefined>;

const warned = new Set<string>();

function warnOnce(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(JSON.stringify({ at: 'config', variable: name, problem: 'unreadable, default used' }));
}

/** A trimmed string, or '' when unset. */
export function text(env: Env, name: string): string {
  return (env[name] ?? '').trim();
}

/** A non-negative number, or `fallback` when unset or unreadable. */
export function num(env: Env, name: string, fallback: number): number {
  const raw = text(env, name);
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    warnOnce(name);
    return fallback;
  }
  return value;
}

/** A comma separated list without empty entries. */
export function list(env: Env, name: string): string[] {
  return text(env, name)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export function flag(env: Env, name: string): boolean {
  const raw = text(env, name).toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** True on a Vercel deployment (the platform sets VERCEL=1). */
export function onVercel(env: Env): boolean {
  return text(env, 'VERCEL') !== '';
}
