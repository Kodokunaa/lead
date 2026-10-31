import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for small secrets at rest (TOTP seeds), so a database dump alone does not let
 * anyone generate a user's codes. `context` (the user id) is bound in as associated data, so a
 * sealed value copied onto another row will not decrypt. Output: `v1.<iv>.<tag>.<ciphertext>`.
 */
export function encryptSecret(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

/** Throws if the value was tampered with, moved to another context, or sealed with another key. */
export function decryptSecret(sealed: string, key: Buffer, context: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognized encrypted secret format');
  }
  const tagBytes = Buffer.from(tag, 'base64url');
  if (tagBytes.length !== TAG_BYTES) throw new Error('Encrypted secret has a bad tag length');

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
