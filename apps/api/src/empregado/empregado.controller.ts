import { Body, Controller, Get, Param, Patch, Post, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

/** Mínimo da Response do Express que usamos, sem depender dos tipos do pacote. */
interface RespostaHttp {
  set(headers: Record<string, string>): void;
  send(body: Buffer): void;
}
import { BadRequestException } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { EmpregadoService } from './empregado.service';
import { CriarEmpregadoDto, DefinirPinDto, AtivoDto, DefinirHorarioDto, DefinirSalarioDto, AcessoDto } from './dto/empregado.dto';
import { VincularCctDto } from '../cct/dto/cct.dto';
import { VincularConvencaoDto } from '../convencao/dto/convencao.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** O cliente (ADMIN_CLIENTE/RH) gerencia os próprios funcionários. */
@Controller('empregados')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class EmpregadoController {
  constructor(private readonly empregados: EmpregadoService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Post() criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarEmpregadoDto) {
    return this.empregados.criar(this.tenant(u), dto);
  }
  @Get() listar(@UsuarioAtual() u: PayloadAcesso) {
    return this.empregados.listarComAcesso(this.tenant(u));
  }

  /** Baixa o modelo .xlsx de importação (sempre em sincronia com os campos). */
  @Get('modelo-importacao')
  async modelo(@Res() res: RespostaHttp) {
    const buf = await this.empregados.gerarModeloImportacao();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo_funcionarios.xlsx"',
    });
    res.send(buf);
  }

  /** Importa funcionários de .xlsx ou .csv. Devolve criados + erros linha a linha. */
  @Post('importar')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importar(@UsuarioAtual() u: PayloadAcesso, @UploadedFile() arquivo?: { buffer: Buffer; originalname: string }) {
    if (!arquivo) throw new BadRequestException('Envie um arquivo .xlsx ou .csv');
    const nome = arquivo.originalname.toLowerCase();
    if (!nome.endsWith('.xlsx') && !nome.endsWith('.csv')) {
      throw new BadRequestException('Formato não suportado. Use .xlsx ou .csv');
    }
    return this.empregados.importarLote(this.tenant(u), arquivo.buffer, arquivo.originalname);
  }
  @Get(':id') obter(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.empregados.obter(this.tenant(u), id);
  }
  @Patch(':id/pin') definirPin(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DefinirPinDto) {
    return this.empregados.definirPin(this.tenant(u), id, dto.pin);
  }
  @Patch(':id/ativo') ativo(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: AtivoDto) {
    return this.empregados.definirAtivo(this.tenant(u), id, dto.ativo);
  }
  @Patch(':id/horario') horario(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DefinirHorarioDto) {
    return this.empregados.definirHorario(this.tenant(u), id, dto.horarioContratualId);
  }

  @Patch(':id/cct') cct(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: VincularCctDto) {
    return this.empregados.definirCct(this.tenant(u), id, dto.cctId ?? null);
  }

  @Patch(':id/convencao') convencao(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: VincularConvencaoDto) {
    return this.empregados.definirConvencao(this.tenant(u), id, dto.convencaoId ?? null);
  }
  /** Cria ou reseta o login do colaborador. A senha provisória aparece uma vez só. */
  @Post(':id/acesso') acesso(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: AcessoDto) {
    return this.empregados.criarOuResetarAcesso(this.tenant(u), id, dto.email);
  }
  @Patch(':id/salario') salario(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DefinirSalarioDto) {
    return this.empregados.definirSalario(this.tenant(u), id, dto.salarioMensal);
  }
}
