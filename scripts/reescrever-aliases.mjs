/**
 * Pós-build: troca require("@ponto/x") pelo caminho relativo dentro do dist.
 *
 * Por quê: o tsc resolve @ponto/* via "paths" em tempo de compilação, mas não
 * reescreve o import no JS emitido. Em runtime, o Node resolveria @ponto/db
 * pelo link do pnpm → packages/db/src/index.ts (TypeScript) e quebraria.
 * Aqui apontamos direto para o JS já compilado.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const DIST = 'dist';
const RE = /require\((["'])@ponto\/([a-z-]+)\1\)/g;

function* arquivosJs(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) yield* arquivosJs(p);
    else if (p.endsWith('.js')) yield p;
  }
}

let alterados = 0;
for (const arquivo of arquivosJs(DIST)) {
  const antes = readFileSync(arquivo, 'utf8');
  const depois = antes.replace(RE, (todo, aspas, pkg) => {
    const alvo = join(DIST, 'packages', pkg, 'src', 'index.js');
    if (!existsSync(alvo)) {
      console.error(`  ! alvo inexistente para @ponto/${pkg}: ${alvo}`);
      return todo;
    }
    let rel = relative(dirname(arquivo), alvo).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return `require(${aspas}${rel}${aspas})`;
  });
  if (depois !== antes) {
    writeFileSync(arquivo, depois);
    alterados++;
  }
}
console.log(`Aliases @ponto reescritos em ${alterados} arquivo(s).`);

// verificação: não pode sobrar nenhum @ponto/ literal
const restantes = [];
for (const arquivo of arquivosJs(DIST)) {
  if (/require\((["'])@ponto\//.test(readFileSync(arquivo, 'utf8'))) restantes.push(arquivo);
}
if (restantes.length) {
  console.error('FALHA: ainda há requires de @ponto/ sem resolver:', restantes);
  process.exit(1);
}
