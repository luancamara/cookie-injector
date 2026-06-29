#!/usr/bin/env node
// Deriva o ID de extensão do Chrome a partir da chave privada de assinatura (.pem).
// O ID é: sha256(DER da chave pública SPKI) -> primeiros 16 bytes -> mapeados de
// [0-9a-f] para [a-p]. É o mesmo algoritmo que o Chrome usa internamente.
//
// Uso: node derive-id.mjs caminho/para/key.pem

import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('Uso: node derive-id.mjs <key.pem>');
  process.exit(1);
}

const pem = readFileSync(keyPath);
const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
const hash = createHash('sha256').update(der).digest('hex').slice(0, 32);
const id = hash.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

// Também emite a chave pública base64 (para o campo "key" do manifest, opcional).
const pubB64 = der.toString('base64');

if (process.argv.includes('--key')) {
  console.log(pubB64);
} else {
  console.log(id);
}
