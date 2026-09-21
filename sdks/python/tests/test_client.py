import unittest
import hashlib
import hmac
from payrouta import PayRouta, PayRoutaError, verify_webhook

class ClientTest(unittest.TestCase):
    def client(self, transport, **kwargs):
        return PayRouta('http://127.0.0.1:3000/api/v1','pr_sandbox_test','sandbox',transport=transport,**kwargs)
    def test_uncertain_write(self):
        calls=[]
        def transport(method,url,headers,body,timeout):
            calls.append(headers['Idempotency-Key'])
            raise TimeoutError()
        with self.assertRaises(PayRoutaError) as error:
            self.client(transport).create_checkout_session('i','same-key')
        self.assertTrue(error.exception.uncertain)
        self.assertEqual(calls,['same-key'])
    def test_bounded_read(self):
        calls=[]
        waits=[]
        def transport(*args):
            calls.append(1)
            return (503,{'Retry-After':'2'},b'{}') if len(calls)<3 else (200,{},b'{"amount":"9007199254740993.01"}')
        self.assertEqual(self.client(transport,sleep=waits.append).get_payment('i')['amount'],'9007199254740993.01')
        self.assertEqual(waits,[2,2])
    def test_error_id(self):
        with self.assertRaises(PayRoutaError) as error:
            self.client(lambda *a:(403,{'X-Request-Id':'req1'},b'{"error":{"code":"FORBIDDEN"}}')).get_payment('i')
        self.assertEqual(error.exception.request_id,'req1')
    def test_webhook(self):
        body=b'{"state": "Confirmed"}'
        headers={'payrouta-key-id':'old','payrouta-timestamp':'1700000000','payrouta-event-id':'evt'}
        headers['payrouta-signature']=hmac.new(b'secret',b'1700000000.evt.'+body,hashlib.sha256).hexdigest()
        self.assertTrue(verify_webhook(body,headers,{'old':'secret'},now=1700000000))
        self.assertFalse(verify_webhook(body,headers,{'new':'secret'},now=1700000000))
        self.assertFalse(verify_webhook(body.replace(b' ',b''),headers,{'old':'secret'},now=1700000000))
        self.assertFalse(verify_webhook(body,headers,{'old':'secret'},now=1700000301))
    def test_environment(self):
        with self.assertRaises(ValueError): PayRouta('http://127.0.0.1','pr_sandbox_x','production')
if __name__=='__main__': unittest.main()
