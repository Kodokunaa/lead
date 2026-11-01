import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_RESOURCE_BYTES, RESOURCE_FILE_TYPES, type ResourceFileExtension } from '@lead/schema';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** The parts of a multer upload this module uses (multer keeps uploads in memory). */
export interface UploadedResourceFile {
  readonly originalname: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface CheckedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly buffer: Buffer;
}

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const SIGNATURES: Readonly<Partial<Record<ResourceFileExtension, readonly Buffer[]>>> = {
  pdf: [Buffer.from('%PDF-')],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  jpeg: [Buffer.from([0xff, 0xd8, 0xff])],
  // Word, PowerPoint and Excel files are zip archives.
  docx: [ZIP],
  pptx: [ZIP],
  xlsx: [ZIP],
};

const ALLOWED = 'Upload a PDF, PNG or JPEG image, Word, PowerPoint, Excel or plain text file.';

function isExtension(value: string): value is ResourceFileExtension {
  return Object.hasOwn(RESOURCE_FILE_TYPES, value);
}

/** A display name only: no folders, no control characters, a sensible length. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Control characters, and invisible ones that reorder or hide text (e.g. U+202E turns
  // "report\u202Efdp.exe" into what looks like "reportexe.pdf").
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f"\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim();
  return (cleaned || 'file').slice(-120);
}

/**
 * Decides the file's type from its extension, then checks its first bytes match, so a script
 * renamed to .pdf is refused. The type sent by the browser is ignored.
 */
export function checkUpload(file: UploadedResourceFile): CheckedFile {
  const fileName = cleanFileName(file.originalname);
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  if (!isExtension(extension)) throw new BadRequestException(ALLOWED);
  if (file.size === 0 || file.buffer.length === 0) {
    throw new BadRequestException('The file is empty.');
  }
  if (file.buffer.length > MAX_RESOURCE_BYTES) {
    throw new BadRequestException('Files can be at most 20 MB.');
  }

  const signatures = SIGNATURES[extension];
  const matches = signatures
    ? signatures.some((signature) => file.buffer.subarray(0, signature.length).equals(signature))
    : isPlainText(file.buffer);
  if (!matches) {
    throw new BadRequestException(`The file's contents do not match a .${extension} file.`);
  }

  return {
    fileName,
    contentType: RESOURCE_FILE_TYPES[extension],
    sizeBytes: file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
    buffer: file.buffer,
  };
}

/** UTF-8 text without NUL bytes. */
function isPlainText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

const STORED_NAME = /^[0-9a-f]{32}$/;

/** Uploaded files on local disk under random names (MinIO replaces this for deployment). */
@Injectable()
export class ResourceStorage {
  private readonly directory: string;

  constructor(@Inject(ENV) env: Env) {
    this.directory = resolve(env.RESOURCE_STORAGE_DIR);
  }

  /** Writes the file and returns its stored name. */
  async save(buffer: Buffer): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const storedName = randomBytes(16).toString('hex');
    await writeFile(join(this.directory, storedName), buffer, { flag: 'wx' });
    return storedName;
  }

  /** Removes a file whose database row was never saved. */
  async remove(storedName: string): Promise<void> {
    if (!STORED_NAME.test(storedName)) return;
    await rm(join(this.directory, storedName), { force: true });
  }

  async open(storedName: string): Promise<ReadStream> {
    // Stored names come from the database, but check anyway that one can never be a path.
    if (!STORED_NAME.test(storedName)) throw new NotFoundException('File not found.');
    const path = join(this.directory, storedName);
    try {
      await stat(path);
    } catch {
      throw new NotFoundException('The file is missing from storage.');
    }
    return createReadStream(path);
  }
}
