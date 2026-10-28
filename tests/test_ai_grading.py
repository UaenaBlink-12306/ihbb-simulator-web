import unittest
from unittest.mock import Mock, patch

import requests
import server


def completion(value):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"choices": [{"message": {"content": value}}]}
    return response


class GradingRecoveryTests(unittest.TestCase):
    @patch.object(server.time, 'sleep')
    @patch.object(server.requests, 'post')
    def test_transient_connection_failure_recovers(self, post, sleep):
        post.side_effect = [requests.ConnectionError('offline'), completion('{"correct": true}')]
        self.assertTrue(server.call_deepseek([], timeout=12)['correct'])
        self.assertEqual(post.call_count, 2)

    @patch.object(server.time, 'sleep')
    @patch.object(server.requests, 'post')
    def test_provider_key_errors_are_not_retried(self, post, sleep):
        response = requests.Response()
        response.status_code = 401
        post.side_effect = requests.HTTPError(response=response)
        with self.assertRaises(requests.HTTPError):
            server.call_deepseek([])
        self.assertEqual(post.call_count, 1)
        sleep.assert_not_called()

    @patch.object(server.time, 'sleep')
    @patch.object(server.requests, 'post')
    def test_empty_provider_json_recovers_without_json_mode(self, post, sleep):
        post.side_effect = [completion(''), completion('{"correct": false}')]
        self.assertFalse(server.call_deepseek([])['correct'])
        self.assertEqual(post.call_count, 2)
        self.assertNotIn('response_format', post.call_args.kwargs['json'])

    @patch.object(server, 'DEEPSEEK_API_KEY', 'fixture-only')
    @patch.object(server, 'call_deepseek', side_effect=requests.Timeout('simulated'))
    def test_coaching_outage_does_not_change_locked_verdict(self, provider):
        result = server.grade_with_deepseek({
            'question': 'Test question', 'expected': 'Rome', 'user_answer': 'Rome',
            'coach_enabled': True, 'coach_only': True, 'correct': False, 'reason': 'Prior AI verdict'
        })
        self.assertFalse(result['correct'])
        self.assertEqual(result['reason'], 'Prior AI verdict')
        self.assertEqual(result['source'], 'fallback')
        self.assertIsNotNone(result['coach'])


if __name__ == '__main__':
    unittest.main()
