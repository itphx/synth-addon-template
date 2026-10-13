import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * JSON-хранилище поверх файловой системы.
 *
 * Соответствует модели хранения Synth (AD-005): запись атомарна — данные пишутся
 * во временный файл `*.tmp.<uuid>` в том же каталоге, затем выполняется
 * `rename()` (атомарна на POSIX). Побочные `.tmp.*` файлы при успешной записи не
 * остаются.
 */
export class FileStore {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  /** Создаёт корневой каталог хранилища. */
  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  /** Абсолютный путь с проверкой containment внутри корня. */
  resolvePath(relativePath: string): string {
    const target = resolve(this.rootDir, relativePath);
    const rel = relative(this.rootDir, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Путь вне хранилища: ${relativePath}`);
    }
    return target;
  }

  /** Читает JSON. Возвращает `null`, если файла нет. */
  async read<T>(relativePath: string): Promise<T | null> {
    const target = this.resolvePath(relativePath);
    try {
      const raw = await readFile(target, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Атомарно записывает JSON (tmp → rename). */
  async write<T>(relativePath: string, data: T): Promise<void> {
    const target = this.resolvePath(relativePath);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp.${randomUUID()}`;
    const payload = `${JSON.stringify(data, null, 2)}\n`;
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, target);
  }

  /** Удаляет файл. Возвращает `true`, если файл существовал. */
  async remove(relativePath: string): Promise<boolean> {
    try {
      await rm(this.resolvePath(relativePath));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** Имена `.json`-файлов каталога (без расширения), отсортированные. */
  async listNames(relativeDir: string): Promise<string[]> {
    const dir = this.resolvePath(relativeDir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort();
  }

  /** Читает все JSON-объекты каталога. */
  async listJson<T>(relativeDir: string): Promise<T[]> {
    const names = await this.listNames(relativeDir);
    const result: T[] = [];
    for (const name of names) {
      const value = await this.read<T>(join(relativeDir, `${name}.json`));
      if (value !== null) result.push(value);
    }
    return result;
  }
}
