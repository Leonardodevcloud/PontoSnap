import { IsString, MinLength } from 'class-validator';
export class DispositivoDto {
  @IsString() @MinLength(2) nome!: string;
}
