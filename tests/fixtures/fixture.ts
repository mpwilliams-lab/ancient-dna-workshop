// Typed access to the synthetic fixture for unit tests. Always clone before mutating.
import raw from './data.fixture.json';
import { validateData } from '../../src/data';
import type { WorkshopData } from '../../src/types';

export const FIXTURE: WorkshopData = validateData(raw);

/** A deep copy of the raw fixture JSON (untyped), for tests that break it on purpose. */
export function rawFixture(): any {
  return structuredClone(raw);
}

/** A deep copy of the validated fixture, safe to mutate. */
export function cloneFixture(): WorkshopData {
  return structuredClone(FIXTURE);
}
