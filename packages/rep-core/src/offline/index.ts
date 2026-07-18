/**
 * Resolução de hora e da flag online/offline de uma batida.
 *
 * O problema central: numa batida OFFLINE, a única hora que existe é a do
 * aparelho do funcionário — que ele controla. Não dá para confiar cegamente,
 * mas TAMBÉM não dá para recusar (restringir marcação é vedado pela Portaria).
 *
 * A saída legal é a que a própria norma prevê: o AFD tem campo para marcar se
 * a batida foi online ou offline. Registramos a hora do aparelho como a hora
 * da marcação, carimbamos a hora do servidor à parte, e deixamos a divergência
 * VISÍVEL — no espelho do RH e no arquivo fiscal. Não previne a fraude; torna
 * ela auditável, que é o teto do que um dispositivo sem lacre consegue.
 */

export interface EntradaBatida {
  /** Hora que o app afirma — do relógio do aparelho quando bateu. */
  dtAparelho?: Date | null;
  /** O app declarou que capturou offline? */
  declaradoOffline?: boolean;
}

export interface BatidaResolvida {
  /** Vai para o registro (dt_marcacao). É o instante que conta como a batida. */
  dtMarcacao: Date;
  /** Quando o servidor recebeu (dt_gravacao). Sempre confiável. */
  dtGravacao: Date;
  /** 0 = online, 1 = offline (igual ao enum OnlineOffline do shared). */
  onlineOffline: number;
  /** Diferença aparelho→servidor, em segundos. Positivo = aparelho atrasado. */
  defasagemSeg: number;
  /** A defasagem passou do tolerável — o RH deve olhar. */
  suspeita: boolean;
}

/** Acima disto, hora de aparelho destoando do servidor é digna de nota. */
const TOLERANCIA_SEG = 120;

/**
 * Decide a hora e a flag de uma batida.
 *
 * @param entrada  o que o app enviou
 * @param agora    hora do servidor (injetável para teste)
 */
export function resolverBatida(entrada: EntradaBatida, agora: Date = new Date()): BatidaResolvida {
  const dtGravacao = agora;

  // Sem hora de aparelho: batida online comum, hora é a do servidor.
  if (!entrada.dtAparelho) {
    return { dtMarcacao: dtGravacao, dtGravacao, onlineOffline: 0, defasagemSeg: 0, suspeita: false };
  }

  const defasagemSeg = Math.round((dtGravacao.getTime() - entrada.dtAparelho.getTime()) / 1000);

  // Offline: a hora do aparelho é a que existe. Marcamos como offline
  // justamente para a defasagem não passar despercebida.
  if (entrada.declaradoOffline) {
    return {
      dtMarcacao: entrada.dtAparelho, dtGravacao, onlineOffline: 1,
      defasagemSeg, suspeita: Math.abs(defasagemSeg) > TOLERANCIA_SEG,
    };
  }

  // Diz online, mas o relógio destoa além da latência de rede razoável:
  // registra como online (hora do servidor) e sinaliza para o RH.
  return {
    dtMarcacao: dtGravacao, dtGravacao, onlineOffline: 0,
    defasagemSeg, suspeita: Math.abs(defasagemSeg) > TOLERANCIA_SEG,
  };
}
