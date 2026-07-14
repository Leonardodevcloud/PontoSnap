import { IsBase64, IsString, MinLength } from 'class-validator';
export class SalvarCertificadoDto {
  @IsBase64() pfxBase64!: string;
  @IsString() @MinLength(1) senha!: string;
}
