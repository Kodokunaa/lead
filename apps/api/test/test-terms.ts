import type { Term } from '@lead/schema';
import { randomInt } from 'node:crypto';
import request from 'supertest';

/** A test term, plus its first calendar year for building dates inside it. */
export type TestTerm = Term & { readonly year: number };

const ATTEMPTS = 20;

/**
 * Creates a first-semester term (Aug 10 to Dec 18) in a school year no earlier run has used.
 * The test database keeps its rows between runs, so a random year can already exist; that
 * answers 409 and another year is tried. With `current`, the new term is made current.
 */
export async function createTestTerm(
  server: Parameters<typeof request>[0],
  adminToken: string,
  options: { current?: boolean } = {},
): Promise<TestTerm> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const year = randomInt(2200, 9000);
    const response = await request(server)
      .post('/api/admin/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        schoolYear: `${year}-${year + 1}`,
        semester: 'first',
        startsOn: `${year}-08-10`,
        endsOn: `${year}-12-18`,
      });
    if (response.status === 409) continue;
    if (response.status !== 201) {
      throw new Error(`Creating a test term answered ${response.status}`);
    }
    const term = response.body as Term;
    if (options.current) {
      await request(server)
        .post(`/api/admin/terms/${term.id}/make-current`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    }
    return { ...term, year };
  }
  throw new Error(`No free school year after ${ATTEMPTS} tries; clear old test terms.`);
}
