import datetime as dt
import os
import tempfile
import unittest
from unittest import mock

import gh
from performance_optimizations import rebuild_hr_days_optimized, sample_series


def _reference_day_summary(values):
    values = sorted(values)
    if not values:
        return None
    return (
        len(values),
        values[0],
        round(gh.quantile(values, 0.25), 1),
        round(gh.quantile(values, 0.5), 1),
        round(sum(values) / len(values), 1),
        round(gh.quantile(values, 0.75), 1),
        values[-1],
    )


def _reference_rebuild(con, lo, hi):
    first_day = dt.datetime.fromtimestamp(int(lo)).date()
    last_day = dt.datetime.fromtimestamp(int(hi)).date()
    bounds_by_day = {}
    day = first_day
    while day <= last_day:
        bounds_by_day[day.isoformat()] = gh.day_bounds(day)
        day += dt.timedelta(days=1)

    first_start = next(iter(bounds_by_day.values()))[0]
    last_end = next(reversed(bounds_by_day.values()))[1]
    rows = con.execute(
        "SELECT ts, bpm FROM hr_raw WHERE ts >= ? AND ts <= ? ORDER BY ts",
        (max(0, first_start - 600), last_end + 600),
    ).fetchall()

    by_day = {}
    for ts, bpm in rows:
        if bpm is None:
            continue
        ts = int(ts)
        day_key = dt.datetime.fromtimestamp(ts).date().isoformat()
        bounds = bounds_by_day.get(day_key)
        if bounds and bounds[0] <= ts < bounds[1]:
            by_day.setdefault(day_key, []).append(int(bpm))

    expected_days = [
        (day_key, *_reference_day_summary(by_day[day_key]))
        for day_key in sorted(by_day)
    ]

    coverage = {key: [0, [0] * 96] for key in bounds_by_day}
    for (prev_ts, _), (ts, _) in zip(rows, rows[1:]):
        prev_ts, ts = int(prev_ts), int(ts)
        if not (0 < ts - prev_ts <= 600):
            continue
        cursor = prev_ts
        while cursor < ts:
            local = dt.datetime.fromtimestamp(cursor)
            local_day = local.date()
            day_key = local_day.isoformat()
            _, day_end = gh.day_bounds(local_day)
            quarter_minute = ((local.minute // 15) + 1) * 15
            quarter_end = int((
                local.replace(minute=0, second=0, microsecond=0)
                + dt.timedelta(minutes=quarter_minute)
            ).timestamp())
            edge = min(ts, day_end, quarter_end)
            if edge <= cursor:
                edge = min(ts, cursor + 1)
            if day_key in coverage:
                seconds = edge - cursor
                coverage[day_key][0] += seconds
                coverage[day_key][1][local.hour * 4 + (local.minute // 15)] += seconds
            cursor = edge

    expected_coverage = [
        (
            day_key,
            worn_seconds,
            "".join("1" if sec >= 450 else "0" for sec in quarters),
        )
        for day_key, (worn_seconds, quarters) in sorted(coverage.items())
    ]

    return expected_days, expected_coverage


class PerformanceOptimizationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="fitbit-performance-test-")
        self.db_path = os.path.join(self.temp_dir.name, "test-health.db")
        self.path_patch = mock.patch.object(gh, "DB_PATH", self.db_path)
        self.path_patch.start()
        gh._ready.discard(self.db_path)

    def tearDown(self):
        self.path_patch.stop()
        gh._ready.discard(self.db_path)
        self.temp_dir.cleanup()

    def test_single_pass_daily_rollups_match_reference(self):
        con = gh.db()
        try:
            tz = dt.datetime.now().astimezone().tzinfo
            start = dt.datetime(2026, 11, 10, 23, 40, tzinfo=tz)
            rows = []
            for i in range(40):
                stamp = start + dt.timedelta(minutes=5 * i)
                rows.append((int(stamp.timestamp()), 55 + (i % 31)))
            gap_start = start + dt.timedelta(days=1, hours=3)
            for i in range(8):
                stamp = gap_start + dt.timedelta(minutes=5 * i)
                rows.append((int(stamp.timestamp()), 62 + i))
            con.executemany("INSERT INTO hr_raw(ts,bpm) VALUES(?,?)", rows)

            lo, hi = rows[0][0], rows[-1][0]
            expected_days, expected_cov = _reference_rebuild(con, lo, hi)

            con.execute("DELETE FROM hr_day")
            con.execute("DELETE FROM hr_coverage_day")
            self.assertEqual(rebuild_hr_days_optimized(con, lo, hi), 3)

            actual_days = [tuple(row) for row in con.execute(
                "SELECT day,n,lo,q1,med,mean,q3,hi FROM hr_day ORDER BY day"
            )]
            actual_cov = [tuple(row) for row in con.execute(
                "SELECT day,worn_seconds,quarters FROM hr_coverage_day ORDER BY day"
            )]

            self.assertEqual(actual_days, expected_days)
            self.assertEqual(actual_cov, expected_cov)
        finally:
            con.close()

    def test_sample_series_bounds_output_and_keeps_endpoints(self):
        values = list(range(10_000))
        sampled = sample_series(values, 100)
        self.assertEqual(len(sampled), 100)
        self.assertEqual(sampled[0], values[0])
        self.assertEqual(sampled[-1], values[-1])
        self.assertEqual(sample_series(values[:5], 5), values[:5])