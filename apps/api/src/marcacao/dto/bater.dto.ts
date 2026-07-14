import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { Coletor } from '@ponto/shared';

export class BaterDto {
  @IsOptional() @IsEnum(Coletor) coletor?: Coletor;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
}
