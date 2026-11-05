import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class TransferirCltDto {
  @IsString() destinoTenantId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data da transferência inválida.' }) data!: string;
  @IsBoolean() preservarAdmissao!: boolean;
  @IsOptional() @IsString() novaAdmissao?: string | null;
  @IsIn(['TRANSFERENCIA', 'DESLIGAMENTO']) motivo!: 'TRANSFERENCIA' | 'DESLIGAMENTO';
}

export class TransferirPrestadorDto {
  @IsString() destinoTenantId!: string;
  @Matches(/^\d{4}-\d{2}$/, { message: 'Competência inválida (use AAAA-MM).' }) competencia!: string;
}
