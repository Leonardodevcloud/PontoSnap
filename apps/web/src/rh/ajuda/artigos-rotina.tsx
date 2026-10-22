import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Aviso, Botao, Campo, Grade, Legenda, Opcao, Tela } from './simula';
import css from './Ajuda.module.css';
import type { Artigo } from './artigos';

// Peças locais (as de artigos.tsx importariam este arquivo de volta).
function Sec({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return <section id={`s-${id}`} className={css.sec} aria-labelledby={`h-${id}`}><h3 id={`h-${id}`}>{titulo}</h3>{children}</section>;
}
const Ir = ({ to, children }: { to: string; children: ReactNode }) => <Link className={css.ir} to={to}>{children} →</Link>;
const Ver = ({ slug, children }: { slug: string; children: ReactNode }) => <Link className={css.verTb} to={`/rh/ajuda/${slug}`}>{children}</Link>;
const L = ({ children }: { children: ReactNode }) => <ul className={css.lista}>{children}</ul>;

// ───────────────────────── acesso ─────────────────────────

function AcessoApp() {
  return (
    <>
      <p className={css.lead}>O funcionário pode bater ponto de dois jeitos: pelo <b>app no celular</b> (com e-mail e senha) ou no <b>quiosque</b> (tablet da empresa, com matrícula + PIN). Pode ter os dois.</p>
      <Sec id="app" titulo="App no celular">
        <L>
          <li>Em Funcionários, <b>⋯ › Criar acesso ao app</b> (ou informe o e-mail no cadastro). O sistema gera uma <b>senha provisória</b>, manda por e-mail e mostra na tela uma única vez — use "Copiar credenciais" para mandar por WhatsApp.</li>
          <li>O funcionário entra com o e-mail e a senha provisória e o app pede para ele criar a senha dele.</li>
          <li>Esqueceu a senha: "Esqueci minha senha" no login, ou o RH usa <b>⋯ › Resetar senha do app</b> (a senha antiga deixa de funcionar).</li>
          <li>Para bater, ele <b>segura o botão</b> "Bater ponto" e escolhe a marcação. Sem internet, a batida fica guardada e sobe quando a rede volta.</li>
        </L>
      </Sec>
      <Sec id="quiosque" titulo="Quiosque (tablet)">
        <Tela caminho="Configurações › Quiosques">
          <Grade><Campo rotulo="Nome do quiosque" valor="Portaria" marca="a" /><Botao marca="b">Gerar token</Botao></Grade>
        </Tela>
        <Legenda itens={[['a', 'Um nome para saber onde está o tablet.'], ['b', 'O token aparece uma vez só: copie e cole no tablet, em /quiosque, e toque em "Ativar quiosque".']]} />
        <L>
          <li>Cada funcionário precisa de <b>matrícula</b> e <b>PIN</b> (⋯ › Definir PIN, de 4 a 8 dígitos).</li>
          <li>No tablet: digita a matrícula, depois o PIN. Aparece o nome e "Ponto registrado".</li>
        </L>
        <Ir to="/rh/dispositivos">Abrir Quiosques</Ir>
      </Sec>
      <Sec id="local" titulo="Batida fora do local">
        <p>A batida <b>nunca é bloqueada</b> (a lei não permite). Se a empresa tem local e raio cadastrados, fora do raio o app pede uma observação. Veja <Ver slug="local">Local e cerca</Ver>.</p>
      </Sec>
    </>
  );
}

function Local() {
  return (
    <>
      <p className={css.lead}>O local da empresa serve para o app saber quando pedir uma observação ao funcionário. <b>A batida nunca é bloqueada.</b> Empresa remota pode ficar sem local.</p>
      <Sec id="definir" titulo="Definir o local">
        <Tela caminho="Configurações › Local e cerca">
          <Campo rotulo="Endereço" valor="Av. Tancredo Neves, 1000 — Salvador" />
          <Grade n={3}><Campo rotulo="Latitude" valor="-12,98" /><Campo rotulo="Longitude" valor="-38,45" /><Campo rotulo="Raio em metros" valor="1000" marca="a" /></Grade>
          <Botao sec marca="b">Usar a localização deste aparelho</Botao>
        </Tela>
        <Legenda itens={[['a', 'Recomendado: 1000 m. Fora do raio o app pede observação; dentro, bate direto.'], ['b', 'Abra a tela no escritório e toque aqui, ou busque o endereço no mapa e arraste o pino.']]} />
        <Ir to="/rh/local">Abrir Local e cerca</Ir>
      </Sec>
    </>
  );
}

function Feriados() {
  return (
    <>
      <p className={css.lead}>O calendário de feriados evita que o dia conte como falta e faz o trabalho no feriado valer como extra de feriado (100% pela CLT).</p>
      <Sec id="cadastrar" titulo="Cadastrar">
        <p>Em <b>Feriados</b>: data, nome e tipo (Nacional, Estadual ou Municipal) → "+ Adicionar". Cadastre os municipais da sua cidade — eles não vêm prontos. A lista mostra um ano por vez.</p>
        <Aviso tipo="aviso">"remover" apaga na hora, sem pedir confirmação.</Aviso>
        <Ir to="/rh/feriados">Abrir Feriados</Ir>
      </Sec>
    </>
  );
}

// ───────────────────────── dia a dia ─────────────────────────

function Pedidos() {
  return (
    <>
      <p className={css.lead}>Pedidos são o que o funcionário manda pelo app: <b>ajustes de ponto</b> (esqueceu de bater, bateu errado) e <b>atestados</b>. Nada muda na apuração até o RH decidir, e a batida original nunca é apagada.</p>
      <Sec id="ajustes" titulo="Ajustes de ponto">
        <L>
          <li>Em <b>Pedidos › Ajustes de ponto</b>, filtro "Pendentes". Cada pedido mostra "Como está hoje" e "Como fica se aprovar".</li>
          <li><b>Aprovar</b> vale na hora. <b>Recusar</b> pede um motivo, que o funcionário vê.</li>
          <li>Se aparecer "Confira antes de aprovar — a posição não bate", a batida pedida cairia em outra posição do dia (ex.: ele marcou entrada, mas pela ordem seria saída).</li>
          <li>O RH também lança direto: "+ Lançar ajuste" (incluir, corrigir ou tirar batida). Já nasce valendo, com motivo na auditoria.</li>
        </L>
        <Ir to="/rh/ajustes">Abrir Ajustes de ponto</Ir>
      </Sec>
      <Sec id="atestados" titulo="Atestados">
        <L>
          <li><b>Abonar a ausência</b> faz o dia deixar de contar como falta. <b>Recusar</b> pede motivo.</li>
          <li>Funcionário entregou no papel? "Lançar atestado no lugar do funcionário" (com foto ou PDF).</li>
        </L>
        <Ir to="/rh/atestados">Abrir Atestados</Ir>
      </Sec>
      <Sec id="faltando" titulo="Batidas faltando">
        <p>Dia com número ímpar de batidas fica <b>pendente</b>: não conta falta, atraso nem banco até ser ajustado. Em <b>Ponto do mês › Batidas faltando</b>, "Ajustar" lança a batida que falta (já com o horário previsto) e "Notificar funcionários" manda um aviso no celular de quem tem pendência.</p>
        <Ir to="/rh/batidas-faltando">Abrir Batidas faltando</Ir>
      </Sec>
    </>
  );
}

function Afastamentos() {
  return (
    <>
      <p className={css.lead}>Sem lançar as férias, quem sai de férias aparece com um mês inteiro de falta. Lançando, os dias deixam de ser esperados: não viram falta nem saldo negativo.</p>
      <Sec id="lancar" titulo="Lançar">
        <p>Funcionário, tipo (Férias, Afastamento INSS, Licença-maternidade, Licença-paternidade, Suspensão ou Outro), de/até e observação → "Lançar". "Apagar" remove na hora.</p>
        <Ir to="/rh/afastamentos">Abrir Férias e afastamentos</Ir>
      </Sec>
    </>
  );
}

function PontoDoMes() {
  return (
    <>
      <p className={css.lead}><b>Espelhos</b> mostram a jornada de cada um, dia a dia. <b>Apuração CLT</b> é o fechamento pelo motor de regras: extras, noturno, faltas, atrasos, banco e valores.</p>
      <Sec id="espelhos" titulo="Espelhos">
        <L>
          <li>"Todos os funcionários" mostra o mês de todo mundo; "Um funcionário" abre os dias. Clique num dia para ver as batidas e lançar ajuste.</li>
          <li>"Espelhos em lote (ZIP)" e "Exportar XLSX" baixam tudo de uma vez.</li>
          <li>No fim do mês o funcionário assina o espelho no app ("Concordo e assino").</li>
        </L>
        <Ir to="/rh/espelhos">Abrir Espelhos</Ir>
      </Sec>
      <Sec id="apuracao" titulo="Apuração CLT">
        <L>
          <li>Com banco, a hora extra vai para o saldo e não entra em R$.</li>
          <li>Dia com batida em aberto fica pendente até o ajuste.</li>
          <li>Se o mês do banco mudou depois de fechado, aparece "Refazer agora".</li>
          <li>"Apuração em lote (ZIP)" gera um PDF por pessoa.</li>
        </L>
        <Ir to="/rh/apuracao">Abrir Apuração CLT</Ir>
      </Sec>
      <Sec id="nao-bate" titulo="O número não bateu com o esperado?">
        <p>Quase sempre é escala ou regra. Abra o funcionário em <b>Funcionários › ⋯ › Como as horas contam</b> e veja <Ver slug="compensar-horas">compensar horas</Ver>.</p>
      </Sec>
    </>
  );
}

function FecharMes() {
  return (
    <>
      <p className={css.lead}>A ordem que evita retrabalho. O Início mostra o que ainda bloqueia o fechamento. Nos primeiros dias do mês, as telas abrem no mês anterior enquanto ele não é fechado.</p>
      <Sec id="ordem" titulo="Ordem do fechamento">
        <ol className={css.passos}>
          <li><b>Batidas faltando</b> — zere as pendências (dia ímpar não entra em nada).</li>
          <li><b>Pedidos</b> — decida ajustes e atestados.</li>
          <li><b>Férias e afastamentos</b> — confira se estão lançados.</li>
          <li><b>Ponto do mês</b> — confira espelhos e apuração.</li>
          <li><b>Folha e benefícios</b> — "Conferir folha" → "Gerar benefícios" → "Prestadores" → "Fechar mês". Os números ficam congelados; só o administrador reabre.</li>
          <li><b>Notas de prestadores</b> — liberar valores e conferir as notas.</li>
          <li><b>Assinaturas</b> — mandar espelho e contracheque para assinar.</li>
          <li><b>Relatórios e arquivos</b> — consolidado, AFD e AEJ.</li>
        </ol>
        <Ir to="/rh/pessoal">Abrir Folha e benefícios</Ir>
      </Sec>
      <Sec id="folha" titulo="Folha e benefícios em resumo">
        <L>
          <li><b>Folha CLT</b>: valor do dia = salário ÷ dias de trabalho do mês; extras, faltas e atrasos vêm do ponto.</li>
          <li><b>Benefícios</b> (VR/VA, VT, cesta): padrão da empresa ou valor próprio. A carga é do mês seguinte, com acerto do que não foi usado (falta, feriado, férias, atestado).</li>
          <li><b>Débitos</b>: parcelados ou fixos, descontados mês a mês.</li>
          <li><b>Fechar</b> congela os números ("retrato do fechamento"). Nota e pagamento ainda podem ser registrados.</li>
        </L>
      </Sec>
    </>
  );
}

function Prestadores() {
  return (
    <>
      <p className={css.lead}>MEI recebe por mês com nota fiscal; motorista recebe por semana. Depois do fechamento, os valores são liberados no app do prestador, que envia a nota por lá.</p>
      <Sec id="fluxo" titulo="O caminho da nota">
        <ol className={css.passos}>
          <li><b>Liberar valores</b> — em Notas de prestadores, depois de fechar a Folha.</li>
          <li>O prestador recebe o aviso no celular, com tudo o que vai na nota (do modelo de nota), e envia a NFS-e. O sistema lê o PDF/XML e confere valor, CNPJs, data, código do serviço e descrição.</li>
          <li><b>Conferir notas</b> — aprovar ou pedir correção.</li>
          <li><b>Pagar</b> — registrar o pagamento (Pix).</li>
        </ol>
        <Ir to="/rh/prestadores">Abrir Notas de prestadores</Ir>
      </Sec>
      <Sec id="modelos" titulo="Modelos de nota (tomador, código e descrição)">
        <p>Em <b>Notas de prestadores › Modelos de nota</b>, crie um modelo por operação (ex.: "Motoristas sob demanda"): tomador completo, código do serviço (ex.: 26.01.01) e o texto da descrição com campos automáticos — <b>mês</b>, <b>período</b>, <b>dias trabalhados</b>, nome, valor.</p>
        <ul className={css.lista}>
          <li>Marque o modelo como <b>padrão dos motoristas</b> (ou dos MEI): todo mundo do tipo já usa, inclusive quem entrar depois. Para uma operação diferente, use "Aplicar a pessoas".</li>
          <li><b>Dias trabalhados</b>: na Folha e benefícios, na semana do motorista, toque nos dias em que ele trabalhou. A nota sai com "(13/10 e 16/10)". Sem marcar, vai o período da semana.</li>
          <li>O texto é montado na hora de liberar e fica guardado com a nota. Mudou o modelo? Libere de novo: as notas ainda não enviadas pegam o texto novo.</li>
          <li>Na conferência, código do serviço errado é problema; descrição diferente só avisa (você decide).</li>
        </ul>
        <Ir to="/rh/prestadores/modelos">Abrir Modelos de nota</Ir>
      </Sec>
      <Sec id="uma-pessoa" titulo="Fechar uma pessoa sozinha (desligamento)">
        <p>No detalhe do prestador, "Fechar só esta pessoa": desligamento (último pagamento, com contrato proporcional) ou pagar antes do fechamento. O valor fica congelado e a nota é liberada na hora. Dá para reabrir se foi engano.</p>
      </Sec>
      <Sec id="acesso" titulo="Acesso do prestador">
        <p>"Dar acesso" gera um link de convite (por WhatsApp). O prestador abre, confere o e-mail, cria a senha e já entra.</p>
      </Sec>
    </>
  );
}

function Assinaturas() {
  return (
    <>
      <p className={css.lead}>Espelho de ponto e contracheque de cada funcionário enviados para assinar pela Autentique, por e-mail (ou WhatsApp para quem não tem e-mail), e guardados no app em Documentos.</p>
      <Sec id="passos" titulo="Passo a passo">
        <ol className={css.passos}>
          <li>Uma vez: o administrador conecta a Autentique em <b>Configurações › Integrações</b> (token da API). Comece no modo de teste.</li>
          <li><b>Subir contracheques</b> — um por pessoa ou todos de uma vez (PDFs ou ZIP). O sistema acha de quem é cada um pelo CPF ou nome; o que não achar, você escolhe.</li>
          <li><b>Fechar a Folha do mês</b> — o espelho só vai depois disso (é gerado na hora do envio).</li>
          <li><b>Enviar para assinar</b> — escolha como recebem, mensagem, lembrete e prazo.</li>
          <li>Acompanhe: o status muda sozinho (enviado → visualizou → assinou/recusou). "Lembrar" reenvia para quem não assinou.</li>
        </ol>
        <Aviso tipo="aviso">Trocar o contracheque de quem já recebeu cancela o documento na Autentique (o link antigo para de valer) e ele volta para enviar de novo.</Aviso>
        <Ir to="/rh/documentos">Abrir Assinaturas</Ir>
      </Sec>
    </>
  );
}

function Relatorios() {
  return (
    <>
      <p className={css.lead}><b>Relatórios</b>: consolidado do mês por funcionário (extras, noturno, faltas, atrasos e custo), em PDF e Excel. <b>Arquivos fiscais</b>: AFD e AEJ da competência, para fiscalização, também assinados com o certificado ICP-Brasil.</p>
      <Sec id="usar" titulo="Como usar">
        <p>Escolha o mês e "Gerar" (muitos funcionários: "2º plano"). O relatório usa o divisor de 220h e o DSR estimado: <b>não é a folha completa</b>.</p>
        <Ir to="/rh/relatorios">Abrir Relatórios</Ir>
      </Sec>
    </>
  );
}

function Comunicacao() {
  return (
    <>
      <p className={css.lead}>Avisos com texto, áudio, fotos e vídeo que chegam no app de todo mundo. Pode pedir ciência (fica registrado com data e hora), fazer enquete, fixar e agendar.</p>
      <Sec id="usar" titulo="Como usar">
        <p>"＋ Novo comunicado" → escreva, escolha quem recebe e se pede ciência → publicar ou agendar. A lista mostra quem leu e quem deu ciência.</p>
        <Ir to="/rh/comunicacao">Abrir Comunicação interna</Ir>
      </Sec>
    </>
  );
}

function Integracoes() {
  return (
    <>
      <p className={css.lead}>Só o administrador vê esta tela. Hoje: <b>Autentique</b>, para assinar espelho de ponto e contracheque.</p>
      <Sec id="autentique" titulo="Conectar a Autentique">
        <Tela caminho="Configurações › Integrações">
          <Campo rotulo="Token da API" valor="••••••••••••" marca="a" />
          <Opcao radio={false} titulo="Modo de teste" sub='Documentos com a marca "teste", sem gastar crédito' on marca="b" />
          <Campo rotulo="Endereço de retorno (webhook)" valor="https://api…/integracoes/autentique/retorno/…" marca="c" />
        </Tela>
        <Legenda itens={[['a', 'Gerado no painel da Autentique (Configurações › API). O sistema confere antes de salvar.'], ['b', 'Comece ligado. Desligue para os documentos valerem.'], ['c', 'Cole no painel da Autentique (Webhooks) para o status mudar na hora. Sem ele, o sistema confere a cada 30 minutos.']]} />
        <Ir to="/rh/integracoes">Abrir Integrações</Ir>
      </Sec>
    </>
  );
}

export const ARTIGOS_ROTINA: Artigo[] = [
  { slug: 'acesso-app', titulo: 'Acesso ao app, PIN e quiosque', cat: 'PESSOAS', minutos: 3, resumo: 'Senha provisória, primeiro acesso, resetar senha, PIN e tablet de quiosque.',
    busca: 'app celular senha provisória primeiro acesso login resetar pin quiosque tablet token matrícula', rotas: ['/rh/dispositivos'], Corpo: AcessoApp,
    secoes: [{ id: 'app', titulo: 'App no celular' }, { id: 'quiosque', titulo: 'Quiosque' }, { id: 'local', titulo: 'Batida fora do local' }] },
  { slug: 'local', titulo: 'Local e cerca', cat: 'CONFIGURAR', minutos: 2, resumo: 'Endereço e raio: quando o app pede observação (nunca bloqueia).',
    busca: 'local cerca raio gps endereço mapa localização distância', rotas: ['/rh/local'], Corpo: Local, secoes: [{ id: 'definir', titulo: 'Definir o local' }] },
  { slug: 'feriados', titulo: 'Feriados', cat: 'CONFIGURAR', minutos: 1, resumo: 'Calendário que evita falta e paga o feriado trabalhado.',
    busca: 'feriado municipal estadual nacional calendário', rotas: ['/rh/feriados'], Corpo: Feriados, secoes: [{ id: 'cadastrar', titulo: 'Cadastrar' }] },
  { slug: 'pedidos', titulo: 'Pedidos: ajustes, atestados e batidas faltando', cat: 'MES', minutos: 3, resumo: 'Aprovar ou recusar ajustes, abonar atestados e resolver dias pendentes.',
    busca: 'ajuste batida esqueceu atestado abonar recusar pendente ímpar faltando', rotas: ['/rh/ajustes', '/rh/atestados', '/rh/batidas-faltando'], Corpo: Pedidos,
    secoes: [{ id: 'ajustes', titulo: 'Ajustes de ponto' }, { id: 'atestados', titulo: 'Atestados' }, { id: 'faltando', titulo: 'Batidas faltando' }] },
  { slug: 'afastamentos', titulo: 'Férias e afastamentos', cat: 'PESSOAS', minutos: 1, resumo: 'Lançar para os dias não virarem falta.',
    busca: 'férias afastamento inss licença maternidade paternidade suspensão', rotas: ['/rh/afastamentos'], Corpo: Afastamentos, secoes: [{ id: 'lancar', titulo: 'Lançar' }] },
  { slug: 'ponto-do-mes', titulo: 'Ponto do mês: espelhos e apuração', cat: 'MES', minutos: 2, resumo: 'Conferir a jornada de todos, baixar espelhos e a apuração CLT.',
    busca: 'espelho apuração clt extras noturno faltas atrasos pdf zip xlsx', rotas: ['/rh/espelhos', '/rh/apuracao'], Corpo: PontoDoMes,
    secoes: [{ id: 'espelhos', titulo: 'Espelhos' }, { id: 'apuracao', titulo: 'Apuração CLT' }, { id: 'nao-bate', titulo: 'Não bateu?' }] },
  { slug: 'fechar-mes', titulo: 'Fechar o mês: a ordem certa', cat: 'MES', minutos: 3, resumo: 'Do ajuste das batidas à folha, notas, assinaturas e arquivos fiscais.',
    busca: 'fechar mês fechamento folha benefícios vr vt cesta débitos reabrir competência', rotas: ['/rh/pessoal'], Corpo: FecharMes,
    secoes: [{ id: 'ordem', titulo: 'Ordem do fechamento' }, { id: 'folha', titulo: 'Folha e benefícios' }] },
  { slug: 'prestadores', titulo: 'Notas de prestadores (MEI e motoristas)', cat: 'MES', minutos: 2, resumo: 'Liberar valores, conferir notas, pagar e fechar uma pessoa sozinha.',
    busca: 'prestador mei motorista nota fiscal nfs-e liberar pagar pix desligamento fechar pessoa modelo de nota tomador cnae código do serviço descrição dias trabalhados', rotas: ['/rh/prestadores', '/rh/prestadores/conferir', '/rh/prestadores/modelos'], Corpo: Prestadores,
    secoes: [{ id: 'fluxo', titulo: 'O caminho da nota' }, { id: 'modelos', titulo: 'Modelos de nota' }, { id: 'uma-pessoa', titulo: 'Fechar uma pessoa' }, { id: 'acesso', titulo: 'Acesso do prestador' }] },
  { slug: 'assinaturas', titulo: 'Assinaturas: espelho e contracheque', cat: 'MES', minutos: 2, resumo: 'Subir contracheques, enviar pela Autentique e acompanhar.',
    busca: 'assinatura autentique contracheque holerite espelho assinar documento', rotas: ['/rh/documentos'], Corpo: Assinaturas, secoes: [{ id: 'passos', titulo: 'Passo a passo' }] },
  { slug: 'relatorios', titulo: 'Relatórios e arquivos fiscais', cat: 'MES', minutos: 1, resumo: 'Consolidado do mês, AFD e AEJ.',
    busca: 'relatório consolidado afd aej fiscal fiscalização certificado', rotas: ['/rh/relatorios', '/rh/fiscal'], Corpo: Relatorios, secoes: [{ id: 'usar', titulo: 'Como usar' }] },
  { slug: 'comunicacao', titulo: 'Comunicação interna', cat: 'PESSOAS', minutos: 1, resumo: 'Avisos no app com ciência, enquete e agendamento.',
    busca: 'comunicado aviso ciência enquete mensagem', rotas: ['/rh/comunicacao'], Corpo: Comunicacao, secoes: [{ id: 'usar', titulo: 'Como usar' }] },
  { slug: 'integracoes', titulo: 'Integrações (Autentique)', cat: 'CONFIGURAR', minutos: 1, resumo: 'Token, modo de teste e webhook.',
    busca: 'integração autentique token webhook', rotas: ['/rh/integracoes'], Corpo: Integracoes, secoes: [{ id: 'autentique', titulo: 'Conectar a Autentique' }] },
];
