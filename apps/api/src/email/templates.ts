/**
 * Templates de e-mail. HTML inline (e-mail não lê CSS externo nem variáveis),
 * com as cores da marca cravadas em hex: coral #FF6B4A, ink #10403F,
 * cream #FFF8EE, peach #FFE2D1.
 */

function moldura(conteudo: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FFF8EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8EE;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(16,64,63,.08);">
        <tr><td style="background:#10403F;padding:22px 32px;">
          <span style="color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:-.01em;">Ponto<span style="color:#FF6B4A;">Snap</span></span>
        </td></tr>
        <tr><td style="padding:32px;color:#10403F;">${conteudo}</td></tr>
        <tr><td style="padding:0 32px 28px;">
          <p style="margin:0;color:#5C4F49;font-size:12px;line-height:1.5;">
            Este é um e-mail automático do PontoSnap. Se você não esperava por ele, pode ignorá-lo com segurança.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function botao(texto: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr><td style="border-radius:12px;background:#FF6B4A;">
    <a href="${url}" style="display:inline-block;padding:13px 26px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">${texto}</a>
  </td></tr></table>`;
}

/** Recuperação de senha: link com token, validade curta. */
export function emailRecuperacao(nome: string, url: string): { assunto: string; html: string } {
  return {
    assunto: 'Redefinir sua senha do PontoSnap',
    html: moldura(`
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;">Redefinir senha</h1>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">Olá${nome ? `, ${nome}` : ''}!</p>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#5C4F49;">
        Recebemos um pedido para redefinir sua senha. Clique no botão abaixo para criar uma nova.
        O link vale por <strong style="color:#10403F;">1 hora</strong>.
      </p>
      ${botao('Criar nova senha', url)}
      <p style="margin:0;font-size:13px;line-height:1.6;color:#5C4F49;">
        Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.
      </p>`),
  };
}

/** Boas-vindas do funcionário: primeiro acesso com senha provisória. */
export function emailAcessoFuncionario(nome: string, email: string, senha: string, urlApp: string): { assunto: string; html: string } {
  return {
    assunto: 'Seu acesso ao PontoSnap',
    html: moldura(`
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;">Seu acesso está pronto</h1>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">Olá${nome ? `, ${nome}` : ''}!</p>
      <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#5C4F49;">
        Sua empresa criou seu acesso para bater o ponto pelo celular. Use os dados abaixo no primeiro login:
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;width:100%;background:#FFF8EE;border-radius:12px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:13px;color:#5C4F49;">E-mail</p>
          <p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#10403F;">${email}</p>
          <p style="margin:0 0 6px;font-size:13px;color:#5C4F49;">Senha provisória</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#FF6B4A;font-family:'SF Mono',Menlo,monospace;letter-spacing:.02em;">${senha}</p>
        </td></tr>
      </table>
      <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#5C4F49;">
        No primeiro acesso você vai criar sua própria senha.
      </p>
      ${botao('Abrir o PontoSnap', urlApp)}`),
  };
}
