import unittest
import json
import threading
import urllib.error
import urllib.request

import server


class LocalServerSecurityTests(unittest.TestCase):
    def test_public_static_allowlist_blocks_repository_secrets(self):
        for path in ('.env', '.git/config', 'server.py', 'package.json', 'generated_questions_review.json', '../.env'):
            self.assertFalse(server.is_public_static_path(path), path)
        for path in ('index.html', 'config.js', 'questions.json', 'lib/client-security.js', 'assets/avatars/penguin.png'):
            self.assertTrue(server.is_public_static_path(path), path)

    def test_browser_origin_is_bound_to_local_helper(self):
        self.assertTrue(server.is_trusted_browser_origin(''))
        self.assertTrue(server.is_trusted_browser_origin(f'http://localhost:{server.PORT}'))
        self.assertTrue(server.is_trusted_browser_origin(f'http://127.0.0.1:{server.PORT}'))
        self.assertFalse(server.is_trusted_browser_origin('https://attacker.example'))
        self.assertFalse(server.is_trusted_browser_origin('http://localhost:9999'))

    def test_http_server_serves_public_app_but_blocks_secrets_and_foreign_origins(self):
        httpd = server.NoFQDNHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{httpd.socket.getsockname()[1]}'
        try:
            with urllib.request.urlopen(base + '/', timeout=3) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b'lib/client-security.js', response.read())
            with self.assertRaises(urllib.error.HTTPError) as secret_error:
                urllib.request.urlopen(base + '/.env', timeout=3)
            self.assertEqual(secret_error.exception.code, 404)
            secret_error.exception.close()
            request = urllib.request.Request(base + '/health', headers={'Origin': 'https://attacker.example'})
            with self.assertRaises(urllib.error.HTTPError) as origin_error:
                urllib.request.urlopen(request, timeout=3)
            self.assertEqual(origin_error.exception.code, 403)
            self.assertEqual(json.loads(origin_error.exception.read()), {'error': 'Origin is not allowed.'})
            origin_error.exception.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
