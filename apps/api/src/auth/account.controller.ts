import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from '@lead/schema';
import type { Request } from 'express';
import {
  AccountService,
  EMAIL_VERIFIED,
  REGISTRATION_ACCEPTED,
  RESET_REQUESTED,
} from './account.service';
import { Public } from './auth.guard';
import { ACCOUNT_REQUEST_LIMIT, clientInfo, parseBody, SIGN_IN_LIMIT } from './http';

export interface MessageResponse {
  readonly message: string;
}

const PASSWORD_HINT = 'Choose a password of at least 12 characters.';

@Public()
@Controller('auth')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Throttle(ACCOUNT_REQUEST_LIMIT)
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  register(@Body() body: unknown, @Req() request: Request): MessageResponse {
    const registration = parseBody(
      registerRequestSchema,
      body,
      'Check the form: a valid email, your name, and Student or Teacher.',
    );
    this.accounts.register(registration, clientInfo(request));
    return { message: REGISTRATION_ACCEPTED };
  }

  /** Throttled like sign-in: it sets a password. */
  @Throttle(SIGN_IN_LIMIT)
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: unknown, @Req() request: Request): Promise<MessageResponse> {
    const verification = parseBody(verifyEmailRequestSchema, body, PASSWORD_HINT);
    await this.accounts.verifyEmail(verification, clientInfo(request));
    return { message: EMAIL_VERIFIED };
  }

  @Throttle(ACCOUNT_REQUEST_LIMIT)
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  forgot(@Body() body: unknown, @Req() request: Request): MessageResponse {
    const { email } = parseBody(forgotPasswordRequestSchema, body, 'Enter a valid email.');
    this.accounts.requestPasswordReset(email, clientInfo(request));
    return { message: RESET_REQUESTED };
  }

  /** Throttled like sign-in: the token is long and random, but this still sets a password. */
  @Throttle(SIGN_IN_LIMIT)
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@Body() body: unknown, @Req() request: Request): Promise<void> {
    const reset = parseBody(resetPasswordRequestSchema, body, PASSWORD_HINT);
    await this.accounts.resetPassword(reset, clientInfo(request));
  }
}
