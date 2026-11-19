"""Fast, offline regression checks for SQLite rollups and core calculations."""
import datetime as dt
import gzip
import json
import os
import queue
import tempfile
import unittest
from unittest import mock

import gh


class HealthDatabaseRegressionTests(unittest.TestCase):     
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="fitbit-dashboard-test-")
        self.db_path = os.path.join(self.temp_dir.name, "test-health.db")
        self.db_path_patch = mock.patch.object(gh, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        gh._ready.discard(self.db_path)

    def tearDown(self):
        self.db_path_patch.stop()
        gh._ready.discard(self.db_path)
        self.temp_dir.cleanup()

    def test_schema_bootstrap_is_repeatable_and_includes_device_health(self):
        con = gh.db()
        try:
            tables = {row[0] for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertIn("device_battery_samples", tables)
            self.assertIn("hr_coverage_day", tables)
            self.assertEqual(gh.get_meta(con, "schema_v"), str(gh.SCHEMA_VERSION))
        finally:
            con.close()

        gh._ready.discard(self.db_path)
        con = gh.db()
        try:
            self.assertEqual(gh.get_meta(con, "schema_v"), str(gh.SCHEMA_VERSION))
        finally:
            con.close()

    def test_heart_rate_rollups_keep_minute_and_day_statistics_consistent(self):
        con = gh.db()
        try:
            local_tz = dt.datetime.now().astimezone().tzinfo
            local_times = [dt.datetime(2026, 11, 10, 12, 0, second, tzinfo=local_tz)
                           for second in (0, 10, 20)]
            local_times.extend(dt.datetime(2026, 11, 10, 12, minute, tzinfo=local_tz)
                               for minute in (5, 10))
            samples = [(int(value.timestamp()), bpm)
                       for value, bpm in zip(local_times, (60, 100, 80, 70, 90))]
            con.executemany("INSERT INTO hr_raw(ts,bpm) VALUES(?,?)", samples)

            gh.rebuild_hr_min(con)
            gh.rebuild_hr_days(con)

            minute_rows = con.execute("SELECT avg,lo,hi,n,q25 FROM hr_min ORDER BY m").fetchall()
            self.assertEqual(len(minute_rows), 3)
            self.assertEqual(tuple(minute_rows[0]), (80.0, 60, 100, 3, 70.0))

            day = local_times[0].date().isoformat()
            summary = con.execute(
                "SELECT n,lo,med,mean,hi FROM hr_day WHERE day=?", (day,)
            ).fetchone()
            self.assertEqual(tuple(summary), (5, 60, 80.0, 80.0, 100))

            coverage = con.execute(
                "SELECT worn_seconds,quarters FROM hr_coverage_day WHERE day=?", (day,)
            ).fetchone()
            self.assertEqual(coverage[0], 600)
            self.assertEqual(len(coverage[1]), 96)
        finally:
            con.close()

    def test_quantile_handles_empty_single_and_interpolated_values(self):
        self.assertIsNone(gh.quantile([], 0.5))
        self.assertEqual(gh.quantile([7], 0.5), 7)
        self.assertEqual(gh.quantile([0, 10], 0.25), 2.5)
    


class HttpOptimizationTests(unittest.TestCase):
    def test_api_http_request_decompresses_gzip_and_reuses_connection(self):
        payload = gzip.compress(b'{"ok":true}')

        class Response:
            status = 200
            will_close = False

            def read(self):
                return payload

            def getheader(self, name):
                return "gzip" if name.lower() == "content-encoding" else None

        class Connection:
            sock = object()

            def request(self, method, target, body=None, headers=None):
                self.request_args = (method, target, body, headers)

            def getresponse(self):
                return Response()

            def close(self):
                self.sock = None

        pool = queue.LifoQueue(maxsize=1)
        connection = Connection()
        with mock.patch.object(gh, "_https_pool", return_value=pool), \
                mock.patch.object(gh.http.client, "HTTPSConnection", return_value=connection):
            status, raw = gh._api_http_request(
                "GET", "https://health.googleapis.com/v4/test", None, {"Authorization": "Bearer test"})

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"ok": True})
        self.assertEqual(connection.request_args[3]["Accept-Encoding"], "gzip")
        self.assertIs(pool.get_nowait(), connection)

    def test_access_token_reads_file_once_until_it_changes(self):
        with tempfile.TemporaryDirectory(prefix="fitbit-token-test-") as folder:
            token_path = os.path.join(folder, "token.json")
            with open(token_path, "w", encoding="utf-8") as stream:
                json.dump({"access_token": "test-token", "expires_at": 4_000_000_000}, stream)
            with mock.patch.object(gh, "TOKEN_PATH", token_path), \
                    mock.patch.dict(gh._cached_token, {"mtime_ns": None, "value": None}), \
                    mock.patch("builtins.open", wraps=open) as open_mock:
                self.assertEqual(gh.access_token(), "test-token")
                self.assertEqual(gh.access_token(), "test-token")
                self.assertEqual(open_mock.call_count, 1)


if __name__ == "__main__":
    unittest.main()
