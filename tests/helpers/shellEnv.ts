import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from '../fixtures/data.fixture.json';
import { validateData } from '../../src/data';
import type { WorkshopData } from '../../src/types';

export const FIXTURE: WorkshopData = validateData(fixture);

/** In-memory sessionStorage stand-in that exposes its entries so tests can corrupt them. */
export class MemStore {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

/** Loads the real W/index.html markup into the jsdom document (scripts are not executed). */
export function loadIndexHtml(): void {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (!body) throw new Error('index.html has no <body>');
  document.head.innerHTML = '';
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

export function countText(needle: string): number {
  return (document.body.textContent ?? '').split(needle).length - 1;
}
