import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) senha!: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}

export class AlterarSenhaDto {
  @IsString() senhaAtual!: string;
  @IsString() @MinLength(8) senhaNova!: string;
}
