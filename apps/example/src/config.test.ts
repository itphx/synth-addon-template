import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_PORT, envOr, loadConfig, type ConfigOverrides } from './config.js';

/** Пустой каталог секретов: изолирует тесты от реального `secrets/`. */
let emptySecretsDir: string;

beforeAll(() => {
  emptySecretsDir = mkdtempSync(join(tmpdir(), 'addon-secrets-empty-'));
});

afterAll(() => {
  rmSync(emptySecretsDir, { recursive: true, force: true });
});

/** `loadConfig` с герметичным пустым каталогом секретов по умолчанию. */
function load(env: NodeJS.ProcessEnv, overrides: ConfigOverrides = {}) {
  return loadConfig(env, { secretsDir: emptySecretsDir, ...overrides });
}

/** Создаёт временный каталог секретов с заданными файлами. */
function withSecrets(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'addon-secrets-'));
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(dir, name), value);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('envOr', () => {
  it('отсутствующее/пустое/whitespace значение → fallback, иначе trim', () => {
    expect(envOr({}, 'X')).toBeUndefined();
    expect(envOr({}, 'X', 'fb')).toBe('fb');
    expect(envOr({ X: '' }, 'X', 'fb')).toBe('fb');
    expect(envOr({ X: '   ' }, 'X', 'fb')).toBe('fb');
    expect(envOr({ X: '  v  ' }, 'X', 'fb')).toBe('v');
  });
});

describe('loadConfig', () => {
  it('значения по умолчанию', () => {
    const config = load({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.token).toBeUndefined();
    expect(config.dataDir).toBe(load({}).dataDir);
  });

  it('пустая строка env (подстановка opencode {env:VAR}) → значения по умолчанию', () => {
    const config = load({
      SYNTH_ADDON_HOST: '',
      SYNTH_ADDON_PORT: '',
      SYNTH_ADDON_TOKEN: '',
      SYNTH_ADDON_DATA_DIR: '',
    });
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.token).toBeUndefined();
    expect(config.dataDir).toBe(load({}).dataDir);
  });

  it('непустое env читается и обрезается по краям', () => {
    const config = load({
      SYNTH_ADDON_HOST: '  0.0.0.0  ',
      SYNTH_ADDON_PORT: ' 8080 ',
      SYNTH_ADDON_TOKEN: ' secret ',
      SYNTH_ADDON_DATA_DIR: ' /tmp/addon-data ',
    });
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8080);
    expect(config.token).toBe('secret');
    expect(config.dataDir).toBe('/tmp/addon-data');
  });

  it('CLI-флаги переопределяют env', () => {
    const config = load(
      { SYNTH_ADDON_HOST: '1.2.3.4', SYNTH_ADDON_PORT: '1', SYNTH_ADDON_TOKEN: 'env' },
      { host: 'cli', port: 9, token: 'cli', dataDir: '/cli' },
    );
    expect(config.host).toBe('cli');
    expect(config.port).toBe(9);
    expect(config.token).toBe('cli');
    expect(config.dataDir).toBe('/cli');
  });
});

describe('loadConfig: секрет-файлы', () => {
  it('читает token/proxy_url из secretsDir, если env не задан', () => {
    const secrets = withSecrets({
      token: 'file-token\n',
      proxy_url: 'socks5://proxy:9050\n',
    });
    try {
      const config = loadConfig({}, { secretsDir: secrets.dir });
      expect(config.token).toBe('file-token');
      expect(config.proxyUrl).toBe('socks5://proxy:9050');
    } finally {
      secrets.cleanup();
    }
  });

  it('env имеет приоритет над секрет-файлом', () => {
    const secrets = withSecrets({ proxy_url: 'socks5://file:9050' });
    try {
      const config = load(
        { SYNTH_ADDON_PROXY_URL: 'socks5://env:9050' },
        { secretsDir: secrets.dir },
      );
      expect(config.proxyUrl).toBe('socks5://env:9050');
    } finally {
      secrets.cleanup();
    }
  });

  it('пустой/whitespace-only секрет-файл эквивалентен отсутствию', () => {
    const secrets = withSecrets({ token: '   \n' });
    try {
      expect(loadConfig({}, { secretsDir: secrets.dir }).token).toBeUndefined();
    } finally {
      secrets.cleanup();
    }
  });
});

describe('loadConfig: proxyUrl', () => {
  it('приоритет: SYNTH_ADDON_PROXY_URL > ALL_PROXY > HTTPS_PROXY > HTTP_PROXY', () => {
    expect(load({ ALL_PROXY: 'b', HTTPS_PROXY: 'c', HTTP_PROXY: 'd' }).proxyUrl).toBe('b');
    expect(load({ HTTPS_PROXY: 'c', HTTP_PROXY: 'd' }).proxyUrl).toBe('c');
    expect(load({ HTTP_PROXY: 'd' }).proxyUrl).toBe('d');
  });
});
