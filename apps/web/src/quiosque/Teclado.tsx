import css from './Teclado.module.css';

interface Props {
  onDigito: (d: string) => void;
  onApagar: () => void;
  onOk: () => void;
  okLabel: string;
  okDesabilitado?: boolean;
}

const TECLAS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];

export function Teclado({ onDigito, onApagar, onOk, okLabel, okDesabilitado }: Props) {
  return (
    <div className={css.pad}>
      {TECLAS.map((t) => <button key={t} className={css.key} onClick={() => onDigito(t)}>{t}</button>)}
      <button className={`${css.key} ${css.small}`} onClick={onApagar}>apagar</button>
      <button className={css.key} onClick={() => onDigito('0')}>0</button>
      <button className={`${css.key} ${css.go}`} onClick={onOk} disabled={okDesabilitado}>{okLabel}</button>
    </div>
  );
}
