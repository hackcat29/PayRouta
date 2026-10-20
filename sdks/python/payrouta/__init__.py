"""Server-only PayRouta client. Amounts are exact strings; never coerce to float."""
import hashlib
import hmac
import json
import math
import time
from urllib.parse import urlparse, urlencode, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from email.utils import parsedate_to_datetime

class PayRoutaError(Exception):
    def __init__(self, code, status=None, request_id=None, uncertain=False):
        super().__init__(code)
        self.code, self.status, self.request_id, self.uncertain = code, status, request_id, uncertain

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def _transport(method, url, headers, body, timeout):
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with build_opener(NoRedirect).open(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except HTTPError as error:
        return error.code, dict(error.headers), error.read()

class PayRouta:
    def __init__(self, base_url, secret_key, environment, timeout=10, transport=None, sleep=time.sleep):
        url = urlparse(base_url)
        if url.username or url.password or url.query or url.fragment or not (url.scheme == 'https' or (url.scheme == 'http' and url.hostname in ('localhost','127.0.0.1','::1'))):
            raise ValueError('Use HTTPS or local loopback')
        if environment not in ('sandbox','production') or not secret_key.startswith('pr_' + environment + '_'):
            raise ValueError('Key environment mismatch')
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Timeout must be positive')
        self.base_url, self.secret_key, self.environment = base_url.rstrip('/')+'/', secret_key, environment
        self.timeout, self.transport, self.sleep = timeout, transport or _transport, sleep

    def request(self, method, path, body=None, idempotency_key=None):
        if path.startswith('/') or ':' in path.split('?')[0] or '..' in path:
            raise ValueError('Relative API resource required')
        headers = {'Authorization': 'Bearer '+self.secret_key, 'PayRouta-Environment': self.environment, 'Content-Type': 'application/json'}
        if idempotency_key:
            headers['Idempotency-Key'] = idempotency_key
        for attempt in range(3):
            try:
                status, response_headers, raw = self.transport(method, self.base_url+path, headers, None if body is None else json.dumps(body).encode(), self.timeout)
            except Exception as error:
                raise PayRoutaError('TRANSPORT_ERROR', uncertain=method != 'GET') from error
            rh = {k.lower():v for k,v in response_headers.items()}
            if method == 'GET' and status in (429,502,503,504) and attempt < 2:
                hint = rh.get('retry-after')
                try:
                    wait = float(hint) if hint and hint.isdigit() else max(0,parsedate_to_datetime(hint).timestamp()-time.time()) if hint else 2**attempt
                except (ValueError, TypeError):
                    raise PayRoutaError('RETRY_LATER', status, rh.get('x-request-id'))
                if not math.isfinite(wait) or wait > 60:
                    raise PayRoutaError('RETRY_LATER', status, rh.get('x-request-id'))
                self.sleep(wait)
                continue
            try:
                data = json.loads(raw)
            except (ValueError, TypeError) as error:
                raise PayRoutaError('INVALID_RESPONSE', status, rh.get('x-request-id'), method != 'GET') from error
            if not 200 <= status < 300:
                raise PayRoutaError(data.get('error',{}).get('code','API_ERROR') if isinstance(data,dict) else 'API_ERROR', status, rh.get('x-request-id'), method != 'GET' and status >= 500)
            return data

    def create_intent(self, intent, idempotency_key):
        if not isinstance(intent.get('amount'), str):
            raise ValueError('Amount must be a string')
        return self.request('POST','payment-intents',intent,idempotency_key)

    def create_checkout(self, checkout, idempotency_key):
        """One checkout for one order: fiat methods and credit, plus crypto for USD orders."""
        if not isinstance(checkout.get("amount"), str):
            raise ValueError("Amount must be a string")
        return self.request("POST", "checkouts", checkout, idempotency_key)

    def create_crypto_checkout(self, checkout, idempotency_key):
        if not isinstance(checkout.get("usdAmount"), str):
            raise ValueError("USD amount must be a string")
        return self.request("POST", "crypto-checkouts", checkout, idempotency_key)

    def get_payment(self, payment_id):
        return self.request('GET','payments/'+quote(payment_id, safe=''))

    def create_checkout_session(self, intent_id, idempotency_key):
        return self.request('POST','checkout-sessions',{'intentId':intent_id},idempotency_key)

    def paginate(self, resource, **filters):
        cursor = None
        while True:
            data = self.request('GET', resource+'?'+urlencode({**filters, **({'cursor':cursor} if cursor else {})}))
            yield from data['data']
            following = data.get('nextCursor')
            if not following:
                return
            if following == cursor:
                raise ValueError('Repeated pagination cursor')
            cursor = following

def verify_webhook(raw_body, headers, secrets, now=None, tolerance=300):
    """Pass untouched bytes and key-id -> secret map including previous rotation keys."""
    headers = {k.lower():v for k,v in headers.items()}
    timestamp, event_id = headers.get('payrouta-timestamp',''), headers.get('payrouta-event-id','')
    secret = secrets.get(headers.get('payrouta-key-id',''))
    signature = headers.get('payrouta-signature','')
    current = time.time() if now is None else now
    if not secret or not event_id or not timestamp.isascii() or not timestamp.isdigit() or not math.isfinite(current) or not math.isfinite(tolerance) or tolerance < 0 or abs(int(timestamp)-current)>tolerance or len(signature)!=64 or any(c not in '0123456789abcdef' for c in signature):
        return False
    expected = hmac.new(secret.encode(), (timestamp+'.'+event_id+'.').encode()+raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
