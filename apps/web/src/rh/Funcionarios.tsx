import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { soDigitos } from '../lib/download';
import type {Empregado, Horario } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import { Modal } from '../components/Modal';
import css from './Funcionarios.module.css';

const fmtCpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

export function Funcionarios() {
  const [lista, setLista] = useState<Empregado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [addAberto, setAddAberto] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [pinPara, setPinPara] = useState<Empregado | null>(null);
  const [escalaPara, setEscalaPara] = useState<Empregado | null>(null);
  const [salarioPara, setSalarioPara] = useState<Empregado | null>(null);
  const [escala12Para, setEscala12Para] = useState<Empregado | null>(null);

  async function carregar() {
    try { setLista(await api.get<Empregado[]>('/empregados')); }
    catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, []);

  async function alternarAtivo(e: Empregado) {
    setMenu(null);
    await api.patch(`/empregados/${e.id}/ativo`, { ativo: !e.ativo }).catch(() => {});
  }

  const ativos = lista?.filter((e) => e.ativo).length ?? 0;

  return (
    <div onClick={() => setMenu(null)}>
      <div className={css.head}>
        <div><h2>Funcionários</h2><p>{lista ? `${ativos} ativos · quem bate ponto na Cliente A` : 'carregando…'}</p></div>
        <Botao variante="coral" className={css.add} onClick={() => setAddAberto(true)}>+ Adicionar funcionário</Botao>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.table}>
        <div className={`${css.row} ${css.thead}`}>
          <span>Nome</span><span>Matrícula</span><span>CPF</span><span>Horário</span><span>Status</span><span>PIN</span><span></span>
        </div>
        {lista?.length === 0 && <div className={css.vazio}>Ninguém cadastrado ainda. Adiciona o primeiro funcionário.</div>}
        {lista?.map((e) => (
          <div key={e.id} className={css.row}>
            <span className={css.nome}>{e.nome}</span>
            <span className={css.mono}>{e.matricula ?? '—'}</span>
            <span className={css.mono}>{fmtCpf(e.cpf)}</span>
            <span className={css.muted}>{e.horarioContratualId ? 'vinculado' : '—'}</span>
            <span className={`${css.status} ${e.ativo ? css.ativo : css.inativo}`}><span className={css.sdot} />{e.ativo ? 'Ativo' : 'Inativo'}</span>
            <span className={`${css.pin} ${e.temPin ? css.sim : css.nao}`}>{e.temPin ? '✓' : '—'}</span>
            <span className={css.kebabWrap} onClick={(ev) => { ev.stopPropagation(); setMenu(menu === e.id ? null : e.id); }}>
              <button className={css.kebab} aria-label="Ações">⋯</button>
              {menu === e.id && (
                <div className={css.menu} onClick={(ev) => ev.stopPropagation()}>
                  <button onClick={() => { setPinPara(e); setMenu(null); }}>Definir PIN</button>
                  <button onClick={() => { setEscalaPara(e); setMenu(null); }}>Definir escala</button>
                  <button onClick={() => { setSalarioPara(e); setMenu(null); }}>Definir salário</button>
                  <button onClick={() => { setEscala12Para(e); setMenu(null); }}>Gerar escala 12x36</button>
                  <button onClick={() => { void alternarAtivo(e).then(carregar); }}>{e.ativo ? 'Inativar' : 'Reativar'}</button>
                </div>
              )}
            </span>
          </div>
        ))}
      </div>

      {addAberto && <ModalAdicionar onFechar={() => setAddAberto(false)} onCriado={() => { setAddAberto(false); void carregar(); }} />}
      {pinPara && <ModalPin empregado={pinPara} onFechar={() => setPinPara(null)} onSalvo={() => { setPinPara(null); void carregar(); }} />}
      {escalaPara && <ModalEscala empregado={escalaPara} onFechar={() => setEscalaPara(null)} onSalvo={() => { setEscalaPara(null); void carregar(); }} />}
      {salarioPara && <ModalSalario empregado={salarioPara} onFechar={() => setSalarioPara(null)} onSalvo={() => { setSalarioPara(null); void carregar(); }} />}
      {escala12Para && <ModalEscala12x36 empregado={escala12Para} onFechar={() => setEscala12Para(null)} onSalvo={() => setEscala12Para(null)} />}
    </div>
  );
}

function ModalAdicionar({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [matricula, setMatricula] = useState('');
  const [pin, setPin] = useState('');
  const [salario, setSalario] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      const sal = salario ? Number(salario.replace(',', '.')) : undefined;
      await api.post('/empregados', {
        nome: nome.trim(), cpf: soDigitos(cpf),
        matricula: matricula.trim() || undefined,
        pin: pin.trim() || undefined,
        salarioMensal: sal,
      });
      onCriado();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo="Adicionar funcionário" onFechar={onFechar}>
      <Campo rotulo="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria Silva" />
      <Campo rotulo="CPF" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
      <Campo rotulo="Matrícula (opcional)" value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="001" />
      <Campo rotulo="PIN do quiosque (opcional)" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4 a 8 dígitos" />
      <Campo rotulo="Salário mensal (opcional)" inputMode="decimal" value={salario} onChange={(e) => setSalario(e.target.value)} placeholder="Ex.: 2200.00" />
      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || !nome || cpf.length < 11}>
        {enviando ? 'Salvando…' : 'Adicionar'}
      </Botao>
    </Modal>
  );
}

function ModalPin({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    setErro(null); setEnviando(true);
    try { await api.patch(`/empregados/${empregado.id}/pin`, { pin: pin.trim() }); onSalvo(); }
    catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`PIN de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <p className={css.pinInfo}>O PIN é o atalho pra bater ponto no tablet-quiosque. Fica guardado com hash.</p>
      <Campo rotulo="Novo PIN" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4 a 8 dígitos" />
      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || pin.length < 4}>
        {enviando ? 'Salvando…' : 'Salvar PIN'}
      </Botao>
    </Modal>
  );
}

function ModalEscala({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [sel, setSel] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.get<Horario[]>('/tratamento/horarios')
      .then((l) => { setHorarios(l); if (l[0]) setSel(l[0].id); })
      .catch((e) => setErro((e as Error).message));
  }, []);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/horario`, { horarioContratualId: sel });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Escala de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      {horarios.length === 0 ? (
        <p className={css.aviso}>Nenhuma escala cadastrada ainda. Crie uma em <strong>Escalas</strong> primeiro.</p>
      ) : (
        <label className={css.selWrap}>
          <span className={css.selLb}>Escala</span>
          <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
            {horarios.map((h) => <option key={h.id} value={h.id}>{h.codigo}</option>)}
          </select>
        </label>
      )}
      {erro && <p className={css.erroModal}>{erro}</p>}
      {horarios.length > 0 && (
        <Botao variante="coral" onClick={salvar} disabled={enviando || !sel}>{enviando ? 'Salvando…' : 'Vincular escala'}</Botao>
      )}
    </Modal>
  );
}

function ModalSalario({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [salario, setSalario] = useState(empregado.salarioMensal ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/salario`, { salarioMensal: Number(String(salario).replace(',', '.')) });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Salário de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <Campo rotulo="Salário mensal" inputMode="decimal" value={String(salario)} onChange={(e) => setSalario(e.target.value)} placeholder="Ex.: 2200.00" />
      <p className={css.aviso}>Usado para calcular extras, adicional noturno e descontos em R$ (divisor 220h).</p>
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || !salario}>{enviando ? 'Salvando…' : 'Salvar salário'}</Botao>
    </Modal>
  );
}

function ModalEscala12x36({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [dataInicio, setDataInicio] = useState('');
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function gerar() {
    setErro(null); setEnviando(true);
    try {
      const [a, m] = mes.split('-').map(Number);
      const ultimo = new Date(a!, m!, 0).getDate();
      const r = await api.post<{ gerados: number }>('/tratamento/escala/gerar-12x36', {
        empregadoId: empregado.id, inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}`, dataInicio,
      });
      setResultado(`${r.gerados} dias de trabalho gerados na competência.`);
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={`Escala 12x36 de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <p className={css.aviso}>Gera os dias trabalhados alternados (12h de trabalho, 36h de descanso) na competência.</p>
      <label className={css.selWrap}>
        <span className={css.selLb}>Competência</span>
        <input className={css.select} type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </label>
      <label className={css.selWrap}>
        <span className={css.selLb}>Primeiro dia de trabalho do ciclo</span>
        <input className={css.select} type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
      </label>
      {resultado && <p className={css.sucesso}>{resultado}</p>}
      {erro && <p className={css.erroModal}>{erro}</p>}
      {resultado
        ? <Botao variante="lime" onClick={onSalvo}>Concluir</Botao>
        : <Botao variante="coral" onClick={gerar} disabled={enviando || !dataInicio}>{enviando ? 'Gerando…' : 'Gerar escala'}</Botao>}
    </Modal>
  );
}
