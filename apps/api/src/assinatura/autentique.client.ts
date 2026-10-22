/**
 * Cliente da API da Autentique (GraphQL, https://docs.autentique.com.br/api).
 * Só o que o PontoSnap usa: validar o token, criar documento (com upload),
 * consultar a assinatura, reenviar, gerar link, cancelar e baixar o assinado.
 *
 * Interface separada da implementação para os testes trocarem por uma falsa.
 */
export interface SignatarioAutentique {
  nome: string;
  /** EMAIL: link por e-mail · WHATSAPP: pelo celular · APP: sem aviso (link gerado sob demanda). */
  canal: 'EMAIL' | 'WHATSAPP' | 'APP';
  email?: string | null;
  /** +55DDDNUMERO */
  telefone?: string | null;
}
export interface NovoDocumento {
  nome: string; mensagem?: string | null; lembrete?: 'DAILY' | 'WEEKLY' | null; prazo?: string | null;
  sandbox: boolean; signatario: SignatarioAutentique; arquivo: Buffer; arquivoNome: string;
}
export interface SituacaoAutentique {
  visualizadoEm: string | null; assinadoEm: string | null; recusadoEm: string | null; motivoRecusa: string | null;
  arquivoAssinadoUrl: string | null;
}
export interface AutentiqueApi {
  conta(): Promise<{ nome: string | null; email: string | null; documentos: number | null; creditos: number | null }>;
  criarDocumento(d: NovoDocumento): Promise<{ id: string; publicId: string | null }>;
  situacao(id: string): Promise<SituacaoAutentique | null>;
  reenviar(publicIds: string[]): Promise<void>;
  linkAssinatura(publicId: string): Promise<string>;
  cancelar(id: string): Promise<void>;
  baixar(url: string): Promise<Buffer>;
}

const URL_API = 'https://api.autentique.com.br/v2/graphql';

export class ErroAutentique extends Error {}

export class AutentiqueHttp implements AutentiqueApi {
  constructor(private readonly token: string, private readonly url = URL_API) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}, arquivo?: { dados: Buffer; nome: string }): Promise<T> {
    let body: FormData | string; const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (arquivo) {
      // GraphQL multipart request: operations + map + o arquivo em variables.file.
      const fd = new FormData();
      fd.append('operations', JSON.stringify({ query, variables: { ...variables, file: null } }));
      fd.append('map', JSON.stringify({ file: ['variables.file'] }));
      fd.append('file', new Blob([new Uint8Array(arquivo.dados)], { type: 'application/pdf' }), arquivo.nome);
      body = fd;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ query, variables });
    }
    let r: Response;
    try { r = await fetch(this.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(45_000) }); }
    catch (e) { throw new ErroAutentique(`Não consegui falar com a Autentique (${(e as Error).message}).`); }
    const txt = await r.text();
    let j: { data?: T; errors?: { message: string }[] } = {};
    try { j = JSON.parse(txt); } catch { /* corpo não-JSON */ }
    if (r.status === 401 || r.status === 403) throw new ErroAutentique('Token da Autentique inválido ou sem permissão.');
    if (j.errors?.length) throw new ErroAutentique(traduzir(j.errors[0]!.message));
    if (!r.ok || !j.data) throw new ErroAutentique(`A Autentique respondeu ${r.status}.`);
    return j.data;
  }

  async conta() {
    const d = await this.gql<{ me: { name: string | null; email: string | null; subscription?: { documents?: number | null; credits?: number | null } | null } }>(
      'query { me { name email subscription { documents credits } } }');
    return { nome: d.me?.name ?? null, email: d.me?.email ?? null, documentos: d.me?.subscription?.documents ?? null, creditos: d.me?.subscription?.credits ?? null };
  }

  async criarDocumento(n: NovoDocumento) {
    const s = n.signatario;
    const signer: Record<string, unknown> = { action: 'SIGN' };
    if (s.canal === 'EMAIL' && s.email) signer.email = s.email;
    else if (s.canal === 'WHATSAPP' && s.telefone) { signer.phone = s.telefone; signer.delivery_method = 'DELIVERY_METHOD_WHATSAPP'; }
    else signer.name = s.nome;
    const document: Record<string, unknown> = { name: n.nome, refusable: true };
    if (n.mensagem) document.message = n.mensagem;
    if (n.lembrete) document.reminder = n.lembrete;
    if (n.prazo) document.deadline_at = `${n.prazo}T23:59:59-03:00`;
    const q = `mutation Criar($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
      createDocument(sandbox: ${n.sandbox ? 'true' : 'false'}, document: $document, signers: $signers, file: $file) { id signatures { public_id email name action { name } } } }`;
    const d = await this.gql<{ createDocument: { id: string; signatures: { public_id: string; action: { name: string } | null }[] } }>(
      q, { document, signers: [signer] }, { dados: n.arquivo, nome: n.arquivoNome });
    // A primeira assinatura é a do dono da conta só quando ele também assina; aqui pegamos a de ação SIGN.
    const sig = d.createDocument.signatures.find((x) => (x.action?.name ?? '').toUpperCase() === 'SIGN') ?? d.createDocument.signatures[d.createDocument.signatures.length - 1];
    return { id: d.createDocument.id, publicId: sig?.public_id ?? null };
  }

  async situacao(id: string): Promise<SituacaoAutentique | null> {
    const d = await this.gql<{ document: null | {
      files: { signed: string | null } | null;
      signatures: { action: { name: string } | null; viewed: Ev | null; signed: Ev | null; rejected: Ev | null }[];
    } }>(`query { document(id: ${JSON.stringify(id)}) { files { signed } signatures { action { name } viewed { created_at } signed { created_at } rejected { created_at reason } } } }`);
    if (!d.document) return null;
    const sig = d.document.signatures.find((x) => (x.action?.name ?? '').toUpperCase() === 'SIGN') ?? d.document.signatures[0];
    return {
      visualizadoEm: sig?.viewed?.created_at ?? null, assinadoEm: sig?.signed?.created_at ?? null,
      recusadoEm: sig?.rejected?.created_at ?? null, motivoRecusa: sig?.rejected?.reason ?? null,
      arquivoAssinadoUrl: d.document.files?.signed ?? null,
    };
  }

  async reenviar(publicIds: string[]) {
    if (!publicIds.length) return;
    await this.gql(`mutation { resendSignatures(public_ids: ${JSON.stringify(publicIds)}) }`);
  }

  async linkAssinatura(publicId: string) {
    const d = await this.gql<{ createLinkToSignature: { short_link: string } }>(
      `mutation { createLinkToSignature(public_id: ${JSON.stringify(publicId)}) { short_link } }`);
    return d.createLinkToSignature.short_link;
  }

  async cancelar(id: string) {
    await this.gql(`mutation { deleteDocument(id: ${JSON.stringify(id)}) }`);
  }

  async baixar(url: string) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new ErroAutentique(`Não consegui baixar o documento assinado (${r.status}).`);
    return Buffer.from(await r.arrayBuffer());
  }
}
type Ev = { created_at: string | null; reason?: string | null };

/** Mensagens da API em português claro (as mais comuns). */
function traduzir(m: string): string {
  if (/too_many_resent_emails/i.test(m)) return 'A Autentique só deixa reenviar o lembrete depois de um tempo. Tente mais tarde.';
  if (/credit|insufficient|limit/i.test(m)) return 'Acabaram os documentos do seu plano na Autentique.';
  if (/unauthenticated|unauthorized/i.test(m)) return 'Token da Autentique inválido.';
  return `Autentique: ${m}`;
}
