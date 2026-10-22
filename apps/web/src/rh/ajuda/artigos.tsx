import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Aviso, Botao, Campo, Grade, Legenda, Opcao, TabelaSemana, Tela } from './simula';
import { ARTIGOS_ROTINA } from './artigos-rotina';
import css from './Ajuda.module.css';

export type Categoria = 'CONFIGURAR' | 'PESSOAS' | 'MES';
export interface Artigo {
  slug: string; titulo: string; resumo: string; cat: Categoria; minutos: number;
  /** Palavras que a busca também encontra (sinônimos, termos do dia a dia). */
  busca: string;
  /** Telas em que este é o artigo do botão "Ajuda desta tela". */
  rotas: string[];
  secoes: { id: string; titulo: string }[];
  Corpo: () => JSX.Element;
}

// ───────────────────────── peças de texto ─────────────────────────

export function Sec({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return <section id={`s-${id}`} className={css.sec} aria-labelledby={`h-${id}`}><h3 id={`h-${id}`}>{titulo}</h3>{children}</section>;
}
export function Ir({ to, children }: { to: string; children: ReactNode }) {
  return <Link className={css.ir} to={to}>{children} →</Link>;
}
export function Passos({ children }: { children: ReactNode }) { return <ol className={css.passos}>{children}</ol>; }
export function Ver({ slug, children }: { slug: string; children: ReactNode }) { return <Link className={css.verTb} to={`/rh/ajuda/${slug}`}>{children}</Link>; }

// ───────────────────────── compensar horas ─────────────────────────

function CompensarHoras() {
  return (
    <>
      <p className={css.lead}>Compensar é deixar a hora a mais de um dia cobrir a hora a menos de outro, em vez de <b>pagar</b> a extra e <b>descontar</b> o atraso separadamente. No PontoSnap isso acontece em <b>4 níveis</b>. Quanto mais à direita, mais longe a compensação vai.</p>
      <Sec id="niveis" titulo="Os 4 níveis de compensação">
        <div className={css.escada}>
          <div className={css.degSempre}><small>Nível 1 · sempre ligado</small><b>Dentro do dia</b><span>Chegou 30 min atrasado e saiu 30 min depois: zera. Não precisa configurar nada.</span><em>automático</em></div>
          <div><small>Nível 2</small><b>Dentro da semana</b><span>Estica a segunda e sai cedo na sexta. Conta o total de seg a dom. Não precisa de acordo de banco.</span><em>Escala › Compensa na semana</em></div>
          <div><small>Nível 3</small><b>Dentro do mês</b><span>Extras e atrasos do mês se anulam. Sobrou: paga como extra. Faltou: desconta (ou passa pro mês seguinte).</span><em>Regra › Compensa no mês</em></div>
          <div><small>Nível 4</small><b>Acumula (banco)</b><span>O saldo passa de um mês para o outro para virar folga. Vence no prazo do acordo (individual até 6 meses, coletivo até 12).</span><em>Regra › Acumula</em></div>
        </div>
        <Aviso><b>Contrato de horas não é compensação.</b> Ele só tira o horário fixo: a pessoa entra e sai quando quiser e vale a carga do dia. Sozinho, cada dia fecha separado: 9h num dia é 1h extra paga, 7h no outro é 1h de atraso descontada. Para os dias se compensarem, combine com o nível 2, 3 ou 4.</Aviso>
      </Sec>
      <Sec id="exemplo" titulo="Exemplo: a mesma semana, carga de 8h por dia">
        <TabelaSemana />
      </Sec>
      <Sec id="passos" titulo="Passo a passo">
        <h4 className={css.passoH}><span>1</span>Na escala, escolha o tipo de jornada (e se compensa na semana)</h4>
        <Tela caminho="Escalas › Editar escala">
          <Grade>
            <Opcao titulo="Horário fixo" sub="Tem hora para entrar e sair" />
            <Opcao titulo="Contrato de horas" sub="Vale só a carga do dia" on marca="a" />
          </Grade>
          <Opcao radio={false} titulo="Compensa na semana" sub="Conta o total da semana (seg → dom)" on marca="b" />
        </Tela>
        <Legenda itens={[['a', 'Contrato de horas só se a pessoa não tem hora marcada para entrar e sair.'], ['b', 'Marque para os dias se compensarem dentro da semana, sem banco.']]} />
        <Ir to="/rh/escalas">Abrir Escalas</Ir>

        <h4 className={css.passoH}><span>2</span>Na regra de cálculo, escolha o banco de horas</h4>
        <Tela caminho="Regras de cálculo › Editar perfil">
          <Opcao titulo="Igual à empresa" sub="Segue o acordo da empresa. Sem acordo = sem banco." />
          <Opcao titulo="Não compensa: toda hora extra é paga" />
          <Opcao titulo="Compensa no mês e paga a diferença" on marca="c" />
          <Opcao titulo="Acumula no banco, para folgar depois" />
          <Grade><Campo rotulo="Quando falta o dia inteiro…" valor="Abater do banco de horas" marca="d" /><Campo rotulo="Quando chega atrasado…" valor="Abater do banco de horas" /></Grade>
        </Tela>
        <Legenda itens={[['c', 'Para compensar no mês. Use "Acumula" se o saldo deve virar folga.'], ['d', 'Por padrão, falta de dia inteiro é descontada com DSR mesmo com banco. Mude aqui se ela também deve abater.']]} />
        <Ir to="/rh/regras">Abrir Regras de cálculo</Ir>

        <h4 className={css.passoH}><span>3</span>Ligue a escala e a regra no funcionário</h4>
        <p>Em <b>Funcionários</b>, no menu <b>⋯</b> da pessoa: <b>Definir escala</b> e <b>Perfil de regra</b>. Quem fica sem perfil usa o perfil <b>padrão</b> da empresa; se não houver padrão, vale a CLT pura, sem banco.</p>
        <p>Mais rápido: o <Ver slug="assistente">assistente</Ver> faz as perguntas, escolhe a escala e a regra certas e aplica em várias pessoas de uma vez.</p>
      </Sec>
      <Sec id="armadilhas" titulo='Armadilhas: "achei que estava configurado"'>
        <ul className={css.armadilhas}>
          <li><b>A pessoa não tem perfil e não existe perfil padrão.</b> Ela cai na CLT pura: nada compensa entre dias.</li>
          <li><b>Contrato de horas sem banco e sem "compensa na semana".</b> Cada dia fecha sozinho. É o caso mais comum.</li>
          <li><b>Banco "igual à empresa" com a empresa sem acordo.</b> Fica sem banco. O acordo da empresa é definido em Banco de horas (só o administrador). A tela de regras mostra o que vale hoje.</li>
          <li><b>Falta inteira não abate do banco por padrão.</b> Fez +8h na semana e faltou um dia: paga 8h e desconta o dia, com DSR. Para abater, mude "Quando falta o dia inteiro".</li>
          <li><b>Atraso configurado para "descontar" com banco ligado.</b> A hora a mais vai para o banco e o atraso é descontado: os dois não se encontram.</li>
          <li><b>Mudou a regra, mas o mês já tinha sido fechado.</b> Mês fechado não muda sozinho. Abra o mês em Ponto do mês para recalcular.</li>
          <li><b>"Compensa na semana" e a última semana do mês.</b> A semana fecha no domingo; se ele cai no mês seguinte, o resultado aparece lá. Não é erro.</li>
          <li><b>Escala 12x36.</b> "Compensa na semana" não vale para 12x36.</li>
        </ul>
      </Sec>
      <Sec id="conferir" titulo="Conferir se funcionou">
        <p>Em <b>Funcionários</b>, cada pessoa mostra uma etiqueta com como as horas dela compensam ("não compensa", "compensa na semana", "compensa no mês", "acumula no banco"). Clique nela para ver o <b>raio-x</b>: escala, perfil, banco e faltas/atrasos, de onde vem cada um e o que está causando o problema.</p>
        <Ir to="/rh/funcionarios?comp=NAO_COMPENSA">Ver quem precisa de atenção</Ir>
      </Sec>
    </>
  );
}

// ───────────────────────── escalas ─────────────────────────

function Escalas() {
  return (
    <>
      <p className={css.lead}>A escala diz <b>quanto</b> e <b>quando</b> a pessoa deve trabalhar. Sem escala, o sistema não sabe a carga do dia e não calcula extra, atraso nem falta.</p>
      <Sec id="tipos" titulo="Os tipos de jornada">
        <ul className={css.lista}>
          <li><b>Horário fixo</b> — tem hora para entrar e sair (ex.: 8h às 17h). Chegar depois é atraso; sair depois é extra. Atraso e extra do mesmo dia se anulam.</li>
          <li><b>Contrato de horas</b> — entra e sai quando quiser; vale só a <b>carga do dia</b>. Acima dela é extra, abaixo é atraso. Os horários viram só referência (lembretes e espelho). Sozinho, <b>não compensa entre dias</b>.</li>
          <li><b>12x36</b> — trabalha 12h e descansa 36h. Escolha "12x36" em Regime e use <b>Gerar escala 12x36</b> no funcionário para montar o calendário.</li>
        </ul>
      </Sec>
      <Sec id="criar" titulo="Criar uma escala">
        <Tela caminho="Escalas › Nova escala">
          <Grade><Campo rotulo="Código" valor="CH-COMERCIAL" marca="a" /><Campo rotulo="Jornada/dia" valor="8h00" /></Grade>
          <Campo rotulo="Dias úteis" valor="Seg · Ter · Qua · Qui · Sex" marca="b" />
          <Grade><Opcao titulo="Horário fixo" on /><Opcao titulo="Contrato de horas" /></Grade>
          <Grade><Campo rotulo="Entrada → saída" valor="08:00 → 12:00" /><Campo rotulo="Entrada → saída" valor="13:00 → 17:00" /></Grade>
          <Opcao radio={false} titulo="Jornada diferente por dia" sub="ex.: sábado menor" marca="c" />
          <Opcao radio={false} titulo="Compensa na semana" sub="conta o total de seg a dom" marca="d" />
        </Tela>
        <Legenda itens={[
          ['a', 'Um nome curto que diga o que é: ele aparece na lista de funcionários.'],
          ['b', 'Os dias em que a pessoa deve trabalhar. Os outros são descanso.'],
          ['c', 'Quando um dia tem carga diferente (ex.: sábado de 4h).'],
          ['d', 'Os dias da semana se compensam: dia sem batida não é falta se a semana fechar a carga; acima de 10h num dia é extra naquele dia.'],
        ]} />
        <Ir to="/rh/escalas">Abrir Escalas</Ir>
      </Sec>
      <Sec id="semana" titulo="Compensa na semana, em detalhe">
        <ul className={css.lista}>
          <li>A semana vai de <b>segunda a domingo</b> e fecha no domingo.</li>
          <li>Passou da carga da semana: <b>hora extra</b> (ou banco, conforme a regra). Ficou abaixo: <b>atraso</b>.</li>
          <li>Só vira <b>falta</b> quando a semana fica devendo um dia inteiro (falta tira o DSR).</li>
          <li>Acima de <b>10h num dia</b> é extra naquele dia, mesmo compensando na semana.</li>
          <li>Domingo, feriado e dia de folga ficam fora da conta da semana.</li>
          <li>A tolerância é de 10 minutos <b>na semana</b>, não por dia.</li>
        </ul>
      </Sec>
      <Sec id="trocar" titulo="Trocar a escala de alguém sem mexer no passado">
        <p>Em <b>Funcionários › ⋯ › Definir escala</b> há dois jeitos:</p>
        <ul className={css.lista}>
          <li><b>Mudar a partir de uma data</b> — a pessoa trocou de escala. Os dias antes da data continuam calculados com a escala antiga. <b>Use este na maioria dos casos.</b></li>
          <li><b>Corrigir cadastro</b> — a escala estava errada desde o começo. Vale para toda a apuração, inclusive o passado.</li>
        </ul>
        <Aviso tipo="aviso"><b>Editar uma escala</b> (em Escalas) muda o cálculo de todos que usam essa escala, inclusive o passado. Para mudar só algumas pessoas, crie uma escala nova e use "Mudar a partir de uma data".</Aviso>
      </Sec>
    </>
  );
}

// ───────────────────────── regras de cálculo ─────────────────────────

function Regras() {
  return (
    <>
      <p className={css.lead}>Um <b>perfil de regra</b> é um pacote pronto: hora extra, tolerância, adicional noturno, banco de horas, faltas e atrasos. Você cria uma vez e, no funcionário, escolhe com um clique. O que não personalizar segue a CLT.</p>
      <Sec id="padrao" titulo="O perfil padrão">
        <p>Marque <b>"Usar este perfil para quem não tiver perfil escolhido"</b> em um perfil. Todo funcionário sem perfil próprio passa a usar esse. Sem nenhum padrão, quem não tem perfil fica na <b>CLT pura</b> (sem banco).</p>
      </Sec>
      <Sec id="blocos" titulo="O que cada bloco faz">
        <ul className={css.lista}>
          <li><b>Horas extras</b> — quanto a mais se paga. CLT: 50% em dia útil, 100% em domingo e feriado.</li>
          <li><b>Tolerância de atraso</b> — pequenos atrasos que não são descontados. CLT: até 10 min por dia, no máximo 5 de cada vez.</li>
          <li><b>Adicional noturno</b> — CLT: 20% a mais das 22h às 5h.</li>
          <li><b>Banco de horas</b> — se a hora a mais compensa a hora a menos (abaixo).</li>
          <li><b>Faltas e atrasos</b> — se descontam, abatem do banco ou são abonados/tolerados.</li>
        </ul>
      </Sec>
      <Sec id="banco" titulo="Banco de horas: qual escolher">
        <ul className={css.lista}>
          <li><b>Igual à empresa</b> — segue o acordo de banco da empresa (Banco de horas, definido pelo administrador). A tela mostra o que vale hoje. Se a empresa não tem acordo, fica <b>sem banco</b>.</li>
          <li><b>Não compensa</b> — o mais simples: extra sempre paga, atraso sempre descontado.</li>
          <li><b>Compensa no mês</b> — extras e atrasos do mês se anulam. No fechamento, o que sobra é pago como extra; o que falta é descontado (ou passa para o mês seguinte, se você escolher).</li>
          <li><b>Acumula</b> — banco de horas de verdade: o saldo atravessa meses para virar folga. Precisa de acordo escrito: individual (até 6 meses) ou coletivo com o sindicato (até 12 meses).</li>
        </ul>
        <Aviso>Quer compensar só dentro da semana, sem banco? Isso fica na <b>escala</b>: "Compensa na semana".</Aviso>
      </Sec>
      <Sec id="faltas" titulo="Faltas e atrasos">
        <ul className={css.lista}>
          <li><b>Falta de dia inteiro</b>, por padrão, é <b>descontada da folha com o DSR</b> — mesmo com banco. Escolha "Abater do banco de horas" se ela também deve compensar.</li>
          <li><b>Atraso</b>, por padrão, abate do banco quando há banco. Se marcar "Descontar da folha" com banco ligado, a hora a mais vai para o banco e o atraso é descontado: eles <b>não se compensam</b>.</li>
          <li>Sem banco, "abater do banco" vira desconto na folha.</li>
        </ul>
      </Sec>
      <Sec id="mudar" titulo="Mudei a regra: o que acontece">
        <p>A regra vale para o cálculo a partir de agora, inclusive dos meses ainda abertos. Mês já fechado não muda sozinho: abra o mês em <b>Ponto do mês</b> para recalcular.</p>
        <Ir to="/rh/regras">Abrir Regras de cálculo</Ir>
      </Sec>
    </>
  );
}

// ───────────────────────── banco de horas ─────────────────────────

function BancoHoras() {
  return (
    <>
      <p className={css.lead}>O banco guarda a hora a mais para virar folga (ou ser paga no fim do mês, na regra "compensa no mês"). Quem tem banco e como ele funciona é decidido no <b>perfil de regra</b> de cada pessoa; o <b>acordo da empresa</b> vale para quem está com "igual à empresa".</p>
      <Sec id="acordo" titulo="Acordo da empresa">
        <p>Na tela <b>Banco de horas</b>, o administrador define o acordo da empresa (nenhum, individual ou coletivo, e o prazo). Ele só vale para os perfis com banco <b>"igual à empresa"</b>.</p>
        <Aviso tipo="aviso">Acordo da empresa "nenhum" + perfil "igual à empresa" = <b>sem banco</b>. É a causa mais comum de horas que não compensam.</Aviso>
      </Sec>
      <Sec id="como" titulo="Como o saldo é formado">
        <ul className={css.lista}>
          <li>Hora a mais do dia entra como <b>crédito</b>; atraso (e falta, se a regra mandar) entra como <b>débito</b>.</li>
          <li><b>Acumula:</b> o saldo passa de mês; o crédito mais antigo é usado primeiro e o que vence no prazo é pago.</li>
          <li><b>Compensa no mês:</b> no fechamento do mês, o saldo positivo é pago como extra e o banco zera; o negativo é descontado ou passa para o mês seguinte.</li>
          <li>Dia com batida faltando (ímpar) não entra no banco até ser ajustado.</li>
        </ul>
        <Ir to="/rh/banco">Abrir Banco de horas</Ir>
      </Sec>
    </>
  );
}

// ───────────────────────── cadastrar funcionário ─────────────────────────

function CadastrarFuncionario() {
  return (
    <>
      <p className={css.lead}>A ordem importa: sem escala o ponto não é calculado, e sem perfil vale o padrão da empresa (ou a CLT pura). Siga os passos e confira no raio-x.</p>
      <Sec id="ordem" titulo="Passo a passo">
        <Passos>
          <li><b>Adicionar</b> — em Funcionários, "+ Adicionar funcionário": nome, CPF, matrícula (opcional), PIN do quiosque, salário, data em que começa a bater ponto e e-mail para o app. Muitos de uma vez: "Importar planilha".</li>
          <li><b>Escala</b> — "⋯ › Definir escala". Sem escala, nada é calculado. Veja <Ver slug="escalas">qual tipo usar</Ver>.</li>
          <li><b>Perfil de regra</b> — "⋯ › Perfil de regra". Sem perfil próprio, usa o padrão da empresa. Veja <Ver slug="compensar-horas">compensar horas</Ver>.</li>
          <li><b>Salário</b> — "⋯ › Definir salário" (vale a partir de uma data). Usado para valorizar extras e descontos.</li>
          <li><b>Início do ponto</b> — "⋯ › Início do ponto": dias antes dessa data não são cobrados (útil na migração ou admissão).</li>
          <li><b>Acesso</b> — "⋯ › Criar acesso ao app" ou "Definir PIN" para o quiosque. Veja <Ver slug="acesso-app">acesso ao app e quiosque</Ver>.</li>
          <li><b>Conferir</b> — "⋯ › Como as horas contam" mostra o raio-x: escala, perfil, banco e o efeito.</li>
        </Passos>
        <Tela caminho="Funcionários › ⋯">
          <Grade n={3}><Botao sec>Definir PIN</Botao><Botao sec>Criar acesso ao app</Botao><Botao sec marca="1">Definir escala</Botao><Botao sec marca="2">Perfil de regra</Botao><Botao sec>Definir salário</Botao><Botao sec>Início do ponto</Botao><Botao sec marca="3">Como as horas contam</Botao></Grade>
        </Tela>
        <Ir to="/rh/funcionarios">Abrir Funcionários</Ir>
      </Sec>
    </>
  );
}

function Assistente() {
  return (
    <>
      <p className={css.lead}>Responda 4 perguntas sobre o que foi combinado com o funcionário. O assistente diz qual escala e qual regra usar, cria o que faltar e aplica em uma ou várias pessoas.</p>
      <Ir to="/rh/ajuda/assistente">Abrir o assistente</Ir>
    </>
  );
}

// ───────────────────────── registro ─────────────────────────

export const ARTIGOS: Artigo[] = [
  { slug: 'compensar-horas', titulo: 'Fazer as horas compensarem uma pela outra', cat: 'CONFIGURAR', minutos: 5,
    resumo: 'Os 4 níveis (dia, semana, mês, banco), o exemplo de uma semana e as armadilhas que fazem achar que está configurado.',
    busca: 'compensar compensação compensa horas não compensam banco de horas contrato de horas semana mês extra atraso saldo',
    rotas: [], Corpo: CompensarHoras,
    secoes: [{ id: 'niveis', titulo: 'Os 4 níveis' }, { id: 'exemplo', titulo: 'Exemplo de uma semana' }, { id: 'passos', titulo: 'Passo a passo' }, { id: 'armadilhas', titulo: 'Armadilhas comuns' }, { id: 'conferir', titulo: 'Conferir se funcionou' }] },
  { slug: 'escalas', titulo: 'Escalas: horário fixo, contrato de horas e 12x36', cat: 'CONFIGURAR', minutos: 4,
    resumo: 'Qual tipo usar, como criar, compensar na semana e trocar a escala sem mexer no passado.',
    busca: 'escala horário jornada carga contrato de horas flexível 12x36 sábado compensa semana trocar escala',
    rotas: ['/rh/escalas'], Corpo: Escalas,
    secoes: [{ id: 'tipos', titulo: 'Tipos de jornada' }, { id: 'criar', titulo: 'Criar uma escala' }, { id: 'semana', titulo: 'Compensa na semana' }, { id: 'trocar', titulo: 'Trocar sem mexer no passado' }] },
  { slug: 'regras', titulo: 'Regras de cálculo (perfis)', cat: 'CONFIGURAR', minutos: 4,
    resumo: 'Perfil padrão, hora extra, tolerância, noturno, banco de horas e o que fazer com faltas e atrasos.',
    busca: 'perfil regra cálculo hora extra tolerância noturno banco faltas atrasos dsr padrão clt',
    rotas: ['/rh/regras'], Corpo: Regras,
    secoes: [{ id: 'padrao', titulo: 'O perfil padrão' }, { id: 'blocos', titulo: 'O que cada bloco faz' }, { id: 'banco', titulo: 'Banco: qual escolher' }, { id: 'faltas', titulo: 'Faltas e atrasos' }, { id: 'mudar', titulo: 'Mudei a regra' }] },
  { slug: 'banco-de-horas', titulo: 'Banco de horas', cat: 'MES', minutos: 3,
    resumo: 'Acordo da empresa, como o saldo é formado, prazo e fechamento do mês.',
    busca: 'banco de horas saldo folga acordo individual coletivo prazo vencer crédito débito',
    rotas: ['/rh/banco'], Corpo: BancoHoras,
    secoes: [{ id: 'acordo', titulo: 'Acordo da empresa' }, { id: 'como', titulo: 'Como o saldo é formado' }] },
  { slug: 'cadastrar-funcionario', titulo: 'Cadastrar um funcionário do jeito certo', cat: 'PESSOAS', minutos: 3,
    resumo: 'A ordem dos passos: adicionar, escala, perfil, salário, início do ponto, acesso e conferir.',
    busca: 'cadastrar funcionário novo admissão adicionar importar planilha escala perfil salário pin',
    rotas: ['/rh/funcionarios'], Corpo: CadastrarFuncionario,
    secoes: [{ id: 'ordem', titulo: 'Passo a passo' }] },
  { slug: 'assistente', titulo: 'Assistente: o que esse funcionário precisa?', cat: 'CONFIGURAR', minutos: 1,
    resumo: '4 perguntas e o sistema escolhe a escala e a regra certas.',
    busca: 'assistente configurar ajuda escolher qual escala qual regra',
    rotas: [], Corpo: Assistente, secoes: [] },
  ...ARTIGOS_ROTINA,
];

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function buscarArtigos(termo: string): Artigo[] {
  const t = sem(termo).split(/\s+/).filter((x) => x.length > 1);
  if (!t.length) return [];
  return ARTIGOS.map((a) => {
    const tit = sem(a.titulo), txt = sem(`${a.resumo} ${a.busca}`);
    const pts = t.reduce((s, p) => s + (tit.includes(p) ? 3 : txt.includes(p) ? 1 : 0), 0);
    return { a, pts, todos: t.every((p) => tit.includes(p) || txt.includes(p)) };
  }).filter((x) => x.todos && x.pts > 0).sort((x, y) => y.pts - x.pts).map((x) => x.a);
}
export function artigoDaRota(pathname: string): Artigo | undefined {
  const p = pathname.replace(/\/$/, '');
  return ARTIGOS.find((a) => a.rotas.includes(p)) ?? ARTIGOS.find((a) => a.rotas.some((r) => p.startsWith(`${r}/`)));
}
