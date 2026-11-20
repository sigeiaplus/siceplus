// Utilitários dos testes em Node (não fazem parte do app).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const qrcode = require('../js/lib/qrcode.js');
export function qrObjeto(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr;
}
