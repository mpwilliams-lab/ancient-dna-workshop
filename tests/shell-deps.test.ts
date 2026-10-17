// @vitest-environment jsdom
// Task 12, brief step 7: what the shell hands the Controller. The flags and the clock cannot be seen through behaviour yet
// (no flag changes the controller's output until Tasks 17 and 18), so this spies on the Controller's constructor argument.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => [] as { deps: Record<string, unknown>; restored: unknown }[]);
const handlersSeen = vi.hoisted(() => [] as { onContinue(): void; onBack(): void; onCredits(): void }[]);
vi.mock('../src/cardView', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/cardView')>();
  return {
    ...mod,
    mountCardView: (...args: Parameters<typeof mod.mountCardView>) => {
      handlersSeen.push(args[2]);
      return mod.mountCardView(...args);
    },
  };
});
vi.mock('../src/controller', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/controller')>();
  class Spy extends mod.Controller {
    constructor(deps: ConstructorParameters<typeof mod.Controller>[0], restored: ConstructorParameters<typeof mod.Controller>[1]) {
      seen.push({ deps: deps as unknown as Record<string, unknown>, restored });
      super(deps, restored);
    }
  }
  return { ...mod, Controller: Spy };
});

import { boot } from '../src/shell';
import { ALL_OFF, FEATURES, withFeatures } from '../src/features';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';

const FILE_URL = 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html';
const env = (extra: object = {}) => ({
  doc: document, href: FILE_URL, getStorage: () => new MemStore() as unknown as Storage, replaceUrl: () => {}, data: FIXTURE, ...extra,
});

beforeEach(() => {
  seen.length = 0;
  handlersSeen.length = 0;
  loadIndexHtml();
});

describe('what boot passes to the card view: every button handler gives the keyboard back to the prompt (spec §5.2)', () => {
  const prompt = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#terminal input')!;
  it.each(['onContinue', 'onBack', 'onCredits'] as const)('%s', (name) => {
    boot(env());
    expect(handlersSeen).toHaveLength(1);
    const elsewhere = document.getElementById('wrap-open')!;
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);
    handlersSeen[0]![name]();
    expect(document.activeElement).toBe(prompt());
  });
  it('onContinue also lets the controller close the open card', () => {
    const b = boot(env({ href: `${FILE_URL}?test` }));
    b.controller.openCardForTest('A1');
    expect(b.cards.isOpen()).toBe(true);
    handlersSeen[0]!.onContinue();
    expect(b.cards.isOpen()).toBe(false);
  });
});

describe('what boot passes to the Controller', () => {
  it('the card view as its card host, the flag set and the clock', () => {
    const features = withFeatures({ back: true }, ALL_OFF);
    const now = (): number => 4242;
    const b = boot(env({ features, now }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.deps.cards).toBe(b.cards);
    expect(seen[0]!.deps.features).toBe(features);
    expect(seen[0]!.deps.now).toBe(now);
    expect(seen[0]!.deps.data).toBe(FIXTURE);
  });
  it('the shipped flag set and no clock of its own by default (the controller then reads performance.now())', () => {
    const b = boot(env());
    expect(seen[0]!.deps.features).toBe(FEATURES);
    expect(b.features).toBe(FEATURES);
    expect('now' in seen[0]!.deps).toBe(false);
  });
});
