#!/usr/bin/env node
/**
 * Gera um par de chaves VAPID para Web Push.
 * Rodar uma vez e salvar nas env vars do Railway:
 *   VAPID_PUBLIC_KEY=<public>
 *   VAPID_PRIVATE_KEY=<private>
 *
 * Uso: node scripts/gerar-vapid.cjs
 */
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('══════════════════════════════════════════');
console.log('  Chaves VAPID geradas — salvar no Railway');
console.log('══════════════════════════════════════════');
console.log();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log();
console.log('A chave pública também precisa ir no Vercel como:');
console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log();
console.log('══════════════════════════════════════════');
