# site/ — landing page do PontoSnap

HTML puro, sem build. Projeto **separado** no Vercel (o app fica em `apps/web`).

## Publicar

1. Vercel → **Add New → Project** → importe `Leonardodevcloud/PontoSnap`
2. **Root Directory**: `site`
3. **Framework Preset**: `Other`
4. Build Command e Install Command: deixe **vazios** (não há build)
5. Output Directory: deixe vazio
6. Deploy

## Domínios

- Landing → `pontosnap.com.br` (ou o domínio da Vercel)
- App → `app.pontosnap.com.br` (projeto `apps/web`)

Ao apontar o domínio próprio, troque nos dois lugares do `index.html`:
`https://ponto-snap-web.vercel.app/login` → `https://app.pontosnap.com.br/login`

## Antes de divulgar

- [ ] Trocar `contato@pontosnap.com.br` pelo e-mail/WhatsApp real
- [ ] Registro no INPI: a página fala do registro sem citar número. Confirme o registro antes de divulgar.
