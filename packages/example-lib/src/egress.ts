import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Единый egress-слой add-on'а (AD-088): исходящие запросы внешнего сервиса идут
 * через прокси, если он задан.
 *
 * Это пример переиспользуемой логики — роль «библиотека» (`packages/*`): пакет не
 * запускается сам, а импортируется сервисом (`apps/example`) через
 * workspace-зависимость.
 */
export type ProxyAgent = SocksProxyAgent | HttpsProxyAgent<string>;

/** Результат JSON-запроса транспорта. */
export interface JsonResponse {
  status: number;
  headers: IncomingHttpHeaders;
  json: unknown;
}

/** Опции {@link requestJson}. */
export interface JsonRequestOptions {
  /** HTTP-метод, по умолчанию `POST`. */
  method?: string;
  /** Заголовки запроса. */
  headers?: Record<string, string>;
  /** Тело запроса (строка). */
  body?: string;
  /** URL прокси; пустая строка/undefined — прямой запрос через fetch. */
  proxyUrl?: string;
  /** Реализация fetch для прямого пути (для тестов). */
  fetchImpl?: typeof fetch;
}

const SOCKS_SCHEMES = new Set(['socks', 'socks4', 'socks4a', 'socks5', 'socks5h']);
const HTTP_SCHEMES = new Set(['http', 'https']);

/**
 * Собирает агент прокси по схеме URL:
 * - `socks://`, `socks4://`, `socks4a://`, `socks5://`, `socks5h://` → `SocksProxyAgent`
 *   (для `socks5h`/`socks4a`/`socks` DNS резолвится на стороне прокси);
 * - `http://`, `https://` → `HttpsProxyAgent` (туннель через CONNECT).
 *
 * Неизвестная схема — ошибка `addon.proxy_unsupported_scheme`.
 */
export function createProxyAgent(proxyUrl: string): ProxyAgent {
  const url = proxyUrl.trim();
  const scheme = /^([a-z0-9+.-]+):\/\//i.exec(url)?.[1]?.toLowerCase();
  if (scheme && SOCKS_SCHEMES.has(scheme)) {
    return new SocksProxyAgent(url);
  }
  if (scheme && HTTP_SCHEMES.has(scheme)) {
    return new HttpsProxyAgent(url);
  }
  throw new Error(`addon.proxy_unsupported_scheme: ${scheme ?? url}`);
}

/**
 * Выполняет JSON-запрос к внешнему сервису.
 *
 * Без прокси (пустой `proxyUrl`) запрос идёт через `fetchImpl`
 * (`globalThis.fetch` по умолчанию). С прокси — через `node:https`/`node:http`
 * с агентом выбранной схемы, что возвращает `{ status, headers, json }`.
 *
 * Невалидный JSON в ответе — ошибка `addon.invalid_json` с текстом ответа.
 */
export async function requestJson(
  url: string,
  options: JsonRequestOptions = {},
): Promise<JsonResponse> {
  const proxyUrl = options.proxyUrl?.trim();
  if (!proxyUrl) {
    return requestJsonWithFetch(url, options);
  }
  return requestJsonWithAgent(url, proxyUrl, options);
}

async function requestJsonWithFetch(
  url: string,
  options: JsonRequestOptions,
): Promise<JsonResponse> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(url, {
    method: options.method ?? 'POST',
    headers: options.headers,
    body: options.body,
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    json: parseJson(text, `HTTP ${response.status}`),
  };
}

function requestJsonWithAgent(
  url: string,
  proxyUrl: string,
  options: JsonRequestOptions,
): Promise<JsonResponse> {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;
  const agent = createProxyAgent(proxyUrl);
  const requestOptions: RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: options.method ?? 'POST',
    headers: options.headers,
    agent,
  };

  return new Promise<JsonResponse>((resolve, reject) => {
    const request = requestFn(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            json: parseJson(text, `HTTP ${response.statusCode ?? 0}`),
          });
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function parseJson(text: string, context: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`addon.invalid_json (${context}): ${text.slice(0, 500)}`);
  }
}
