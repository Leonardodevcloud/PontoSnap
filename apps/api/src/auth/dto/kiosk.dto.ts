import { IsString, Matches } from 'class-validator';

export class KioskMarcarDto {
  @IsString() matricula!: string;
  @Matches(/^\d{4,8}$/, { message: 'PIN deve ter de 4 a 8 dígitos' }) pin!: string;
}
