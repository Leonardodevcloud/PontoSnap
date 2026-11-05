/**
 * Base de conhecimento do Argos: CLT (com artigos), as regras de cálculo do
 * PontoSnap em português, e um modelo de convenção coletiva (CCT) que o RH
 * completa. Embutida como código para ir no bundle (o build é tsc, não copia .md).
 *
 * Cada item tem um código (citável na resposta), título, tags (para a busca
 * simples por palavra) e o texto. É a fundação; dá para crescer e, na Fase 2,
 * virar base editável pela tela com embeddings.
 */
export interface ItemConhecimento {
  codigo: string;
  titulo: string;
  tags: string[];
  texto: string;
  /** CLT/legislação, regra do sistema, ou convenção coletiva. */
  fonte: 'CLT' | 'SISTEMA' | 'CCT';
}

export const BASE_CONHECIMENTO: ItemConhecimento[] = [
  // ───────────────────────── CLT / legislação ─────────────────────────
  {
    codigo: 'CLT-JORNADA', fonte: 'CLT', titulo: 'Jornada normal e horas extras',
    tags: ['jornada', 'hora extra', 'extra', 'adicional', 'horas', '44 horas', '8 horas'],
    texto:
      'Jornada normal: até 8 horas por dia e 44 por semana (CF art. 7º, XIII; CLT art. 58). ' +
      'O que passa disso é hora extra, limitada a 2 horas extras por dia (CLT art. 59). ' +
      'A hora extra tem adicional de no mínimo 50% sobre a hora normal (CF art. 7º, XVI); a convenção coletiva pode fixar percentual maior. ' +
      'Trabalho em domingo e feriado sem folga compensatória é pago em dobro (100%), salvo previsão de compensação.',
  },
  {
    codigo: 'CLT-TOLERANCIA', fonte: 'CLT', titulo: 'Tolerância de marcação (5 min / 10 min dia)',
    tags: ['tolerancia', 'tolerância', 'atraso', '5 minutos', '10 minutos', 'minutos residuais'],
    texto:
      'Não são descontadas nem contadas como extra as variações de até 5 minutos por marcação, com o limite de 10 minutos por dia (CLT art. 58, §1º; Súmula 366 do TST). ' +
      'Ultrapassado o limite do dia, conta-se o período integral (desde o primeiro minuto), não só o que excede a tolerância.',
  },
  {
    codigo: 'CLT-INTERVALO', fonte: 'CLT', titulo: 'Intervalo intrajornada (almoço) — Art. 71',
    tags: ['intervalo', 'almoço', 'almoco', 'intrajornada', 'descanso', 'art 71', 'intervalo curto', 'indenização'],
    texto:
      'Jornada acima de 6 horas: intervalo mínimo de 1 hora (pode ser reduzido a 30 minutos por convenção coletiva ou autorização do MTE). ' +
      'Jornada de 4 a 6 horas: intervalo de 15 minutos (CLT art. 71 e §1º). ' +
      'Jornada de até 4 horas: sem intervalo obrigatório. ' +
      'Se o intervalo mínimo não for concedido (total ou parcialmente), o empregador paga APENAS o período suprimido, com acréscimo de 50%, e essa parcela tem natureza indenizatória (CLT art. 71, §4º, redação da Lei 13.467/2017). ' +
      'Não é hora extra, não reflete em outras verbas e não pode ir para o banco de horas.',
  },
  {
    codigo: 'CLT-INTERJORNADA', fonte: 'CLT', titulo: 'Intervalo interjornada (11h entre jornadas)',
    tags: ['interjornada', '11 horas', 'descanso entre jornadas'],
    texto: 'Entre duas jornadas deve haver no mínimo 11 horas consecutivas de descanso (CLT art. 66). A violação gera horas extras sobre o período suprimido (Súmula 110 do TST, por analogia ao art. 71, §4º).',
  },
  {
    codigo: 'CLT-DSR', fonte: 'CLT', titulo: 'Descanso semanal remunerado (DSR)',
    tags: ['dsr', 'descanso semanal', 'repouso', 'reflexo', 'falta'],
    texto:
      'Todo empregado tem direito a um descanso semanal remunerado de 24 horas, preferencialmente aos domingos (Lei 605/49; CF art. 7º, XV). ' +
      'As horas extras habituais refletem no cálculo do DSR (Súmula 172 do TST). ' +
      'Falta não justificada faz perder a remuneração do dia e também o DSR da semana.',
  },
  {
    codigo: 'CLT-NOTURNO', fonte: 'CLT', titulo: 'Adicional e hora noturna',
    tags: ['noturno', 'adicional noturno', 'hora reduzida', '22h', '5h'],
    texto:
      'Trabalho noturno urbano é o prestado entre 22h e 5h, com adicional de no mínimo 20% sobre a hora diurna e hora reduzida de 52 minutos e 30 segundos (CLT art. 73). A convenção coletiva pode prever percentual maior.',
  },
  {
    codigo: 'CLT-BANCO', fonte: 'CLT', titulo: 'Banco de horas',
    tags: ['banco de horas', 'banco', 'compensação', 'compensacao', 'acordo'],
    texto:
      'O excesso de horas de um dia pode compensar a falta em outro (banco de horas). Por acordo individual escrito, a compensação deve ocorrer em até 6 meses; por convenção coletiva, em até 1 ano (CLT art. 59, §§ 2º, 5º e 6º). ' +
      'Horas não compensadas no prazo são pagas como extra, com o adicional. Enquanto vão para o banco, não são pagas em dinheiro na folha do mês.',
  },
  {
    codigo: 'CLT-12X36', fonte: 'CLT', titulo: 'Escala 12x36',
    tags: ['12x36', '12 por 36', 'escala', 'plantão'],
    texto: 'A jornada de 12 horas seguidas por 36 de descanso é lícita por acordo individual, convenção ou acordo coletivo (CLT art. 59-A). Nesse regime, os feriados e as prorrogações noturnas já são considerados compensados/remunerados pela própria escala.',
  },

  // ───────────────────────── Regras do PontoSnap ─────────────────────────
  {
    codigo: 'SIS-APURACAO', fonte: 'SISTEMA', titulo: 'Como o PontoSnap apura o dia',
    tags: ['apuração', 'apuracao', 'cálculo', 'calculo', 'como calcula', 'extra', 'atraso', 'espelho'],
    texto:
      'Para cada dia, o PontoSnap compara as marcações (batidas) com a escala vigente naquele dia e com o perfil de regra do funcionário. ' +
      'Apura: horas trabalhadas, horas extras (o que passa da jornada), atrasos/faltas (o que falta), intervalo, adicional noturno e feriado/domingo trabalhado. ' +
      'A tolerância configurada (CLT art. 58, §1º) é aplicada antes de gerar extra ou atraso. ' +
      'O resultado alimenta o espelho de ponto e a Folha CLT. A apuração é determinística: o mesmo conjunto de batidas e regras sempre dá o mesmo número.',
  },
  {
    codigo: 'SIS-INTERVALO', fonte: 'SISTEMA', titulo: 'Intervalo curto e indenização no PontoSnap',
    tags: ['intervalo curto', 'intervalo', 'almoço', 'indenização', 'art 71', 'faixa'],
    texto:
      'O PontoSnap escolhe a faixa de intervalo pela JORNADA CONTRATADA do dia (esperado), não pelas horas efetivamente trabalhadas: acima de 6h exige o intervalo cheio; de 4 a 6h, 15 minutos. ' +
      'Dias de descanso e sábados de meio turno sem jornada acima do limite não disparam a regra. ' +
      'Quando o intervalo é menor que o mínimo da faixa, o sistema indeniza apenas o tempo suprimido com 50% (Art. 71, §4º) — parcela indenizatória, que NÃO é hora extra e não vai para o banco. ' +
      'Há uma tolerância de intervalo configurável: supressões até o valor tolerado não geram indenização.',
  },
  {
    codigo: 'SIS-BANCO', fonte: 'SISTEMA', titulo: 'Destinação (banco x pagamento) no PontoSnap',
    tags: ['banco', 'destinação', 'destinacao', 'pago', 'extra', 'dsr'],
    texto:
      'Pelo perfil de regra, a hora extra do funcionário pode ser PAGA na folha (com adicional e reflexo no DSR) ou ir para o BANCO de horas (não entra em dinheiro no mês). ' +
      'No fechamento, o espelho e a Folha CLT separam o que foi pago do que foi para o banco. Quando o banco compensa no mês e sobra saldo positivo, essa sobra é paga como extra; se fecha negativo, desconta pela hora, sem adicional.',
  },
  {
    codigo: 'SIS-FERIADO', fonte: 'SISTEMA', titulo: 'Feriado e domingo trabalhado',
    tags: ['feriado', 'domingo', 'dobra', '100%', 'feriado trabalhado'],
    texto:
      'Trabalho em feriado ou domingo sem compensação é tratado como verba própria (100%), à parte da hora extra comum. ' +
      'No fechamento do mês essa verba aparece separada da hora extra, para que o valor da extra "pura" fique claro.',
  },
  {
    codigo: 'SIS-TOLERANCIA', fonte: 'SISTEMA', titulo: 'Tolerância configurável no PontoSnap',
    tags: ['tolerância', 'tolerancia', 'minutos', 'atraso', 'config'],
    texto:
      'A tolerância diária de atraso (padrão legal: 10 min/dia, 5 min por marcação — CLT art. 58, §1º) é configurável por perfil. ' +
      'Há também uma tolerância de intervalo, separada, para pequenas supressões de almoço. Ambas são aplicadas antes de gerar extra, atraso ou indenização.',
  },

  // ───────────────────────── Convenção coletiva (modelo) ─────────────────────────
  {
    codigo: 'CCT-MODELO', fonte: 'CCT', titulo: 'Convenção coletiva (a preencher pelo RH)',
    tags: ['cct', 'convenção', 'convencao', 'sindicato', 'acordo coletivo'],
    texto:
      'MODELO — substitua pelos valores da convenção coletiva aplicável à categoria. ' +
      'Campos típicos: adicional de hora extra (ex.: 50% nas primeiras, 100% acima de X); adicional noturno; valor e regras do intervalo (se há redução autorizada); banco de horas (prazo de compensação); pisos salariais; VR/VA e VT; adicional de insalubridade/periculosidade; estabilidades. ' +
      'Enquanto não preenchida, o Argos usa os pisos da CLT e avisa que a convenção específica não foi informada.',
  },
];

/** Busca simples por palavra (Fase 1, sem embeddings): pontua por tags e texto. */
export function buscarConhecimento(pergunta: string, limite = 4): ItemConhecimento[] {
  const termos = pergunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!termos.length) return [];
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pontuados = BASE_CONHECIMENTO.map((item) => {
    const alvoTags = item.tags.map(norm).join(' ');
    const alvoTexto = norm(`${item.titulo} ${item.texto}`);
    let p = 0;
    for (const t of termos) {
      if (alvoTags.includes(t)) p += 3;
      if (alvoTexto.includes(t)) p += 1;
    }
    return { item, p };
  }).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
  return pontuados.slice(0, limite).map((x) => x.item);
}
