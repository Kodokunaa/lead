import { hash, verify } from '@node-rs/argon2';

/** OWASP's Argon2id baseline: 19 MiB memory, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing').catch((error: unknown) => {
    dummyHash = undefined;
    throw error;
  });
  return dummyHash;
}

/** Computes the dummy hash at startup so the first unknown-email sign-in is not slower. */
export async function warmUpPasswordHashing(): Promise<void> {
  await getDummyHash();
}

/**
 * Verifies a password. With no stored hash it still runs a full verification against a dummy,
 * so a missing account takes as long as a wrong password and email addresses cannot be probed.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash) return verify(storedHash, password);
  await verify(await getDummyHash(), password);
  return false;
}
