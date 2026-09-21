"""Loopback-only single-order example; secrets and product pricing stay server-side."""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urljoin
from payrouta import PayRouta, PayRoutaError
base_url=os.getenv('PAYROUTA_BASE_URL','http://127.0.0.1:3000/api/v1')
client=PayRouta(base_url,os.environ['PAYROUTA_SECRET_KEY'],'sandbox')
order=os.environ['DEMO_ORDER_ID']
if not re.fullmatch(r'[\w-]{8,80}',order): raise ValueError('Set a stable DEMO_ORDER_ID')
asset={'kind':'fiat','identifier':'NGN','network':''}
payment_id=None
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,status,body):
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())
    def do_POST(self):
        global payment_id
        if self.path!='/checkout': return self.reply(404,{})
        if self.headers.get('Origin') not in (None,'http://127.0.0.1:55440'): return self.reply(403,{})
        try:
            intent=client.create_intent({'reference':order,'amount':'100.00','asset':asset,'precision':2,'methods':['bank-transfer','card'],'settlement':asset,'returnUrl':'http://127.0.0.1:3000/'},order+'-intent')
            payment_id=intent['id']
            session=client.create_checkout_session(payment_id,order+'-session')
            self.reply(200,{'checkoutUrl':urljoin(base_url,session['checkoutPath'])})
        except PayRoutaError as error: self.reply(502,{'error':error.code,'requestId':error.request_id})
    def do_GET(self):
        if self.path!='/payment' or payment_id is None: return self.reply(404,{})
        try: self.reply(200,client.get_payment(payment_id))
        except PayRoutaError as error: self.reply(502,{'error':error.code,'requestId':error.request_id})
HTTPServer(('127.0.0.1',55440),Handler).serve_forever()
