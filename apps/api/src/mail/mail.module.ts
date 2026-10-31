import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Sends email. Development writes files; a real SMTP sender replaces it for deployment. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** Writes each message as an .eml file in MAIL_OUTBOX_DIR, which any mail client can open. */
@Injectable()
export class OutboxMailer implements Mailer {
  private readonly directory: string;

  constructor(@Inject(ENV) env: Env) {
    this.directory = resolve(env.MAIL_OUTBOX_DIR);
  }

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const eml = [
      'From: LEAD <no-reply@lead.test>',
      `To: ${headerSafe(message.to)}`,
      `Subject: ${headerSafe(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
    ].join('\r\n');
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.eml`;
    await writeFile(resolve(this.directory, name), eml, 'utf8');
  }
}

/** Header values must not contain line breaks (header injection). */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

@Global()
@Module({
  providers: [{ provide: MAILER, useClass: OutboxMailer }],
  exports: [MAILER],
})
export class MailModule {}
