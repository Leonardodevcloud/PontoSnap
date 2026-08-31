import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { pushSuportado, estadoPermissao, temSubscriptionAtiva, ativarNotificacoes, desativarNotificacoes } from '../lib/push';
import css from './NotificacaoPrefs.module.css';

interface Prefs {
  lembreteAntes: boolean; lembreteMinutos: number;
  esqueceuEntrada: boolean; esqueceuAlmoco: boolean; esqueceuSaida: boolean;
  ajusteRespondido: boolean; atestadoAnalisado: boolean; espelhoDisponivel: boolean;
  resumoSemanal: boolean; bancoVencendo: boolean;
}

const DEFAULTS: Prefs = {
  lembreteAntes: true, lembreteMinutos: 10,
  esqueceuEntrada: true, esqueceuAlmoco: true, esqueceuSaida: true,
  ajusteRespondido: true, atestadoAnalisado: true, espelhoDisponivel: true,
  resumoSemanal: false, bancoVencendo: true,
};

export function NotificacaoPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [pushAtivo, setPushAtivo] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const p = await api.get<Prefs>('/notificacao/preferencias');
      setPrefs(p);
      const ativo = await temSubscriptionAtiva();
      setPushAtivo(ativo);
    } catch { /* usa defaults */ }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function salvar(campo: keyof Prefs, valor: boolean | number) {
    const novo = { ...prefs, [campo]: valor };
    setPrefs(novo);
    setSalvando(true);
    try { await api.put('/notificacao/preferencias', { [campo]: valor }); }
    catch { setPrefs(prefs); } // rollback
    finally { setSalvando(false); }
  }

  async function togglePush() {
    if (pushAtivo) {
      await desativarNotificacoes();
      setPushAtivo(false);
    } else {
      const ok = await ativarNotificacoes();
      setPushAtivo(ok);
    }
  }

  const suportado = pushSuportado();
  const negado = estadoPermissao() === 'denied';

  if (carregando) return <div className="appshell"><p style={{ padding: 24 }}>Carregando…</p></div>;

  return (
    <div className="appshell">
      <div className={css.h}>Notificações</div>
      <div className={css.sub}>Escolha o que você quer receber. Tudo fica salvo no seu perfil.</div>

      {!suportado && (
        <div className={css.aviso}>Este navegador não suporta notificações push.</div>
      )}
      {negado && (
        <div className={css.aviso}>Notificações bloqueadas nas configurações do navegador. Ative nas permissões do site.</div>
      )}

      {/* Master toggle */}
      <div className={css.master}>
        <div>
          <div className={css.masterTit}>Receber notificações</div>
          <div className={css.masterDesc}>{pushAtivo ? 'Ativo neste dispositivo' : 'Desativado'}</div>
        </div>
        <Toggle value={pushAtivo} onChange={togglePush} disabled={!suportado || negado} />
      </div>

      {/* Categorias */}
      <div className={css.cat}>
        <div className={css.catTit}>Lembretes de marcação</div>
        <Row ico="⏰" icoCor="lembrete" titulo="Lembrete antes do ponto"
          desc="Avisa antes de cada marcação pra você não esquecer."
          valor={prefs.lembreteAntes} onChange={(v) => salvar('lembreteAntes', v)}>
          <div className={css.extra}>
            <span>Avisar</span>
            <select value={prefs.lembreteMinutos} onChange={(e) => salvar('lembreteMinutos', Number(e.target.value))}>
              <option value={5}>5 min antes</option>
              <option value={10}>10 min antes</option>
              <option value={15}>15 min antes</option>
              <option value={30}>30 min antes</option>
            </select>
          </div>
        </Row>
      </div>

      <div className={css.cat}>
        <div className={css.catTit}>Esquecimentos</div>
        <Row ico="📍" icoCor="esqueceu" titulo="Não bateu a entrada"
          desc="Se a jornada começou e você ainda não bateu ponto."
          valor={prefs.esqueceuEntrada} onChange={(v) => salvar('esqueceuEntrada', v)} />
        <Row ico="🍽️" icoCor="esqueceu" titulo="Não bateu volta do almoço"
          desc="Se a batida de retorno do intervalo não apareceu."
          valor={prefs.esqueceuAlmoco} onChange={(v) => salvar('esqueceuAlmoco', v)} />
        <Row ico="🚪" icoCor="esqueceu" titulo="Não bateu a saída"
          desc="Se o horário de saída passou e falta a marcação."
          valor={prefs.esqueceuSaida} onChange={(v) => salvar('esqueceuSaida', v)} />
      </div>

      <div className={css.cat}>
        <div className={css.catTit}>RH e solicitações</div>
        <Row ico="✅" icoCor="rh" titulo="Ajuste aprovado ou recusado"
          desc="Quando o RH responder sua solicitação de ajuste."
          valor={prefs.ajusteRespondido} onChange={(v) => salvar('ajusteRespondido', v)} />
        <Row ico="📋" icoCor="rh" titulo="Atestado analisado"
          desc="Quando o RH aprovar ou recusar seu atestado."
          valor={prefs.atestadoAnalisado} onChange={(v) => salvar('atestadoAnalisado', v)} />
        <Row ico="📄" icoCor="rh" titulo="Espelho disponível"
          desc="Quando a competência fechar e o espelho estiver pronto pra assinar."
          valor={prefs.espelhoDisponivel} onChange={(v) => salvar('espelhoDisponivel', v)} />
      </div>

      <div className={css.cat}>
        <div className={css.catTit}>Resumos</div>
        <Row ico="📊" icoCor="resumo" titulo="Resumo semanal"
          desc="Toda sexta, um resumo das suas horas e saldo da semana."
          valor={prefs.resumoSemanal} onChange={(v) => salvar('resumoSemanal', v)} />
        <Row ico="⚠️" icoCor="resumo" titulo="Banco de horas vencendo"
          desc="Avisa 30 dias antes de vencer horas no banco."
          valor={prefs.bancoVencendo} onChange={(v) => salvar('bancoVencendo', v)} />
      </div>

      {salvando && <div className={css.salvando}>Salvando…</div>}
    </div>
  );
}

// ── Componentes auxiliares ──

function Row({ ico, icoCor, titulo, desc, valor, onChange, children }: {
  ico: string; icoCor: string; titulo: string; desc: string;
  valor: boolean; onChange: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <div className={css.row}>
      <div className={`${css.rowIco} ${css[icoCor] ?? ''}`}>{ico}</div>
      <div className={css.rowBody}>
        <div className={css.rowTit}>{titulo}</div>
        <div className={css.rowDesc}>{desc}</div>
        {valor && children}
      </div>
      <Toggle value={valor} onChange={onChange} />
    </div>
  );
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={css.toggle}>
      <input type="checkbox" checked={value} onChange={() => onChange(!value)} disabled={disabled} />
      <span className={css.track} />
    </label>
  );
}
