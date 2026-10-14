#!/usr/bin/env node
/**
 * Референсный инсталлятор ресурсов add-on'а в инстанс Synth.
 *
 * Что делает: читает `addon.json` → `provides` (AD-071 MCP-серверы, AD-046 скиллы)
 * и идемпотентно приводит инстанс Synth к этому состоянию:
 *
 *   managed (backend, API v2)      — MCP:  POST /api/v2/mcp/registry → 409 → PUT /api/v2/mcp/servers/:name
 *                                    скиллы: POST /api/v2/skills → 409 → PATCH /api/v2/skills/:name
 *                                            + PUT /api/v2/skills/:name/files/*
 *   standalone (core, файлы)       — MCP:  merge `mcp.servers.<name>` в config.yaml (атомарная запись)
 *                                    скиллы: копирование дерева в `{data-dir}/skills/<name>/`
 *
 * Принципы (см. AGENTS.md репозитория):
 *   - без внешних зависимостей: только `node:*` и global `fetch`;
 *   - идемпотентность: повторный запуск не плодит дубликатов и не падает;
 *   - `--dry-run`: печатает план и ничего не меняет;
 *   - токен не логируется (в вывод — только факт «задан/не задан»).
 *
 * Реализация — референсная: боевой add-on может везти свою (например, с
 * тенант-спецификой), сохраняя контракт `addon.json.provides`.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const HELP = `install-into-synth — установка ресурсов add-on'а (MCP/скиллы) в инстанс Synth

Использование:
  node scripts/install-into-synth.mjs --synth-url https://synth.example.com/api/v2 \\
      --token "$SYNTH_INSTALL_TOKEN" [--tenant t1] --service-host my-addon.synth.svc.cluster.local

Режимы:
  managed      --synth-url (+ --token): вызовы API v2 инстанса Synth;
  standalone   --config и/или --data-dir: файлы локального (standalone) инстанса.

Флаги:
  --synth-url URL     базовый URL API v2 (можно с /api/v2 или без — добавится)
  --token TOKEN       installer-ключ (или env SYNTH_INSTALL_TOKEN)
  --tenant NAME       значение для {tenant} в provides.mcp.path
  --service-host HOST хост сервиса аддона для сборки URL MCP (обычно
                      <release>.<ns>.svc.cluster.local)
  --mcp-url URL       явный URL MCP (переопределяет --service-host + provides.mcp.path)
  --manifest PATH     путь к addon.json (по умолчанию <repo>/addon.json)
  --skills-dir DIR    каталог с деревом скиллов (по умолчанию — по provides.skills[].path);
                      при задании источником служит DIR/<name>/SKILL.md
  --only LIST         что ставить: mcp,skills (по умолчанию — всё из provides)
  --config PATH       standalone: путь к config.yaml (merge mcp.servers)
  --data-dir DIR      standalone: каталог данных Synth (skills → <DIR>/skills)
  --dry-run           показать план, ничего не менять
  --help, -h          эта справка

Примеры:
  # managed (в кластере, из hook-Job чарта)
  node scripts/install-into-synth.mjs --synth-url http://synth-backend:5000/api/v2 \\
      --token "$SYNTH_INSTALL_TOKEN" --tenant tg --service-host synth-gateway.synth.svc.cluster.local

  # standalone (локальный инстанс)
  node scripts/install-into-synth.mjs --config ~/.config/synth/config.yaml \\
      --data-dir ~/.local/share/synth/data --service-host 127.0.0.1 --tenant dev --dry-run
`;

/** Разбор argv: поддержка `--flag value` и `--flag=value`. */
function parseArgs(argv) {
  const opts = {
    synthUrl: '',
    token: '',
    tenant: '',
    serviceHost: '',
    mcpUrl: '',
    manifest: '',
    skillsDir: '',
    only: '',
    config: '',
    dataDir: '',
    dryRun: false,
    help: false,
  };
  const map = {
    '--synth-url': 'synthUrl',
    '--token': 'token',
    '--tenant': 'tenant',
    '--service-host': 'serviceHost',
    '--mcp-url': 'mcpUrl',
    '--manifest': 'manifest',
    '--skills-dir': 'skillsDir',
    '--only': 'only',
    '--config': 'config',
    '--data-dir': 'dataDir',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flag === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (flag === '--help' || flag === '-h') {
      opts.help = true;
      continue;
    }
    const key = map[flag];
    if (!key) continue;
    const value = inline ?? argv[(i += 1)] ?? '';
    opts[key] = value.trim();
  }
  return opts;
}

/** Печатает строку с префиксом сервиса; секреты сюда не попадают. */
function log(message) {
  console.log(`[install] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

/** Достаёт код ошибки API v2 (`{error:{code,message}}`) для понятного текста. */
async function describeResponse(response) {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text);
    const code = parsed?.error?.code ?? '';
    const message = parsed?.error?.message ?? '';
    if (code || message) return `${code || 'HTTP'} ${message}`.trim();
  } catch {
    // не JSON — отдаём как есть (усечённо)
  }
  return text.slice(0, 200);
}

/** `fetch` + единая обработка ошибок; токен в лог не попадает. */
async function apiRequest(base, token, method, path, body) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}

/** Нормализует базовый URL API v2 (гарантирует суффикс `/api/v2`). */
function normalizeBaseUrl(raw) {
  const url = raw.trim().replace(/\/+$/, '');
  if (!url) fail('не задан --synth-url (URL API v2 инстанса Synth)');
  return /\/api\/v2$/.test(url) ? url : `${url}/api/v2`;
}

/** Подставляет {tenant} в путь MCP; пустой tenant — ошибка. */
function resolvePathTemplate(path, tenant) {
  const value = path || '/mcp';
  if (!value.includes('{tenant}')) return value;
  if (!tenant) fail(`provides.mcp.path содержит {tenant}, но не задан --tenant`);
  return value.replaceAll('{tenant}', tenant);
}

/** Собирает конфиг MCP-сервера (McpServerConfig, AD-071) из `provides.mcp`. */
function buildMcpConfig(mcp, opts) {
  const transport = mcp.transport ?? 'http';
  if (transport === 'stdio') {
    fail('provides.mcp.transport=stdio не поддерживается авто-установкой (внешний аддон не отдаёт stdio)');
  }
  const path = resolvePathTemplate(mcp.path, opts.tenant);
  const url = opts.mcpUrl
    ? opts.mcpUrl.replace(/\/+$/, '')
    : opts.serviceHost
      ? `http://${opts.serviceHost}:${mcp.port ?? 7100}${path.startsWith('/') ? path : `/${path}`}`
      : fail('не задан ни --mcp-url, ни --service-host — нечего регистрировать в MCP');
  const config = { type: transport === 'sse' ? 'sse' : 'http', url };
  if (mcp.description) config.description = mcp.description;
  return config;
}

/** Минимальный разбор frontmatter `SKILL.md` (name/description — однострочные). */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const head = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const data = {};
  for (const line of head.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return { data, body };
}

/** Рекурсивно читает дерево скилла → { relativePath: content }. */
async function readTree(root, prefix = '') {
  const result = {};
  let entries = [];
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(result, await readTree(root, rel));
    } else if (entry.isFile()) {
      result[rel] = await readFile(join(root, rel), 'utf8');
    }
  }
  return result;
}

/** Загружает скилл из дерева: SKILL.md (name/description/body) + supporting-файлы. */
async function loadSkill(entry, opts) {
  const name = entry.name;
  if (!name) fail('provides.skills[]: не задано имя скилла');
  const sourceDir = opts.skillsDir
    ? join(resolve(opts.skillsDir), name)
    : join(opts.manifestDir, entry.path ?? join('skills', name));

  const files = await readTree(sourceDir);
  const raw = files['SKILL.md'];
  if (raw === undefined) fail(`скилл "${name}": не найден SKILL.md в ${sourceDir}`);

  const { data, body } = parseFrontmatter(raw);
  const description = data.description ?? '';
  if (!description) fail(`скилл "${name}": в SKILL.md нет description (frontmatter)`);

  const supporting = {};
  for (const [rel, content] of Object.entries(files)) {
    if (rel === 'SKILL.md') continue;
    supporting[rel] = content;
  }
  return { name, description, body, raw, files: supporting };
}

/** Собирает план установки из манифеста. */
async function buildPlan(opts) {
  opts.manifestDir = dirname(resolve(opts.manifest));
  const raw = await readFile(resolve(opts.manifest), 'utf8');
  const manifest = JSON.parse(raw);
  const provides = manifest.provides ?? {};
  const only = opts.only
    ? opts.only.split(',').map((s) => s.trim()).filter(Boolean)
    : ['mcp', 'skills'];

  const plan = { manifest: opts.manifest, modes: { mcp: false, skills: false }, mcp: null, skills: [] };

  if (only.includes('mcp') && provides.mcp) {
    plan.modes.mcp = true;
    plan.mcp = { name: provides.mcp.name, config: buildMcpConfig(provides.mcp, opts) };
  }
  if (only.includes('skills') && Array.isArray(provides.skills) && provides.skills.length > 0) {
    plan.modes.skills = true;
    for (const entry of provides.skills) {
      plan.skills.push(await loadSkill(entry, opts));
    }
  }
  if (!plan.modes.mcp && !plan.modes.skills) {
    log('в addon.json.provides нет ресурсов для установки — нечего делать');
  }
  return plan;
}

/** managed: MCP-сервер в едином реестре (AD-071). */
async function installMcpManaged(base, token, mcp) {
  const created = await apiRequest(base, token, 'POST', '/mcp/registry', {
    name: mcp.name,
    config: mcp.config,
    enabled: true,
    enabledByDefault: true,
    origin: 'instance',
  });
  if (created.ok) {
    log(`MCP-сервер "${mcp.name}" добавлен в реестр`);
    return;
  }
  if (created.status === 409) {
    const updated = await apiRequest(base, token, 'PUT', `/mcp/servers/${encodeURIComponent(mcp.name)}`, mcp.config);
    if (!updated.ok) {
      fail(`MCP-сервер "${mcp.name}": обновление не удалось (${updated.status} ${await describeResponse(updated)})`);
    }
    log(`MCP-сервер "${mcp.name}" уже был — конфиг обновлён`);
    return;
  }
  fail(`MCP-сервер "${mcp.name}": не удалось добавить (${created.status} ${await describeResponse(created)})`);
}

/** managed: скилл (AD-046) — create → 409 → patch хвоста + supporting-файлы. */
async function installSkillManaged(base, token, skill) {
  const created = await apiRequest(base, token, 'POST', '/skills', {
    name: skill.name,
    description: skill.description,
    body: skill.body,
    files: skill.files,
  });
  if (created.ok) {
    log(`скилл "${skill.name}" создан`);
    return;
  }
  if (created.status !== 409) {
    fail(`скилл "${skill.name}": не удалось создать (${created.status} ${await describeResponse(created)})`);
  }

  const patched = await apiRequest(base, token, 'PATCH', `/skills/${encodeURIComponent(skill.name)}`, {
    description: skill.description,
    body: skill.body,
  });
  if (!patched.ok) {
    fail(`скилл "${skill.name}": не удалось обновить (${patched.status} ${await describeResponse(patched)})`);
  }
  for (const [rel, content] of Object.entries(skill.files)) {
    const path = rel.split('/').map(encodeURIComponent).join('/');
    const written = await apiRequest(
      base,
      token,
      'PUT',
      `/skills/${encodeURIComponent(skill.name)}/files/${path}`,
      { content },
    );
    if (!written.ok) {
      fail(`скилл "${skill.name}": файл ${rel} не записан (${written.status} ${await describeResponse(written)})`);
    }
  }
  log(`скилл "${skill.name}" уже был — обновлён (${Object.keys(skill.files).length} supporting-файлов)`);
}

/** YAML-скаляр: JSON-строка — валидный YAML (кавычки/экранирование). */
function yamlScalar(value) {
  return JSON.stringify(String(value));
}

/** Ключ YAML: безопасные имена — как есть, иначе в кавычках. */
function yamlKey(name) {
  return /^[A-Za-z0-9_.-]+$/.test(name) ? name : JSON.stringify(name);
}

/** Сериализует запись MCP-сервера в YAML-блок с заданным отступом. */
function serverYamlBlock(name, config, indent) {
  const pad = ' '.repeat(indent);
  const lines = [`${pad}${yamlKey(name)}:`];
  lines.push(`${pad}  type: ${config.type}`);
  if (config.url) lines.push(`${pad}  url: ${yamlScalar(config.url)}`);
  if (config.description) lines.push(`${pad}  description: ${yamlScalar(config.description)}`);
  if (config.enabledByDefault) lines.push(`${pad}  enabledByDefault: true`);
  return lines;
}

const indentOf = (line) => line.length - line.trimStart().length;
const isContent = (line) => line.trim() !== '' && !line.trimStart().startsWith('#');

/**
 * Идемпотентный merge `mcp.servers.<name>` в config.yaml.
 *
 * Хирургическая правка текста (без YAML-парсера и без зависимостей): меняется
 * только ветка `mcp.servers.<name>`, остальной файл — байт-в-байт. Поддерживаются
 * обычные блок-маппинги; flow-стиль (`servers: {}`) разворачивается в блок.
 */
function mergeConfigServers(text, name, config) {
  const trailingNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (trailingNewline) lines.pop();

  const mcpIdx = lines.findIndex((line) => /^mcp:\s*(#.*)?$/.test(line));
  if (mcpIdx === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push('mcp:', '  servers:', ...serverYamlBlock(name, config, 4));
    return `${lines.join('\n')}\n`;
  }

  const findBlockEnd = (from, baseIndent) => {
    for (let i = from + 1; i < lines.length; i += 1) {
      if (!isContent(lines[i])) continue;
      if (indentOf(lines[i]) <= baseIndent) return i;
    }
    return lines.length;
  };

  let mcpEnd = findBlockEnd(mcpIdx, 0);
  let serversIdx = -1;
  for (let i = mcpIdx + 1; i < mcpEnd; i += 1) {
    if (/^  servers:\s*(#.*)?$/.test(lines[i])) {
      serversIdx = i;
      break;
    }
    if (/^  servers:\s*\{\s*\}\s*(#.*)?$/.test(lines[i])) {
      lines[i] = '  servers:';
      serversIdx = i;
      break;
    }
  }

  if (serversIdx === -1) {
    lines.splice(mcpEnd, 0, '  servers:', ...serverYamlBlock(name, config, 4));
    return `${lines.join('\n')}\n`;
  }

  const serversEnd = findBlockEnd(serversIdx, 2);
  const existingIdx = (() => {
    for (let i = serversIdx + 1; i < serversEnd; i += 1) {
      if (!isContent(lines[i])) continue;
      if (indentOf(lines[i]) === 4 && lines[i].trim() === `${name}:`) return i;
    }
    return -1;
  })();

  if (existingIdx !== -1) {
    const existingEnd = findBlockEnd(existingIdx, 4);
    lines.splice(existingIdx, existingEnd - existingIdx);
  }

  const insertAt = findBlockEnd(serversIdx, 2);
  lines.splice(insertAt, 0, ...serverYamlBlock(name, config, 4));
  return `${lines.join('\n')}\n`;
}

/** standalone: merge MCP-сервера в config.yaml (атомарная запись tmp → rename). */
async function installMcpStandalone(configPath, mcp) {
  let text = '';
  try {
    text = await readFile(configPath, 'utf8');
  } catch {
    text = '';
  }
  const next = mergeConfigServers(text, mcp.name, mcp.config);
  if (next === text) {
    log(`MCP-сервер "${mcp.name}": конфиг уже актуален (${configPath})`);
    return;
  }
  const tmp = `${configPath}.tmp.${randomUUID()}`;
  await writeFile(tmp, next, 'utf8');
  await rename(tmp, configPath);
  log(`MCP-сервер "${mcp.name}" записан в ${configPath} (mcp.servers)`);
}

/** standalone: копирование дерева скилла в `{data-dir}/skills/<name>/`. */
async function installSkillsStandalone(dataDir, skills) {
  for (const skill of skills) {
    const targetDir = join(resolve(dataDir), 'skills', skill.name);
    await mkdir(targetDir, { recursive: true });
    const all = { 'SKILL.md': skill.raw, ...skill.files };
    for (const [rel, content] of Object.entries(all)) {
      const target = join(targetDir, rel);
      if (!target.startsWith(`${targetDir}${sep}`)) fail(`скилл "${skill.name}": небезопасный путь ${rel}`);
      await mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.tmp.${randomUUID()}`;
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, target);
    }
    log(`скилл "${skill.name}" установлен в ${targetDir}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (!opts.manifest) opts.manifest = join(REPO_ROOT, 'addon.json');
  if (!opts.token) opts.token = (process.env.SYNTH_INSTALL_TOKEN ?? '').trim();

  const standalone = Boolean(opts.config || opts.dataDir);
  const plan = await buildPlan(opts);

  if (opts.dryRun) {
    log(`режим: ${standalone ? 'standalone (файлы)' : 'managed (API v2)'}`);
    log(`манифест: ${resolve(opts.manifest)}`);
    log(`токен: ${opts.token ? 'задан' : 'не задан'}`);
    if (plan.mcp) log(`MCP: ${plan.mcp.name} → ${JSON.stringify(plan.mcp.config)}`);
    for (const skill of plan.skills) {
      log(`скилл: ${skill.name} (${Object.keys(skill.files).length} supporting-файлов)`);
    }
    log('dry-run: изменения не применялись');
    return;
  }

  if (standalone) {
    if (opts.config) {
      if (!plan.mcp) log('--config задан, но MCP в provides/--only нет — пропускаем');
      if (plan.mcp) await installMcpStandalone(resolve(opts.config), plan.mcp);
    }
    if (opts.dataDir) {
      if (plan.skills.length > 0) await installSkillsStandalone(opts.dataDir, plan.skills);
    } else if (plan.skills.length > 0) {
      log('--data-dir не задан — скиллы пропущены (standalone ставит их только в файлы)');
    }
    log('готово');
    return;
  }

  const base = normalizeBaseUrl(opts.synthUrl);
  if (!opts.token) fail('не задан installer-ключ: --token или env SYNTH_INSTALL_TOKEN');
  if (plan.mcp) await installMcpManaged(base, opts.token, plan.mcp);
  for (const skill of plan.skills) await installSkillManaged(base, opts.token, skill);
  log('готово');
}

main().catch((error) => {
  console.error(`[install] ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
