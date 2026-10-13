import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Конфигурация сервиса-надстройки. */
export interface AddonConfig {
  version: string;
  /** Корень репозитория add-on'а (для дефолтов data/secrets). */
  repoRoot: string;
  /** Каталог JSON-хранилища. */
  dataDir: string;
  /** Адрес прослушивания HTTP. */
  host: string;
  /** Порт HTTP. */
  port: number;
  /** Bearer-токен API. Если не задан — аутентификация пропускается. */
  token?: string;
  /** URL HTTP-прокси для исходящих запросов (egress, AD-088). */
  proxyUrl?: string;
}

/** Переопределения из CLI-флагов (приоритет выше env). */
export interface ConfigOverrides {
  dataDir?: string;
  host?: string;
  port?: number;
  token?: string;
  proxyUrl?: string;
  /**
   * Каталог секрет-файлов. Приоритет: `overrides.secretsDir` >
   * env `SYNTH_ADDON_SECRETS_DIR` > `<repoRoot>/secrets`.
   */
  secretsDir?: string;
}

/** Порт HTTP-сервера по умолчанию. */
export const DEFAULT_PORT = 7100;

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Читает переменную окружения, считая пустую/whitespace-only строку отсутствием
 * значения. Это важно для opencode: подстановка `{env:VAR}` при незаданной
 * переменной даёт **пустую строку**, а не `undefined`, поэтому голый `??` не
 * срабатывает и значение превращается в `''`.
 *
 * При наличии значения возвращается `trim()`-результат, иначе — `fallback`.
 */
export function envOr(env: NodeJS.ProcessEnv, key: string): string | undefined;
export function envOr(env: NodeJS.ProcessEnv, key: string, fallback: string): string;
export function envOr(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback?: string,
): string | undefined {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  return value.length > 0 ? value : fallback;
}

function readVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Читает секрет из файла каталога секретов; пустой файл = отсутствие значения. */
function readSecret(name: string, secretsDir: string): string | undefined {
  try {
    const value = readFileSync(join(secretsDir, name), 'utf8').trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Возвращает первое непустое env-значение из списка ключей. */
function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = envOr(env, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Единый порядок поиска URL прокси: env-цепочка, затем секрет-файл. */
const PROXY_ENV = ['SYNTH_ADDON_PROXY_URL', 'ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY'];

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Загружает конфигурацию. Приоритет: CLI-флаги (`overrides`) > `SYNTH_ADDON_*`
 * env > `secrets/`-файлы > значения по умолчанию.
 *
 * Каталог секрет-файлов: `overrides.secretsDir` > env `SYNTH_ADDON_SECRETS_DIR`
 * > `<repoRoot>/secrets`.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ConfigOverrides = {},
): AddonConfig {
  const secretsDir =
    overrides.secretsDir ?? envOr(env, 'SYNTH_ADDON_SECRETS_DIR') ?? join(REPO_ROOT, 'secrets');
  const dataDir =
    overrides.dataDir ?? envOr(env, 'SYNTH_ADDON_DATA_DIR') ?? join(REPO_ROOT, 'data');
  const host = overrides.host ?? envOr(env, 'SYNTH_ADDON_HOST') ?? '127.0.0.1';
  const port = overrides.port ?? parsePort(envOr(env, 'SYNTH_ADDON_PORT')) ?? DEFAULT_PORT;
  const token = overrides.token ?? envOr(env, 'SYNTH_ADDON_TOKEN') ?? readSecret('token', secretsDir);
  const proxyUrl = overrides.proxyUrl ?? firstEnv(env, PROXY_ENV) ?? readSecret('proxy_url', secretsDir);

  return {
    version: readVersion(),
    repoRoot: REPO_ROOT,
    dataDir,
    host,
    port,
    token,
    proxyUrl,
  };
}
