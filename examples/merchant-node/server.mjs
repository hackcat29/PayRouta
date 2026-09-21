// Local single-order example. Server owns product amount and stable order ID.
import { createServer } from 'node:http';
import { PayRouta } from '../../sdks/node/dist/index.js';
const baseUrl = process.env.PAYROUTA_BASE_URL || 'http://127.0.0.1:3000/api/v1';
const sdk = new PayRouta({ baseUrl, secretKey: process.env.PAYROUTA_SECRET_KEY || '', environment: 'sandbox', timeoutMs: 10000 });
const order = process.env.DEMO_ORDER_ID;
if (!order || !/^[\w-]{8,80}$/.test(order)) throw new Error('Set a stable DEMO_ORDER_ID (8–80 letters, digits, hyphens)');
const asset = { kind:'fiat', identifier:'NGN', network:'' };
let paymentId;
createServer(async (request, response) => {
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json');
  try {
    if (request.method === 'POST' && request.url === '/checkout') {
      if (request.headers.origin && request.headers.origin !== 'http://127.0.0.1:55440') { response.writeHead(403); response.end('{}'); return; }
      const intent = await sdk.createIntent({ reference:order, amount:'100.00', asset, precision:2, methods:['bank-transfer','card'], settlement:asset, returnUrl:'http://127.0.0.1:3000/' }, `${order}-intent`);
      paymentId = intent.id;
      const session = await sdk.createCheckoutSession(intent.id, `${order}-session`);
      response.end(JSON.stringify({ checkoutUrl:new URL(session.checkoutPath,baseUrl).href }));
    } else if (request.method === 'GET' && request.url === '/payment' && paymentId) {
      response.end(JSON.stringify(await sdk.getPayment(paymentId)));
    } else { response.writeHead(404); response.end('{}'); }
  } catch (error) { response.writeHead(502); response.end(JSON.stringify({error:error.code || 'UNAVAILABLE',requestId:error.requestId || null})); }
}).listen(55440,'127.0.0.1',()=>console.log('Merchant example: http://127.0.0.1:55440 (single local order)'));
