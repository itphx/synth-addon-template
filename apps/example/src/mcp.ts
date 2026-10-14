import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const SERVER_NAME = 'synth-addon-example';

/**
 * Создаёт MCP-сервер add-on'а (stdio).
 *
 * Инструменты MCP в Synth неймспейсятся как `{server}_{tool}`, поэтому тул здесь
 * называется просто `example_ping`, а агент увидит его как
 * `synth-addon-example_example_ping` (AD-071).
 */
export function createMcpServer(version: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });

  server.registerTool(
    'example_ping',
    {
      title: 'Проверка связи',
      description: 'Простой ping-тул шаблона add-on\'а: возвращает pong и версию сервиса.',
      inputSchema: { message: z.string().optional() },
    },
    async ({ message }) => {
      const payload = {
        pong: true,
        echo: message ?? 'ping',
        version,
        ts: new Date().toISOString(),
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  return server;
}

/** Запускает MCP-сервер по stdio (для подключения к движку/opencode). */
export async function runMcpServer(version: string): Promise<void> {
  const server = createMcpServer(version);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Готовит обработчик MCP по **Streamable HTTP** (для режима `--http`).
 *
 * Транспорт — web-standard (`Request` → `Response`), поэтому монтируется в
 * существующий Hono-сервер без второго порта: `app.all('/mcp', …)`.
 *
 * Режим stateless: SDK требует **свежий транспорт на каждый запрос**
 * («Stateless transport cannot be reused across requests»), поэтому сервер и
 * транспорт создаются в обработчике и закрываются после ответа. Ответы — JSON
 * (`enableJsonResponse`), без долгоживущего SSE-потока — так закрытие
 * транспорта не обрывает стрим. Состояние держит сам сервис.
 *
 * Аддон, обслуживающий несколько сред, обычно отдаёт путь с тенантом —
 * `/mcp/{tenant}` — и указывает его в `addon.json.provides.mcp.path`
 * (см. docs/contract.md §4); в примере тенант не нужен.
 */
export function createMcpHttpHandler(version: string): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const server = createMcpServer(version);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      // Закрывает и транспорт (Protocol.close → transport.close).
      await server.close();
    }
  };
}
