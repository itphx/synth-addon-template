#!/usr/bin/env node
import { loadConfig, type ConfigOverrides } from './config.js';
import { FileStore } from './file-store.js';
import { createMcpHttpHandler, runMcpServer } from './mcp.js';
import { createApp, serve } from './server.js';

interface ParsedArgs {
  overrides: ConfigOverrides;
  mcp: boolean;
  http: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const overrides: ConfigOverrides = {};
  let mcp = false;
  let http = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const [flag, inline] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const nextValue = (): string | undefined => inline ?? argv[(i += 1)];

    switch (flag) {
      case '--mcp':
        mcp = true;
        break;
      case '--http':
        http = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--port': {
        const value = nextValue();
        const parsed = value ? Number.parseInt(value, 10) : undefined;
        if (parsed !== undefined && !Number.isNaN(parsed)) overrides.port = parsed;
        break;
      }
      case '--host': {
        const value = nextValue();
        if (value) overrides.host = value;
        break;
      }
      case '--data-dir': {
        const value = nextValue();
        if (value) overrides.dataDir = value;
        break;
      }
      case '--token': {
        const value = nextValue();
        if (value) overrides.token = value;
        break;
      }
      case '--proxy': {
        const value = nextValue();
        if (value) overrides.proxyUrl = value;
        break;
      }
      default:
        break;
    }
  }

  return { overrides, mcp, http, help };
}

function printHelp(): void {
  console.error(
    [
      'synth-addon-example',
      '',
      'Использование:',
      '  synth-addon-example [--mcp | --http] [--port N] [--host HOST] [--data-dir DIR] [--token TOKEN] [--proxy URL]',
      '',
      'Флаги:',
      '  --mcp            запустить MCP-сервер по stdio вместо HTTP',
      '  --http           отдавать MCP по Streamable HTTP на том же порту, путь /mcp',
      '                   (совпадает с synth.pack provides.mcp.path; также поднимает HTTP API)',
      '  --port N         порт HTTP-сервера (env SYNTH_ADDON_PORT, по умолчанию 7100)',
      '  --host HOST      адрес прослушивания (env SYNTH_ADDON_HOST, по умолчанию 127.0.0.1)',
      '  --data-dir DIR   каталог JSON-хранилища (env SYNTH_ADDON_DATA_DIR, по умолчанию <repo>/data)',
      '  --token TOKEN    Bearer-токен API (env SYNTH_ADDON_TOKEN или secrets/token; без него auth отключена)',
      '  --proxy URL      URL egress-прокси (env SYNTH_ADDON_PROXY_URL или secrets/proxy_url)',
      '  --help, -h       эта справка',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const { overrides, mcp, http, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }

  const config = loadConfig(process.env, overrides);
  const store = new FileStore(config.dataDir);
  await store.init();

  if (mcp) {
    await runMcpServer(config.version);
    return;
  }

  const app = createApp(config, {
    mcpHandler: http ? createMcpHttpHandler(config.version) : undefined,
  });
  await serve(app, config);
  console.error(`synth-addon-example ${config.version}: http://${config.host}:${config.port}`);
  console.error(`Данные: ${config.dataDir}`);
  console.error(
    `Auth: ${config.token ? 'Bearer-токен включён' : 'отключена (SYNTH_ADDON_TOKEN не задан)'}`,
  );
  console.error(`Egress-прокси: ${config.proxyUrl ?? 'не задан (прямые запросы)'}`);
  if (http) console.error(`MCP (Streamable HTTP): http://${config.host}:${config.port}/mcp`);
}

main().catch((error: unknown) => {
  console.error('[addon] фатальная ошибка:', error);
  process.exit(1);
});
