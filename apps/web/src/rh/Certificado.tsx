import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { arquivoParaBase64 } from '../lib/download';
import type { InfoCertificado } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import css from './Certificado.module.css';

export function Certificado() {
  const [info, setInfo] = useState<InfoCertificado | null>(null);
  const [semCert, setSemCert] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function carregar() {
    setSemCert(false);
    try { setInfo(await api.get<InfoCertificado>('/certificado')); }
    catch { setSemCert(true); setInfo(null); }
  }
  useEffect(() => { void carregar(); }, []);

  async function enviar() {
    if (!arquivo) return;
    setErro(null); setOk(false); setEnviando(true);
    try {
      const pfxBase64 = await arquivoParaBase64(arquivo);
      await api.post('/certificado', { pfxBase64, senha });
      setOk(true); setArquivo(null); setSenha('');
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  const validade = info?.validade ? new Date(info.validade).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) : null;

  return (
    <div>
      <div className={css.head}><h2>Certificado digital</h2><p>ICP-Brasil A1 — usado para assinar AFD, AEJ e comprovantes</p></div>

      <div className={css.grid}>
        {!semCert && info && (
          <div className={css.statusCard}>
            <span className={css.lbl}>Certificado ativo · ICP-Brasil A1</span>
            <div className={css.cn}>{info.cn ?? '—'}</div>
            {validade && <div className={css.val}>válido até {validade} · guardado cifrado (AES-256)</div>}
            <div className={css.badge}>● assinando AFD, AEJ e comprovantes</div>
          </div>
        )}
        {semCert && (
          <div className={css.vazioCard}>
            <span className={css.lbl}>Nenhum certificado</span>
            <p>Sem certificado, os arquivos saem sem assinatura. Envie o .pfx do CNPJ pra habilitar a assinatura ICP-Brasil.</p>
          </div>
        )}

        <div className={css.drop}>
          <div className={css.big}>{semCert ? 'Enviar certificado' : 'Substituir certificado'}</div>
          <div className={css.sub}>Selecione o arquivo .pfx (ou .p12). A senha fica cifrada, nunca em texto puro.</div>
          <input ref={inputRef} type="file" accept=".pfx,.p12" hidden
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          <button className={css.selArq} onClick={() => inputRef.current?.click()}>
            {arquivo ? arquivo.name : 'Escolher arquivo .pfx'}
          </button>
          <Campo rotulo="Senha do certificado" type="password" value={senha}
            onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
          {erro && <p className={css.erro}>{erro}</p>}
          {ok && <p className={css.ok}>● certificado salvo e ativo</p>}
          <Botao variante="coral" onClick={enviar} disabled={enviando || !arquivo || !senha}>
            {enviando ? 'Validando e salvando…' : 'Enviar .pfx'}
          </Botao>
        </div>
      </div>
    </div>
  );
}
