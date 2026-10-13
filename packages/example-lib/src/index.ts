/**
 * Публичный API библиотеки `@itphx/synth-addon-example-lib` — пример общего кода
 * add-on'а (роль «lib»), который импортируется сервисом (`apps/example`).
 */
export {
  createProxyAgent,
  requestJson,
  type JsonRequestOptions,
  type JsonResponse,
  type ProxyAgent,
} from './egress.js';
