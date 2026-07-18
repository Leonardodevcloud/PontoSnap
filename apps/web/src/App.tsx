import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
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
import { LayoutRH } from './rh/LayoutRH';
import { PainelRH } from './rh/PainelRH';
import { Funcionarios } from './rh/Funcionarios';
import { Escalas } from './rh/Escalas';
import { Espelhos } from './rh/Espelhos';
import { ApuracaoCLT } from './rh/ApuracaoCLT';
import { Feriados } from './rh/Feriados';
import { Fiscal } from './rh/Fiscal';
import { Relatorios } from './rh/Relatorios';
import { Certificado } from './rh/Certificado';
import { Local } from './rh/Local';
import { BancoHoras } from './rh/BancoHoras';
import { Atestados } from './rh/Atestados';
import { Afastamentos } from './rh/Afastamentos';
import { Auditoria } from './rh/Auditoria';
import { Dispositivos } from './rh/Dispositivos';
import { LayoutMaster } from './master/LayoutMaster';
import { Clientes } from './master/Clientes';
import { Cobranca } from './master/Cobranca';
import { Assinatura } from './rh/Assinatura';
import { Quiosque } from './quiosque/Quiosque';
import { Flash } from './components/Flash';

const rotaInicial = (p: Perfil) => (p === 'COLABORADOR' ? '/' : p === 'MASTER' ? '/master' : '/rh');

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
  return (
    <Routes>
      <Route path="/login" element={carregando ? <Splash /> : sessao ? <Navigate to={rotaInicial(sessao.perfil)} replace /> : <Login />} />
      <Route path="/trocar-senha" element={<SoLogado><TrocarSenha /></SoLogado>} />
      <Route path="/recuperar-senha" element={<RecuperarSenha />} />
      <Route path="/redefinir" element={<RedefinirSenha />} />

      {/* Quiosque — tablet compartilhado, autenticado por token de dispositivo */}
      <Route path="/quiosque" element={<Quiosque />} />

      {/* Colaborador (mobile) */}
      <Route path="/" element={<Protegida perfis={['COLABORADOR']}><LayoutColaborador /></Protegida>}>
        <Route index element={<BaterPonto />} />
        <Route path="espelho" element={<EspelhoMes />} />
        <Route path="espelho/dia" element={<EspelhoDia />} />
        <Route path="escala" element={<MinhaEscala />} />
        <Route path="banco" element={<MeuBanco />} />
        <Route path="atestados" element={<MeusAtestados />} />
      </Route>

      {/* RH / Admin (desktop) */}
      <Route path="/rh" element={<Protegida perfis={PERFIS_RH}><LayoutRH /></Protegida>}>
        <Route index element={<PainelRH />} />
        <Route path="funcionarios" element={<Funcionarios />} />
        <Route path="escalas" element={<Escalas />} />
        <Route path="espelhos" element={<Espelhos />} />
        <Route path="apuracao" element={<ApuracaoCLT />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="feriados" element={<Feriados />} />
        <Route path="fiscal" element={<Fiscal />} />
        <Route path="certificado" element={<Certificado />} />
        <Route path="local" element={<Local />} />
        <Route path="banco" element={<BancoHoras />} />
        <Route path="atestados" element={<Atestados />} />
        <Route path="afastamentos" element={<Afastamentos />} />
        <Route path="auditoria" element={<Auditoria />} />
        <Route path="dispositivos" element={<Dispositivos />} />
        <Route path="assinatura" element={<Assinatura />} />
      </Route>

      {/* Master (desktop) */}
      <Route path="/master" element={<Protegida perfis={['MASTER']}><LayoutMaster /></Protegida>}>
        <Route index element={<Clientes />} />
        <Route path="cobranca" element={<Cobranca />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
