import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { requestJson } from '@itphx/synth-addon-example-lib';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z, ZodError } from 'zod';

import type { AddonConfig } from './config.js';

/** Схема тела примера-роута `POST /api/example/echo`. */
const EchoSchema = z.object({ message: z.string().min(1) });

/** Схема тела примера-роута `POST /api/example/fetch` (egress через прокси). */
const FetchSchema = z.object({
  url: z.string().url(),
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

/**
 * Собирает Hono-приложение add-on'а.
 *
 * Все маршруты, кроме `GET /health` (и его алиаса `GET /api/health`), требуют
 * `Authorization: Bearer <token>`, **если** задан `config.token`. Без токена
 * middleware присутствует, но пропускает запросы (локальный запуск).
 */
export function createApp(config: AddonConfig): Hono {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', logger());

  app.use('/api/*', async (c, next) => {
    if (!config.token || c.req.path === '/api/health') return next();
    const [scheme, value] = (c.req.header('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || value !== config.token) {
      return c.json({ error: { code: 'unauthorized', message: 'Требуется Bearer-токен' } }, 401);
    }
    return next();
  });

  // Обязательный маршрут готовности — без аутентификации.
  app.get('/health', (c) => c.json({ status: 'ok', version: config.version }));
  app.get('/api/health', (c) => c.json({ status: 'ok', version: config.version }));

  // Пример защищённого роута.
  app.get('/api/example/ping', (c) => c.json({ pong: true, version: config.version }));

  // Пример роута с валидацией тела.
  app.post('/api/example/echo', async (c) => {
    const body = EchoSchema.parse(await c.req.json());
    return c.json({ echo: body.message });
  });

  // Пример использования egress-слоя из библиотеки пакета
  // (`@itphx/synth-addon-example-lib`): запрос идёт через прокси, если задан
  // (`config.proxyUrl`), иначе — напрямую.
  app.post('/api/example/fetch', async (c) => {
    const body = FetchSchema.parse(await c.req.json());
    const response = await requestJson(body.url, {
      method: body.method,
      headers: body.headers,
      body: body.body,
      proxyUrl: config.proxyUrl,
    });
    return c.json({ status: response.status, json: response.json });
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Маршрут не найден' } }, 404));

  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: 'validation_error',
            message: 'Некорректные данные запроса',
            issues: error.issues,
          },
        },
        400,
      );
    }
    if (error instanceof SyntaxError) {
      return c.json({ error: { code: 'invalid_json', message: 'Некорректный JSON' } }, 400);
    }
    console.error('[addon] необработанная ошибка:', error);
    return c.json({ error: { code: 'internal_error', message: 'Внутренняя ошибка' } }, 500);
  });

  return app;
}

/** Запускает HTTP-сервер на `config.host:config.port`. */
export function serve(app: Hono, config: AddonConfig): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      void handleRequest(app, req, res);
    });
    server.listen(config.port, config.host, () => resolve(server));
  });
}

function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? 'localhost';
  const url = `http://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: 'half',
  } as RequestInit);
}

async function handleRequest(
  app: Hono,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const response = await app.fetch(toWebRequest(req), {});
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error('[addon] ошибка обработки запроса:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Внутренняя ошибка' } }));
  }
}
