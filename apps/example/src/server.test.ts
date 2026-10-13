import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AddonConfig } from './config.js';
import { createApp } from './server.js';

const config: AddonConfig = {
  version: 'test',
  repoRoot: '/tmp',
  dataDir: '/tmp',
  host: '127.0.0.1',
  port: 0,
  token: 'secret',
};

const auth = { authorization: 'Bearer secret', 'content-type': 'application/json' };
const json = (body: unknown): string => JSON.stringify(body);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP API add-on\'а', () => {
  it('GET /health доступен без auth', async () => {
    const res = await createApp(config).request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBe('test');
  });

  it('GET /api/health доступен без auth', async () => {
    expect((await createApp(config).request('/api/health')).status).toBe(200);
  });

  it('без Bearer-токена защищённый роут → 401', async () => {
    expect((await createApp(config).request('/api/example/ping')).status).toBe(401);
  });

  it('с Bearer-токеном защищённый роут → 200', async () => {
    const res = await createApp(config).request('/api/example/ping', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pong: boolean };
    expect(body.pong).toBe(true);
  });

  it('POST /api/example/echo валидирует и возвращает эхо', async () => {
    const res = await createApp(config).request('/api/example/echo', {
      method: 'POST',
      headers: auth,
      body: json({ message: 'привет' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: 'привет' });
  });

  it('валидация: 400 на некорректном теле', async () => {
    const res = await createApp(config).request('/api/example/echo', {
      method: 'POST',
      headers: auth,
      body: json({ message: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('POST /api/example/fetch выполняет запрос через egress-слой библиотеки', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const res = await createApp(config).request('/api/example/fetch', {
      method: 'POST',
      headers: auth,
      body: json({ url: 'https://example.com/api' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 200, json: { ok: true } });
  });

  it('404 на неизвестном маршруте', async () => {
    expect((await createApp(config).request('/api/nope', { headers: auth })).status).toBe(404);
  });
});
