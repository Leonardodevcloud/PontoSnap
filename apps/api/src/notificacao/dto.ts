import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SalvarSubscriptionDto {
  @IsString() endpoint!: string;
  @IsString() p256dh!: string;
  @IsString() auth!: string;
  @IsOptional() @IsString() dispositivo?: string;
}

export class RemoverSubscriptionDto {
  @IsString() endpoint!: string;
}

export class SalvarPreferenciasDto {
  @IsOptional() @IsBoolean() lembreteAntes?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(60) lembreteMinutos?: number;
  @IsOptional() @IsBoolean() esqueceuEntrada?: boolean;
  @IsOptional() @IsBoolean() esqueceuAlmoco?: boolean;
  @IsOptional() @IsBoolean() esqueceuSaida?: boolean;
  @IsOptional() @IsBoolean() ajusteRespondido?: boolean;
  @IsOptional() @IsBoolean() atestadoAnalisado?: boolean;
  @IsOptional() @IsBoolean() espelhoDisponivel?: boolean;
  @IsOptional() @IsBoolean() resumoSemanal?: boolean;
  @IsOptional() @IsBoolean() bancoVencendo?: boolean;
}
