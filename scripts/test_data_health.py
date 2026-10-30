"""
Data health in the status file (scripts/data_health.py), plan N3, Oct 24, 2026.
Run: python3 -m unittest scripts/test_data_health.py  (from the repository's top folder)
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import data_health as dh  # noqa: E402

NOW = dh.ts('2026-10-24T14:10:00Z')


def iso(minutes_ago):
    return dh.time.strftime('%Y-%m-%dT%H:%M:%S.000Z', dh.time.gmtime(NOW - minutes_ago * 60))


def healthy():
    """A status file as the server writes it on a good day (shapes from /ops-status.json, Oct 24)"""
    hours = {dh.time.strftime('%Y%m%d%H', dh.time.gmtime(NOW - 3600 * i)): 4 for i in range(0, 24)}
    return {
        'updated': '2026-10-24T14:10:00+00:00', 'commit': 'e664ad4', 'last_deploy': 'success', 'last_deploy_note': '',
        'last_maintenance': 'ok 2026-10-24T08:45:00+00:00', 'disk_free_gb': 49, 'cert_days_left': 71,
        'backup': {'at': '2026-10-24T09:40:00Z', 'ok': True, 'note': 'copy made and readable', 'kept': ['db-2026-10-24.dump'], 'restore_test': None},
        'containers': {'wp_api': 'running', 'wp_postgres': 'running', 'wp_scraper': 'running'},
        'pipeline': {
            'checked': '2026-10-24T14:05:00+00:00',
            'db': [{'created': 10505, 'newest_signal': '2026-10-24T14:04:03.0297+00:00'},
                   {'newest_verified': '2026-10-24T14:01:37.340932+00:00'}, None, None, None],
            'report_rate': {'last_6h': 2650, 'week_ago_6h': 2400},
            'gdelt': {'last_24h': hours, 'last_cycle': {'at': iso(8), 'newest': '20261024140000', 'missing': [], 'failed': []}},
            'sources': {'failing': 4, 'news_feeds': {'failing': 5},
                        'list': [{'name': 'UN News', 'slug': 'un-news', 'why': 'unreadable answer', 'last_worked': '2026-10-24T11:45:42.958Z'},
                                 {'name': 'GDELT CSV export', 'slug': 'gdelt-csv', 'why': 'HTTP 404', 'last_worked': None}]},
            'claude': {'editor_last_pass': {'at': iso(9), 'stopped': False}, 'failing_since': None, 'failing_calls': 0,
                       'cap_usd_month': 20.0, 'spent_usd_month': 6.54},
            'fingerprints': {'last_run': {'at': iso(12)}, 'model_ready': True, 'error': None},
            'failed': [],
        },
    }


def check(h, key):
    found = [c for c in h['checks'] if c['key'] == key]
    return found[0] if found else None


class Times(unittest.TestCase):
    def test_reads_the_time_forms_the_status_file_holds(self):
        base = dh.ts('2026-10-24T14:05:03Z')
        self.assertEqual(dh.ts('2026-10-24T14:05:03+00:00'), base)
        self.assertEqual(dh.ts('2026-10-24 14:05:03+00'), base)
        self.assertEqual(dh.ts('2026-10-24T10:05:03-04:00'), base)
        self.assertAlmostEqual(dh.ts('2026-10-24T14:05:03.0297+00:00') - base, 0.0297, places=4)
        self.assertAlmostEqual(dh.ts('2026-10-24T14:05:03.068Z') - base, 0.068, places=4)
        for bad in (None, '', 'yesterday', '2026-13-45T00:00:00Z', 12):
            self.assertIsNone(dh.ts(bad))


class AGoodDay(unittest.TestCase):
    def test_everything_ok_says_so_in_one_line(self):
        h = dh.health(healthy(), now=NOW)
        self.assertEqual(h['status'], 'ok', h)
        self.assertEqual(h['line'], f"Data: ok ({len(h['checks'])} checks)")
        self.assertEqual(check(h, 'reports')['line'], 'Newest report 1 minute old')
        self.assertEqual(check(h, 'gdelt')['line'], "GDELT's files: 24 of 24 read in the last 6 hours")
        self.assertIn('longest: GDELT CSV export, HTTP 404, no success on record', check(h, 'feeds')['line'])
        self.assertIsNone(check(h, 'claude_cap'))


class WhatItCatches(unittest.TestCase):
    def test_the_failed_database_copy_of_oct_24(self):
        s = healthy()
        s['backup'] = {'at': '2026-10-24T10:10:14Z', 'ok': False, 'note': 'pg_dump failed: ', 'kept': [], 'restore_test': None}
        h = dh.health(s, now=NOW)
        self.assertEqual(h['status'], 'alarm')
        self.assertEqual(h['line'], '1 alarm: The last database copy failed (pg_dump failed:); 0 copies kept')

    def test_no_copy_yet_and_an_old_copy_are_warnings(self):
        s = healthy(); s['backup'] = None
        self.assertEqual(check(dh.health(s, now=NOW), 'backup')['status'], 'warn')
        s = healthy(); s['backup']['at'] = '2026-10-22T09:40:00Z'
        c = check(dh.health(s, now=NOW), 'backup')
        self.assertEqual((c['status'], c['line']), ('warn', 'The last database copy is 2 days old; 1 kept'))

    def test_reports_that_stop_coming(self):
        s = healthy(); s['pipeline']['db'][0]['newest_signal'] = '2026-10-24T13:20:00+00:00'
        c = check(dh.health(s, now=NOW), 'reports')
        self.assertEqual((c['status'], c['line']), ('warn', 'No new report for 45 minutes'))
        s['pipeline']['db'][0]['newest_signal'] = '2026-10-24T11:00:00+00:00'
        c = check(dh.health(s, now=NOW), 'reports')
        self.assertEqual((c['status'], c['line']), ('alarm', 'No new report for 3 hours'))

    def test_a_quarter_of_gdelts_files_lost_for_hours(self):
        # Oct 22-23: one file in four lost for hours (0s9)
        s = healthy()
        top = int(dh.ts(s['pipeline']['checked']) // 3600) * 3600
        for i in range(1, 7):
            s['pipeline']['gdelt']['last_24h'][dh.time.strftime('%Y%m%d%H', dh.time.gmtime(top - 3600 * i))] = 3
        c = check(dh.health(s, now=NOW), 'gdelt')
        self.assertEqual(c['status'], 'warn')
        self.assertTrue(c['line'].startswith("GDELT's files: 18 of 24 read in the last 6 hours (short: "), c['line'])

    def test_gdelts_reader_stopped(self):
        s = healthy(); s['pipeline']['gdelt']['last_cycle']['at'] = iso(150)
        self.assertEqual(check(dh.health(s, now=NOW), 'gdelt_cycle')['status'], 'alarm')

    def test_a_fall_in_reports_against_the_same_hours_a_week_ago(self):
        s = healthy(); s['pipeline']['report_rate'] = {'last_6h': 400, 'week_ago_6h': 2400}
        self.assertEqual(check(dh.health(s, now=NOW), 'report_rate')['status'], 'alarm')
        s['pipeline']['report_rate'] = {'last_6h': 1000, 'week_ago_6h': 2400}
        self.assertEqual(check(dh.health(s, now=NOW), 'report_rate')['status'], 'warn')
        # too few a week ago to judge
        s['pipeline']['report_rate'] = {'last_6h': 2, 'week_ago_6h': 40}
        self.assertEqual(check(dh.health(s, now=NOW), 'report_rate')['status'], 'ok')

    def test_claude_failing_and_the_cap(self):
        s = healthy()
        s['pipeline']['claude']['failing_since'] = iso(70)
        s['pipeline']['claude']['failing_calls'] = 31
        s['pipeline']['claude']['spent_usd_month'] = 18.5
        h = dh.health(s, now=NOW)
        self.assertEqual(check(h, 'claude')['line'], "Claude's calls have failed for 65 minutes (31 calls)")
        self.assertEqual(check(h, 'claude_cap')['status'], 'warn')
        self.assertTrue(h['line'].startswith('1 alarm, 1 warning: '), h['line'])

    def test_a_container_down_and_the_editor_quiet(self):
        s = healthy()
        s['containers']['wp_scraper'] = 'exited'
        s['pipeline']['claude']['editor_last_pass']['at'] = iso(65)
        h = dh.health(s, now=NOW)
        self.assertEqual(check(h, 'containers')['line'], 'Not running: wp_scraper (exited)')
        self.assertEqual(check(h, 'editor')['status'], 'warn')

    def test_feeds_failing_for_days_are_not_a_failure_at_once(self):
        # Oct 30, 6:05 AM: 1 source and 12 news feeds failing, 5 of the feeds for 1 to 5 days
        s = healthy()
        fails = [20, 15, 13, 10, 9, 5, 5, 5, 3, 3, 1, 1]
        s['pipeline']['sources']['failing'] = 1
        s['pipeline']['sources']['news_feeds'] = {'failing': len(fails), 'paused': 10,
                                                  'list': [{'id': f'feed-{i}', 'fails': n, 'paused': n >= 3, 'why': 'turned away (403)'}
                                                           for i, n in enumerate(fails)]}
        c = check(dh.health(s, now=NOW), 'feeds')
        self.assertEqual(c['status'], 'ok', c)
        self.assertTrue(c['line'].startswith('1 source and 12 news feeds failing, 5 of the feeds for over a day (longest: '), c['line'])
        # six more failing at once is a warning again
        s['pipeline']['sources']['news_feeds']['failing'] += 6
        s['pipeline']['sources']['news_feeds']['list'] += [{'id': f'new-{i}', 'fails': 1, 'paused': False, 'why': 'answered 503'} for i in range(6)]
        self.assertEqual(check(dh.health(s, now=NOW), 'feeds')['status'], 'warn')
        # and so are dead feeds left to pile up
        s = healthy()
        s['pipeline']['sources']['news_feeds'] = {'failing': 13, 'list': [{'id': f'feed-{i}', 'fails': 9} for i in range(13)]}
        c = check(dh.health(s, now=NOW), 'feeds')
        self.assertEqual(c['status'], 'warn', c)
        self.assertIn('13 news feeds failing, 13 of the feeds for over a day', c['line'])

    def test_old_counts_and_unread_parts(self):
        s = healthy()
        s['pipeline']['checked'] = '2026-10-24T13:00:00+00:00'
        s['pipeline']['failed'] = ['sources', 'gdelt']
        h = dh.health(s, now=NOW)
        self.assertEqual(check(h, 'pipeline')['line'], "The pipeline's counts are 70 minutes old (they are made every 30 minutes)")
        self.assertEqual(check(h, 'parts')['line'], 'Not read this time: sources, gdelt')

    def test_missing_pipeline_is_an_alarm_not_a_crash(self):
        s = healthy(); s['pipeline'] = None
        h = dh.health(s, now=NOW)
        self.assertEqual(h['status'], 'alarm')


class TheFile(unittest.TestCase):
    def test_adds_the_block_and_keeps_the_rest(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'status.json')
            s = healthy()
            with open(path, 'w') as fh:
                json.dump(s, fh)
            r = subprocess.run([sys.executable, dh.__file__, path], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(path) as fh:
                out = json.load(fh)
            self.assertIn(out['data_health']['status'], ('ok', 'warn', 'alarm'))
            del out['data_health']
            self.assertEqual(out, s)

    def test_a_broken_file_is_left_as_it_was(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'status.json')
            with open(path, 'w') as fh:
                fh.write('{"updated": ')
            r = subprocess.run([sys.executable, dh.__file__, path], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            with open(path) as fh:
                self.assertEqual(fh.read(), '{"updated": ')


if __name__ == '__main__':
    unittest.main()
