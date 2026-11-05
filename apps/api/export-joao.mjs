import fs from 'node:fs';
import postgres from 'postgres';
let url = process.env.DATABASE_URL;
if (!url) for (const p of ['.env','../.env','../../.env']) { try { const m = fs.readFileSync(p,'utf8').match(/DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/); if (m){ url = m[1]; break; } } catch {} }
if (!url) { console.error('DATABASE_URL nao encontrada'); process.exit(1); }
const sql = postgres(url, { ssl: 'require', max: 2 });
const CPF = '08891026514';
const out = {};
try {
  out.empregado = await sql`select id, cpf, matricula, horario_contratual_id, perfil_regra_id, tenant_id from empregado where cpf = ${CPF}`;
  const e = out.empregado[0]; if (!e) throw new Error('Joao nao encontrado');
  out.marcacoes = await sql`select nsr, cpf, dt_marcacao, tipo_registro from ponto_marcacao where tenant_id = ${e.tenant_id} and cpf = ${CPF} and dt_marcacao >= '2026-10-01' and dt_marcacao < '2026-11-01' order by dt_marcacao`;
  out.ajustes = await sql`select * from ponto_ajuste where empregado_id = ${e.id} and data >= '2026-10-01' and data < '2026-11-01' order by data`;
  out.ausencias = await sql`select * from ponto_ausencia where empregado_id = ${e.id} and data >= '2026-10-01' and data < '2026-11-01' order by data`.catch(() => []);
  out.horario = await sql`select * from ponto_horario_contratual where id = ${e.horario_contratual_id}`;
  out.perfil = await sql`select * from ponto_perfil_regra where id = ${e.perfil_regra_id}`;
  out.feriados = await sql`select * from ponto_feriado where tenant_id = ${e.tenant_id} and data >= '2026-10-01' and data < '2026-11-01'`;
  fs.writeFileSync('joao-out.json', JSON.stringify(out, null, 2));
  console.log('OK -> joao-out.json', out.marcacoes.length, 'marcacoes', out.ajustes.length, 'ajustes');
} catch (err) { console.error('ERRO:', err.message); }
await sql.end();
