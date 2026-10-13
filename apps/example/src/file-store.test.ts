import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileStore } from './file-store.js';

describe('FileStore', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'addon-store-'));
    store = new FileStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write → read: данные сохраняются и читаются обратно', async () => {
    await store.write('items/a.json', { id: 'a', value: 1 });
    const value = await store.read<{ id: string; value: number }>('items/a.json');
    expect(value).toEqual({ id: 'a', value: 1 });
  });

  it('read отсутствующего файла → null', async () => {
    expect(await store.read('nope.json')).toBeNull();
  });

  it('после записи не остаётся временных файлов *.tmp.*', async () => {
    await store.write('items/b.json', { ok: true });
    const names = await store.listNames('items');
    expect(names).toEqual(['b']);
  });

  it('listJson читает все JSON-объекты каталога (отсортировано)', async () => {
    await store.write('items/b.json', { id: 'b' });
    await store.write('items/a.json', { id: 'a' });
    const items = await store.listJson<{ id: string }>('items');
    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('remove удаляет файл и сообщает результат', async () => {
    await store.write('items/c.json', { id: 'c' });
    expect(await store.remove('items/c.json')).toBe(true);
    expect(await store.remove('items/c.json')).toBe(false);
  });

  it('запись вне корня хранилища запрещена (containment)', () => {
    expect(() => store.resolvePath('../escape.json')).toThrow(/вне хранилища/);
  });
});
