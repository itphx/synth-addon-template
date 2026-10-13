import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { describe, expect, it, vi } from 'vitest';

import { createProxyAgent, requestJson } from './egress.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createProxyAgent', () => {
  it('socks-схемы → SocksProxyAgent', () => {
    expect(createProxyAgent('socks://proxy:9050')).toBeInstanceOf(SocksProxyAgent);
    expect(createProxyAgent('socks5://proxy:9050')).toBeInstanceOf(SocksProxyAgent);
    expect(createProxyAgent('socks5h://proxy:9050')).toBeInstanceOf(SocksProxyAgent);
  });

  it('http/https → HttpsProxyAgent', () => {
    expect(createProxyAgent('http://proxy:3128')).toBeInstanceOf(HttpsProxyAgent);
    expect(createProxyAgent('https://proxy:3128')).toBeInstanceOf(HttpsProxyAgent);
  });

  it('неизвестная схема → ошибка addon.proxy_unsupported_scheme', () => {
    expect(() => createProxyAgent('ftp://proxy:21')).toThrow(/addon\.proxy_unsupported_scheme/);
    expect(() => createProxyAgent('not-a-url')).toThrow(/addon\.proxy_unsupported_scheme/);
  });
});

describe('requestJson', () => {
  it('без прокси идёт через fetchImpl и возвращает status/headers/json', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }, 201));
    const response = await requestJson('https://example.com/api', {
      method: 'POST',
      body: '{"ping":true}',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.status).toBe(201);
    expect(response.json).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('невалидный JSON в ответе → ошибка addon.invalid_json', async () => {
    const fetchImpl = vi.fn(async () => new Response('не json', { status: 200 }));
    await expect(
      requestJson('https://example.com/api', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/addon\.invalid_json/);
  });
});
