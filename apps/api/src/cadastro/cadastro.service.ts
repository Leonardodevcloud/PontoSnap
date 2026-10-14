import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { empregado, empregadoFoto, pessoalPrestador, usuario, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { CriptoService } from '../common/cripto.service';

/**
 * Atualização cadastral com foto.
 *
 * - O funcionário envia a foto (câmera ou galeria) e confere celular/e-mail no
 *   app. É obrigatório: enquanto não tiver foto válida, o app não libera o ponto.
 * - A foto vale assim que é salva (status REVISAR). O RH pode aprovar ou recusar
 *   com motivo; recusada, o app pede outra no próximo acesso.
 * - Fotos ficam cifradas em repouso. As listas recebem só a miniatura (96px).
 * - Quem não tem foto (ainda não entrou, ou prestador) aparece com uma
 *   caricatura gerada no navegador a partir de uma semente; o RH pode trocar.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_FOTO = 400 * 1024;
const MAX_MINI = 60 * 1024;

function lerJpeg(b64: string, max: number, nome: string): Buffer {
  const limpo = b64.replace(/^data:image\/jpeg;base64,/, '');
  const buf = Buffer.from(limpo, 'base64');
  if (buf.length < 100 || !buf.subarray(0, 3).equals(JPEG)) throw new BadRequestException(`A ${nome} precisa ser uma imagem JPEG.`);
  if (buf.length > max) throw new BadRequestException(`A ${nome} passou do tamanho máximo (${Math.round(max / 1024)} KB).`);
  return buf;
}

export interface MeuCadastro {
  nome: string; cpf: string;
  celular: string | null; emailPessoal: string | null; contatoEmergencia: string | null;
  cadastroAtualizadoEm: string | null;
  foto: { status: 'REVISAR' | 'APROVADA' | 'RECUSADA'; motivo: string | null; miniatura: string; enviadaEm: string } | null;
  avatarSemente: number | null;
  /** true = o app mostra a atualização cadastral antes de liberar o ponto. */
  precisaAtualizar: boolean;
}

@Injectable()
export class CadastroService {
  constructor(@Inject(DB) private readonly db: Db, private readonly cripto: CriptoService) {}

  async empregadoDoUsuario(tenantId: string, usuarioId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const us = (await tx.select({ empregadoId: usuario.empregadoId }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!us?.empregadoId) throw new ForbiddenException('Este acesso não está vinculado a um funcionário.');
      return us.empregadoId;
    });
  }

  private dataUrl(cifrado: Buffer): string {
    return `data:image/jpeg;base64,${this.cripto.decifrarBytes(cifrado).toString('base64')}`;
  }

  async meu(tenantId: string, empregadoId: string): Promise<MeuCadastro> {
    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select({
        nome: empregado.nome, cpf: empregado.cpf, celular: empregado.celular, emailPessoal: empregado.emailPessoal,
        contatoEmergencia: empregado.contatoEmergencia, cadastroAtualizadoEm: empregado.cadastroAtualizadoEm, avatarSemente: empregado.avatarSemente,
      }).from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.id, empregadoId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado');
      const f = (await tx.select({ status: empregadoFoto.status, motivo: empregadoFoto.motivo, miniatura: empregadoFoto.miniatura, enviadaEm: empregadoFoto.enviadaEm })
        .from(empregadoFoto).where(eq(empregadoFoto.empregadoId, empregadoId)).limit(1))[0];
      const foto = f ? { status: f.status as 'REVISAR' | 'APROVADA' | 'RECUSADA', motivo: f.motivo, miniatura: this.dataUrl(f.miniatura), enviadaEm: f.enviadaEm.toISOString() } : null;
      return {
        nome: e.nome, cpf: e.cpf, celular: e.celular, emailPessoal: e.emailPessoal, contatoEmergencia: e.contatoEmergencia,
        cadastroAtualizadoEm: e.cadastroAtualizadoEm?.toISOString() ?? null, avatarSemente: e.avatarSemente, foto,
        precisaAtualizar: !foto || foto.status === 'RECUSADA' || !e.cadastroAtualizadoEm,
      };
    });
  }

  async salvarMeu(tenantId: string, empregadoId: string, d: {
    foto?: string; miniatura?: string; origem?: 'CAMERA' | 'GALERIA'; celular?: string; emailPessoal?: string; contatoEmergencia?: string;
  }): Promise<MeuCadastro> {
    const email = d.emailPessoal?.trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('E-mail inválido. Confira se tem @ e o domínio (ex.: nome@gmail.com).');
    const cel = d.celular?.replace(/\D/g, '') || null;
    if (cel && (cel.length < 10 || cel.length > 13)) throw new BadRequestException('Celular inválido. Use DDD + número (ex.: 71 98812-3344).');
    if (!!d.foto !== !!d.miniatura) throw new BadRequestException('Envie a foto e a miniatura juntas.');
    const foto = d.foto ? lerJpeg(d.foto, MAX_FOTO, 'foto') : null;
    const mini = d.miniatura ? lerJpeg(d.miniatura, MAX_MINI, 'miniatura') : null;

    await comTenant(this.db, tenantId, async (tx) => {
      const atual = (await tx.select({ status: empregadoFoto.status }).from(empregadoFoto).where(eq(empregadoFoto.empregadoId, empregadoId)).limit(1))[0];
      if (!foto && (!atual || atual.status === 'RECUSADA')) throw new BadRequestException('Falta a foto.');
      if (foto && mini) {
        const valores = {
          foto: this.cripto.cifrarBytes(foto), miniatura: this.cripto.cifrarBytes(mini), status: 'REVISAR', motivo: null,
          origem: d.origem ?? 'CAMERA', enviadaEm: new Date(), revisadaEm: null, revisadaPor: null,
        };
        if (atual) await tx.update(empregadoFoto).set(valores).where(eq(empregadoFoto.empregadoId, empregadoId));
        else await tx.insert(empregadoFoto).values({ empregadoId, tenantId, ...valores });
      }
      await tx.update(empregado).set({
        celular: d.celular !== undefined ? (d.celular.trim() || null) : undefined,
        emailPessoal: d.emailPessoal !== undefined ? email : undefined,
        contatoEmergencia: d.contatoEmergencia !== undefined ? (d.contatoEmergencia.trim() || null) : undefined,
        cadastroAtualizadoEm: new Date(),
      }).where(and(eq(empregado.tenantId, tenantId), eq(empregado.id, empregadoId)));
    });
    return this.meu(tenantId, empregadoId);
  }

  /** Foto grande (320px) para o perfil e a revisão. */
  async foto(tenantId: string, empregadoId: string): Promise<Buffer> {
    return comTenant(this.db, tenantId, async (tx) => {
      const f = (await tx.select({ foto: empregadoFoto.foto }).from(empregadoFoto)
        .where(and(eq(empregadoFoto.tenantId, tenantId), eq(empregadoFoto.empregadoId, empregadoId))).limit(1))[0];
      if (!f) throw new NotFoundException('Sem foto');
      return this.cripto.decifrarBytes(f.foto);
    });
  }

  /**
   * Tudo que as listas precisam para mostrar o rosto: miniatura de quem tem
   * foto válida e a semente da caricatura de todos (CLT e prestadores).
   */
  async avatares(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select({ id: empregado.id, nome: empregado.nome, ativo: empregado.ativo, semente: empregado.avatarSemente, atualizado: empregado.cadastroAtualizadoEm })
        .from(empregado).where(eq(empregado.tenantId, tenantId));
      const fotos = await tx.select({ id: empregadoFoto.empregadoId, mini: empregadoFoto.miniatura, status: empregadoFoto.status, motivo: empregadoFoto.motivo, enviadaEm: empregadoFoto.enviadaEm, origem: empregadoFoto.origem })
        .from(empregadoFoto).where(eq(empregadoFoto.tenantId, tenantId));
      const prest = await tx.select({ id: pessoalPrestador.id, semente: pessoalPrestador.avatarSemente })
        .from(pessoalPrestador).where(eq(pessoalPrestador.tenantId, tenantId));
      const comApp = new Set((await tx.select({ e: usuario.empregadoId }).from(usuario)
        .where(and(eq(usuario.tenantId, tenantId), eq(usuario.ativo, true)))).map((u) => u.e).filter(Boolean));
      const porId = new Map(fotos.map((f) => [f.id, f]));
      const empregados: Record<string, { foto: string | null; status: string | null; motivo: string | null; enviadaEm: string | null; origem: string | null; semente: number | null; temApp: boolean; cadastroEm: string | null }> = {};
      for (const e of emps) {
        const f = porId.get(e.id);
        empregados[e.id] = {
          foto: f && f.status !== 'RECUSADA' ? this.dataUrl(f.mini) : null,
          status: f?.status ?? null, motivo: f?.motivo ?? null, enviadaEm: f?.enviadaEm.toISOString() ?? null, origem: f?.origem ?? null,
          semente: e.semente, temApp: comApp.has(e.id), cadastroEm: e.atualizado?.toISOString() ?? null,
        };
      }
      const prestadores: Record<string, { semente: number | null }> = {};
      for (const p of prest) prestadores[p.id] = { semente: p.semente };
      const ativos = emps.filter((e) => e.ativo);
      const resumo = {
        ativos: ativos.length,
        comFoto: ativos.filter((e) => { const f = porId.get(e.id); return f && f.status !== 'RECUSADA'; }).length,
        revisar: ativos.filter((e) => porId.get(e.id)?.status === 'REVISAR').length,
        recusadas: ativos.filter((e) => porId.get(e.id)?.status === 'RECUSADA').length,
      };
      return { empregados, prestadores, resumo };
    });
  }

  async revisar(tenantId: string, empregadoId: string, aprovar: boolean, motivo: string | null, quem: string | null) {
    if (!aprovar && !motivo?.trim()) throw new BadRequestException('Diga o motivo: ele aparece para o funcionário ao tirar outra foto.');
    return comTenant(this.db, tenantId, async (tx) => {
      const r = await tx.update(empregadoFoto).set({
        status: aprovar ? 'APROVADA' : 'RECUSADA', motivo: aprovar ? null : motivo!.trim(), revisadaEm: new Date(), revisadaPor: quem,
      }).where(and(eq(empregadoFoto.tenantId, tenantId), eq(empregadoFoto.empregadoId, empregadoId))).returning({ id: empregadoFoto.empregadoId });
      if (r.length === 0) throw new NotFoundException('Este funcionário ainda não enviou foto.');
      return { ok: true };
    });
  }

  async definirSemente(tenantId: string, tipo: 'CLT' | 'PRESTADOR', id: string, semente: number) {
    return comTenant(this.db, tenantId, async (tx) => {
      const r = tipo === 'CLT'
        ? await tx.update(empregado).set({ avatarSemente: semente }).where(and(eq(empregado.tenantId, tenantId), eq(empregado.id, id))).returning({ id: empregado.id })
        : await tx.update(pessoalPrestador).set({ avatarSemente: semente }).where(and(eq(pessoalPrestador.tenantId, tenantId), eq(pessoalPrestador.id, id))).returning({ id: pessoalPrestador.id });
      if (r.length === 0) throw new NotFoundException('Pessoa não encontrada');
      return { ok: true };
    });
  }
}
