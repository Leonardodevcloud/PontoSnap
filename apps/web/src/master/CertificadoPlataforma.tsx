import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import css from './CertificadoPlataforma.module.css';

interface Status {
  configurado: boolean;
  cn?: string;
  validade?: string | null;
}

const fmtData = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

const diasPara = (iso?: string | null) => {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
};

export function CertificadoPlataforma() {
  const [status, setStatus] = useState<Status | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setStatus(await api.get<Status>('/certificado/status')); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const dias = diasPara(status?.validade);
  const vencido = dias != null && dias < 0;
  const vencendo = dias != null && dias >= 0 && dias <= 30;

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <h1 className={css.h}>Certificado da plataforma</h1>
        <p className={css.sub}>
          O e-CPF que assina o AFD, o AEJ e os comprovantes de <strong>todos</strong> os clientes.
          É um só — o seu, como desenvolvedor. Não é enviado por aqui: fica em variável de ambiente.
        </p>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      {status && !status.configurado && (
        <div className={css.card}>
          <div className={css.semCert}>
            <span className={css.pill}>Não configurado</span>
            <p className={css.semTxt}>
              Sem o certificado, os arquivos fiscais saem <strong>sem assinatura</strong>. Configure as
              variáveis de ambiente no servidor (Railway) para habilitar a assinatura ICP-Brasil.
            </p>
          </div>
          <div className={css.comoBox}>
            <p className={css.comoTit}>Como configurar</p>
            <ol className={css.passos}>
              <li>Converta o seu <code>.pfx</code> em base64:
                <div className={css.cmd}>PowerShell: <code>[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) &gt; cert.b64.txt</code></div>
                <div className={css.cmd}>Linux/Mac: <code>base64 -w0 cert.pfx &gt; cert.b64.txt</code></div>
              </li>
              <li>No Railway, adicione as variáveis:
                <div className={css.env}><code>PLATAFORMA_CERT_PFX_B64</code> = conteúdo do arquivo base64</div>
                <div className={css.env}><code>PLATAFORMA_CERT_SENHA</code> = a senha do .pfx</div>
              </li>
              <li>Faça o redeploy. Esta tela vai mostrar o certificado carregado.</li>
            </ol>
          </div>
        </div>
      )}

      {status?.configurado && (
        <div className={css.card}>
          <div className={`${css.faixa} ${vencido ? css.fVenc : vencendo ? css.fAviso : css.fOk}`}>
            {vencido ? '⚠ Certificado vencido — os arquivos assinados serão recusados. Renove com urgência.'
              : vencendo ? `⚠ Vence em ${dias} dia(s). Renove antes para não interromper a assinatura.`
              : '✓ Certificado ativo e assinando os arquivos fiscais.'}
          </div>
          <div className={css.linha}><span className={css.lb}>Titular (CN)</span><span className={css.val}>{status.cn ?? '—'}</span></div>
          <div className={css.linha}><span className={css.lb}>Válido até</span><span className={css.val}>{fmtData(status.validade)}</span></div>
          <p className={css.trocar}>
            Para trocar (renovação anual), atualize <code>PLATAFORMA_CERT_PFX_B64</code> e
            <code> PLATAFORMA_CERT_SENHA</code> no Railway e refaça o deploy.
          </p>
        </div>
      )}
    </div>
  );
}
