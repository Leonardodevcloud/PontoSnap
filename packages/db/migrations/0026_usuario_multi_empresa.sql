-- Acesso multi-empresa: um usuário administra vários CNPJs.
--
-- O vínculo mora aqui (com o papel POR EMPRESA). O usuario.tenant_id continua
-- existindo como "empresa padrão" — é onde a sessão começa.
--
-- Só ADMIN_CLIENTE e RH usam isto. COLABORADOR fica em uma empresa só: ele tem
-- CPF, vínculo e registro fiscal numa CNPJ específica.
CREATE TABLE IF NOT EXISTS usuario_tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  perfil perfil NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_tenant ON usuario_tenant(usuario_id, tenant_id);
CREATE INDEX IF NOT EXISTS ix_usuario_tenant_usuario ON usuario_tenant(usuario_id);

-- Backfill: quem já existe ganha o vínculo da empresa que já usa, para nada
-- quebrar. Feito ANTES de ligar o RLS (com FORCE, a própria migration seria
-- barrada pela política).
INSERT INTO usuario_tenant (usuario_id, tenant_id, perfil)
SELECT u.id, u.tenant_id, u.perfil
  FROM usuario u
 WHERE u.tenant_id IS NOT NULL
   AND u.perfil IN ('ADMIN_CLIENTE', 'RH')
ON CONFLICT DO NOTHING;

ALTER TABLE usuario_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_tenant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_usuario_tenant ON usuario_tenant;
CREATE POLICY isolamento_tenant_usuario_tenant ON usuario_tenant
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
