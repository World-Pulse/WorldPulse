"""
Who counts as a reader (scripts/readers.py), plan LR5, Oct 23, 2026.
Run: python3 -m unittest scripts/test_readers.py  (from the repository's top folder)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import readers  # noqa: E402


def day_with(**visitors):
    d = readers.empty_day('2026-10-23')
    d['visitors'] = visitors
    return d


class WhoCounts(unittest.TestCase):
    def test_a_browser_that_ran_the_page_and_asked_for_a_language_is_a_reader(self):
        s = readers.summary(day_with(a={'p': {'home': 2}, 'js': True, 'l': 'en', 'c': 'hn'}))
        self.assertEqual((s['visitors'], s['views'], s['no_language']), (1, 2, 0))
        self.assertEqual(s['channels'], {'hn': 1})

    def test_one_that_asked_for_no_language_is_counted_apart(self):
        s = readers.summary(day_with(a={'p': {'home': 1}, 'js': True, 'l': 'not sent'},
                                     b={'p': {'story': 3}, 'js': True, 'l': 'es', 'c': 'x'}))
        self.assertEqual((s['visitors'], s['views'], s['no_language']), (1, 3, 1))
        self.assertEqual(s['people_languages'], {'es': 1})
        self.assertEqual(s['rule'], 'api, a language, no sign-in pages')

    def test_lines_from_before_the_language_was_logged_still_count(self):
        s = readers.summary(day_with(a={'p': {'home': 1}, 'js': True}))
        self.assertEqual((s['visitors'], s['no_language']), (1, 0))

    def test_a_browser_that_never_ran_the_page_is_unconfirmed_whatever_its_language(self):
        s = readers.summary(day_with(a={'p': {'home': 1}, 'l': 'not sent'}, b={'p': {'home': 1}, 'st': True, 'l': 'en'}))
        self.assertEqual((s['visitors'], s['unconfirmed'], s['scripts_only'], s['no_language']), (0, 1, 1, 0))


class Languages(unittest.TestCase):
    def test_the_first_language_code_or_not_sent(self):
        self.assertEqual(readers.primary_language(' rt=0.1 host=world-pulse.io lang="es-MX,es;q=0.9,en;q=0.8"'), 'es')
        self.assertEqual(readers.primary_language(' rt=0.1 host=world-pulse.io lang="-"'), 'not sent')
        self.assertIsNone(readers.primary_language(' rt=0.1 host=world-pulse.io'))


if __name__ == '__main__':
    unittest.main()
