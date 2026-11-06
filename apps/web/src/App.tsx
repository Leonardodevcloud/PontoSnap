import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { useAuth } from './lib/auth';
import type { Perfil } from './tipos';
import { Login } from './telas/Login';
import { RecuperarSenha } from './telas/RecuperarSenha';
import { RedefinirSenha } from './telas/RedefinirSenha';
import { TrocarSenha } from './telas/TrocarSenha';
import { BaterPonto } from './telas/BaterPonto';
import { LayoutColaborador } from './telas/LayoutColaborador';
import { EspelhoMes } from './telas/EspelhoMes';
import { MinhaEscala } from './telas/MinhaEscala';
import { MeuBanco } from './telas/MeuBanco';
import { MeusAtestados } from './telas/MeusAtestados';
import { EspelhoDia } from './telas/EspelhoDia';
import { NotificacaoPrefs } from './telas/NotificacaoPrefs';
import { LayoutRH } from './rh/LayoutRH';
import { Inicio } from './rh/Inicio';
import { Funcionarios } from './rh/Funcionarios';
import { Escalas } from './rh/Escalas';
import { Transferencias } from './rh/Transferencias';
import { Feriados } from './rh/Feriados';
import { Local } from './rh/Local';
import { Atestados } from './rh/Atestados';
import { Afastamentos } from './rh/Afastamentos';
import Perfis from './rh/Perfis';
import AjustesPonto from './rh/AjustesPonto';
import { BatidasFaltando } from './rh/BatidasFaltando';
import { Usuarios } from './rh/Usuarios';
import { UsuariosCliente } from './master/UsuariosCliente';
import { Dispositivos } from './rh/Dispositivos';
import { Notificacoes } from './rh/Notificacoes';
import { Comunicacao } from './rh/Comunicacao';
import { ComunicadoEditor } from './rh/ComunicadoEditor';
import { ComunicadoDetalhe } from './rh/ComunicadoDetalhe';
import { Avisos, Aviso } from './telas/Avisos';
import { LayoutMaster } from './master/LayoutMaster';
import { Clientes } from './master/Clientes';
import { Cobranca } from './master/Cobranca';
import { Acessos } from './master/Acessos';
import { CertificadoPlataforma } from './master/CertificadoPlataforma';
import { Assinatura } from './rh/Assinatura';
import { Quiosque } from './quiosque/Quiosque';
import { LayoutPrestador } from './prestador/LayoutPrestador';
import { InicioPrestador, NotasPrestador, NotaPrestador, MenuPrestador } from './prestador/TelasPrestador';
import { EnviarNota } from './prestador/EnviarNota';
import { PrimeiroAcesso } from './prestador/PrimeiroAcesso';
import { ComMesPadrao } from './lib/mesPadrao';
import { Integracoes } from './rh/Integracoes';
import { MeusDocumentos } from './telas/MeusDocumentos';
import { MeusHolerites } from './telas/MeusHolerites';
import { CentralAjuda } from './rh/ajuda/CentralAjuda';
import { ArtigoPagina } from './rh/ajuda/ArtigoPagina';
import { Assistente } from './rh/ajuda/Assistente';
import { Flash } from './components/Flash';
import { BarraProgresso } from './components/BarraProgresso';

// Telas pesadas carregam em pedaços próprios (code splitting): o pacote inicial
// fica pequeno e cada tela só traz seu código e suas libs (QR, PDF…) quando precisa.
// O prefetch ocioso (abaixo) já baixa esses pedaços logo após o login, então ao
// clicar a tela já está pronta — sem espera e sem o monólito pesando em tudo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyRh = <T extends Record<string, unknown>>(carregar: () => Promise<T>, nome: keyof T) =>
  lazy(() => carregar().then((m) => ({ default: m[nome] as ComponentType<any> })));

const Espelhos = lazyRh(() => import('./rh/Espelhos'), 'Espelhos');
const ApuracaoCLT = lazyRh(() => import('./rh/ApuracaoCLT'), 'ApuracaoCLT');
const GestaoPessoal = lazyRh(() => import('./rh/GestaoPessoal'), 'GestaoPessoal');
const Prestadores = lazyRh(() => import('./rh/Prestadores'), 'Prestadores');
const BancoHoras = lazyRh(() => import('./rh/BancoHoras'), 'BancoHoras');
const Relatorios = lazyRh(() => import('./rh/Relatorios'), 'Relatorios');
const Fiscal = lazyRh(() => import('./rh/Fiscal'), 'Fiscal');
const Auditoria = lazyRh(() => import('./rh/Auditoria'), 'Auditoria');
const DocsAssinatura = lazyRh(() => import('./rh/DocsAssinatura'), 'DocsAssinatura');
const ConferirNotas = lazyRh(() => import('./rh/ConferirNotas'), 'ConferirNotas');
const ModelosNota = lazyRh(() => import('./rh/ModelosNota'), 'ModelosNota');

/** Baixa os pedaços das telas pesadas no tempo ocioso, para o clique ser instantâneo. */
function prefetchTelasRh() {
  const chunks = [
    () => import('./rh/Espelhos'), () => import('./rh/ApuracaoCLT'), () => import('./rh/GestaoPessoal'),
    () => import('./rh/Prestadores'), () => import('./rh/BancoHoras'), () => import('./rh/Relatorios'),
    () => import('./rh/Fiscal'), () => import('./rh/DocsAssinatura'), () => import('./rh/Auditoria'),
  ];
  const ocioso = (cb: () => void) =>
    (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 2500 }) : window.setTimeout(cb, 500));
  for (const c of chunks) ocioso(() => { void c().catch(() => undefined); });
}

const rotaInicial = (p: Perfil) => (p === 'COLABORADOR' || p === 'PRESTADOR' ? '/' : p === 'MASTER' ? '/master' : '/rh');

function Splash() {
  return (
    <div className="appshell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Flash tamanho={64} girando />
    </div>
  );
}

/** Exige sessão; força troca de senha pendente; checa perfis. */
function Protegida({ perfis, children }: { perfis?: Perfil[]; children: ReactNode }) {
  const { sessao, carregando } = useAuth();
  if (carregando) return <Splash />;
  if (!sessao) return <Navigate to="/login" replace />;
  if (sessao.deveTrocarSenha) return <Navigate to="/trocar-senha" replace />;
  if (perfis && !perfis.includes(sessao.perfil)) return <Navigate to={rotaInicial(sessao.perfil)} replace />;
  return <>{children}</>;
}

/** Só exige sessão (usada na troca de senha, que não pode se auto-redirecionar). */
function SoLogado({ children }: { children: ReactNode }) {
  const { sessao, carregando } = useAuth();
  if (carregando) return <Splash />;
  if (!sessao) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const PERFIS_RH: Perfil[] = ['RH', 'ADMIN_CLIENTE'];

export function App() {
  const { sessao, carregando } = useAuth();
  // Login feito e é RH/Admin: baixa os pedaços das telas pesadas no tempo ocioso,
  // para que ao navegar elas já estejam prontas (clique instantâneo).
  useEffect(() => {
    if (sessao?.perfil === 'RH' || sessao?.perfil === 'ADMIN_CLIENTE') prefetchTelasRh();
  }, [sessao?.perfil]);
  // As rotas do "/" dependem do perfil (funcionário x prestador): espera a
  // sessão voltar antes de montar, senão um link direto (/notas, /avisos/…)
  // cairia no "*" e voltaria para o início.
  if (carregando) return <Splash />;
  return (
    <>
    <BarraProgresso />
    <Suspense fallback={<Splash />}>
    <Routes>
      <Route path="/login" element={carregando ? <Splash /> : sessao ? <Navigate to={rotaInicial(sessao.perfil)} replace /> : <Login />} />
      <Route path="/trocar-senha" element={<SoLogado><TrocarSenha /></SoLogado>} />
      <Route path="/recuperar-senha" element={<RecuperarSenha />} />
      <Route path="/redefinir" element={<RedefinirSenha />} />

      {/* Quiosque — tablet compartilhado, autenticado por token de dispositivo */}
      <Route path="/quiosque" element={<Quiosque />} />

      {/* Convite do prestador (público: o código + CPF/CNPJ são a credencial) */}
      <Route path="/c/:codigo" element={<PrimeiroAcesso />} />

      {sessao?.perfil === 'PRESTADOR' ? (
        /* Prestador MEI/motorista (mobile): app restrito, sem bater ponto */
        <Route path="/" element={<Protegida perfis={['PRESTADOR']}><LayoutPrestador /></Protegida>}>
          <Route index element={<InicioPrestador />} />
          <Route path="notas" element={<NotasPrestador />} />
          <Route path="notas/:id" element={<NotaPrestador />} />
          <Route path="notas/:id/enviar" element={<EnviarNota />} />
          <Route path="avisos" element={<Avisos />} />
          <Route path="avisos/:id" element={<Aviso />} />
          <Route path="menu" element={<MenuPrestador />} />
        </Route>
      ) : (
      /* Colaborador (mobile) */
      <Route path="/" element={<Protegida perfis={['COLABORADOR']}><LayoutColaborador /></Protegida>}>
        <Route index element={<BaterPonto />} />
        <Route path="espelho" element={<EspelhoMes />} />
        <Route path="espelho/dia" element={<EspelhoDia />} />
        <Route path="escala" element={<MinhaEscala />} />
        <Route path="banco" element={<MeuBanco />} />
        <Route path="atestados" element={<MeusAtestados />} />
        <Route path="notificacoes" element={<NotificacaoPrefs />} />
        <Route path="avisos" element={<Avisos />} />
        <Route path="avisos/:id" element={<Aviso />} />
        <Route path="documentos" element={<MeusDocumentos />} />
        <Route path="documentos/:id" element={<MeusDocumentos />} />
        <Route path="holerites" element={<MeusHolerites />} />
      </Route>
      )}

      {/* RH / Admin (desktop) */}
      <Route path="/rh" element={<Protegida perfis={PERFIS_RH}><LayoutRH /></Protegida>}>
        <Route index element={<Inicio />} />
        <Route path="funcionarios" element={<Funcionarios />} />
        <Route path="transferencias" element={<Transferencias />} />
        <Route path="escalas" element={<Escalas />} />
        <Route path="espelhos" element={<ComMesPadrao><Espelhos /></ComMesPadrao>} />
        <Route path="apuracao" element={<ComMesPadrao><ApuracaoCLT /></ComMesPadrao>} />
        <Route path="pessoal" element={<ComMesPadrao><GestaoPessoal /></ComMesPadrao>} />
        <Route path="debitos" element={<ComMesPadrao><GestaoPessoal key="debitos" soDebitos /></ComMesPadrao>} />
        <Route path="prestadores" element={<ComMesPadrao><Prestadores /></ComMesPadrao>} />
        <Route path="prestadores/conferir" element={<ConferirNotas />} />
        <Route path="prestadores/modelos" element={<ModelosNota />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="feriados" element={<Feriados />} />
        <Route path="fiscal" element={<Fiscal />} />
        <Route path="local" element={<Local />} />
        <Route path="banco" element={<BancoHoras />} />
        <Route path="atestados" element={<Atestados />} />
        <Route path="afastamentos" element={<Afastamentos />} />
        <Route path="regras" element={<Perfis />} />
        <Route path="ajustes" element={<AjustesPonto />} />
        <Route path="batidas-faltando" element={<BatidasFaltando />} />
        <Route path="auditoria" element={<Auditoria />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="dispositivos" element={<Dispositivos />} />
        <Route path="notificacoes" element={<Notificacoes />} />
        <Route path="comunicacao" element={<Comunicacao />} />
        <Route path="comunicacao/novo" element={<ComunicadoEditor key="novo" />} />
        <Route path="comunicacao/:id" element={<ComunicadoDetalhe />} />
        <Route path="comunicacao/:id/editar" element={<ComunicadoEditor />} />
        <Route path="assinatura" element={<Assinatura />} />
        <Route path="documentos" element={<ComMesPadrao><DocsAssinatura /></ComMesPadrao>} />
        <Route path="integracoes" element={<Integracoes />} />
        <Route path="ajuda" element={<CentralAjuda />} />
        <Route path="ajuda/assistente" element={<Assistente />} />
        <Route path="ajuda/:slug" element={<ArtigoPagina />} />
      </Route>

      {/* Master (desktop) */}
      <Route path="/master" element={<Protegida perfis={['MASTER']}><LayoutMaster /></Protegida>}>
        <Route index element={<Clientes />} />
        <Route path="cobranca" element={<Cobranca />} />
        <Route path="acessos" element={<Acessos />} />
        <Route path="clientes/:id/usuarios" element={<UsuariosCliente />} />
        <Route path="certificado" element={<CertificadoPlataforma />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </>
  );
}
