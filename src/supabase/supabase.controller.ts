import {
  Body,
  Controller,
  Post,
  Get,
  UseGuards,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { AuthGuard } from './auth.guard';
import {
  SignUpDto,
  SignInDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { Request } from 'express';
import { User } from '@supabase/supabase-js';

@Controller('auth')
export class SupabaseController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Post('signup')
  @UsePipes(new ValidationPipe())
  async signUp(@Body() signUpDto: SignUpDto) {
    return this.supabaseService.signUp(signUpDto.email, signUpDto.password);
  }

  @Post('signin')
  @UsePipes(new ValidationPipe())
  async signIn(@Body() signInDto: SignInDto) {
    return this.supabaseService.signIn(signInDto.email, signInDto.password);
  }

  @Post('forgot-password')
  @UsePipes(new ValidationPipe())
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.supabaseService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @UsePipes(new ValidationPipe())
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.supabaseService.resetPassword(
      dto.email,
      dto.token,
      dto.newPassword,
    );
  }

  @Post('signout')
  @UseGuards(AuthGuard)
  async signOut() {
    return this.supabaseService.signOut();
  }

  @Get('me')
  @UseGuards(AuthGuard)
  getCurrentUser(@Req() req: Request & { user: User }): User {
    return req.user;
  }
}
