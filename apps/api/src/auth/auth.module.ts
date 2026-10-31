import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { SessionCookies } from './session-cookies';

@Module({
  controllers: [AuthController, MfaController, AccountController],
  providers: [AuthService, MfaService, AccountService, AuthGuard, SessionCookies],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
