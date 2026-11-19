"""Opt-in performance helpers for large local health databases and chart payloads."""
import datetime as dt


def _local_midnight(day):
    return int(dt.datetime.combine(day, dt.time.min).astimezone().timestamp())


def _day_bounds(day):
    start = _local_midnight(day)
    end = _local_midnight(day + dt.timedelta(days=1))
    return start, end


def _quantile(sorted_values, q):
    if not sorted_values:
        return None
    pos = (len(sorted_values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    fraction = pos - lo
    return sorted_values[lo] * (1 - fraction) + sorted_values[hi] * fraction


def rebuild_hr_days_optimized(con, lo_ts=None, hi_ts=None):
    """Rebuild daily HR summaries and coverage with one ordered raw-HR scan.

    The bounds select local calendar days, matching gh.rebuild_hr_days().
    A 10-minute border is read to preserve coverage continuity at the edges.
    """
    if lo_ts is None:
        bounds = con.execute("SELECT MIN(ts), MAX(ts) FROM hr_raw").fetchone()
        if bounds[0] is None:
            con.execute("DELETE FROM hr_day")
            con.execute("DELETE FROM hr_coverage_day")
            return 0
        lo_ts, hi_ts = int(bounds[0]), int(bounds[1])
    elif hi_ts is None:
        raise ValueError("hi_ts is required when rebuilding a bounded HR range")

    first_day = dt.datetime.fromtimestamp(int(lo_ts)).date()
    last_day = dt.datetime.fromtimestamp(int(hi_ts)).date()
    day_bounds = {}
    day = first_day
    while day <= last_day:
        day_bounds[day.isoformat()] = _day_bounds(day)
        day += dt.timedelta(days=1)

    if not day_bounds:
        return 0

    first_start = next(iter(day_bounds.values()))[0]
    last_end = next(reversed(day_bounds.values()))[1]
    coverage = {
        key: {"worn_seconds": 0, "quarters": [0] * 96}
        for key in day_bounds
    }

    con.execute(
        "DELETE FROM hr_day WHERE day >= ? AND day <= ?",
        (first_day.isoformat(), last_day.isoformat()),
    )

    def save_day(day_key, values):
        if day_key not in day_bounds or not values:
            return
        values.sort()
        con.execute(
            "INSERT OR REPLACE INTO hr_day(day,n,lo,q1,med,mean,q3,hi) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (
                day_key,
                len(values),
                values[0],
                round(_quantile(values, 0.25), 1),
                round(_quantile(values, 0.5), 1),
                round(sum(values) / len(values), 1),
                round(_quantile(values, 0.75), 1),
                values[-1],
            ),
        )

    previous_ts = None
    current_day_key = None
    current_values = []

    # Iterate the cursor instead of fetchall() so raw samples aren't all held in
    # memory. The padding supplies adjacent readings for continuity calculations.
    rows = con.execute(
        "SELECT ts,bpm FROM hr_raw WHERE ts>=? AND ts<=? ORDER BY ts",
        (max(0, first_start - 600), last_end + 600),
    )
    for raw_ts, bpm in rows:
        ts = int(raw_ts)
        day_key = dt.datetime.fromtimestamp(ts).date().isoformat()

        if day_key != current_day_key:
            save_day(current_day_key, current_values)
            current_day_key = day_key
            current_values = []

        bounds = day_bounds.get(day_key)
        if bounds and bounds[0] <= ts < bounds[1] and bpm is not None:
            current_values.append(int(bpm))

        if previous_ts is not None and 0 < ts - previous_ts <= 600:
            cursor = previous_ts
            while cursor < ts:
                local = dt.datetime.fromtimestamp(cursor)
                local_day = local.date()
                key = local_day.isoformat()
                day_end = _local_midnight(local_day + dt.timedelta(days=1))
                quarter_minute = ((local.minute // 15) + 1) * 15
                quarter_end = int((
                    local.replace(minute=0, second=0, microsecond=0)
                    + dt.timedelta(minutes=quarter_minute)
                ).timestamp())
                edge = min(ts, day_end, quarter_end)
                if edge <= cursor:
                    edge = min(ts, cursor + 1)

                stats = coverage.get(key)
                if stats is not None:
                    seconds = edge - cursor
                    stats["worn_seconds"] += seconds
                    quarter = local.minute // 15
                    stats["quarters"][local.hour * 4 + quarter] += seconds

                cursor = edge

        # Keep timestamps for continuity even if a BPM is missing.
        previous_ts = ts

    save_day(current_day_key, current_values)

    for day_key, stats in coverage.items():
        bitmap = "".join(
            "1" if seconds >= 450 else "0"
            for seconds in stats["quarters"]
        )
        con.execute(
            "INSERT OR REPLACE INTO hr_coverage_day(day,worn_seconds,quarters) "
            "VALUES(?,?,?)",
            (day_key, stats["worn_seconds"], bitmap),
        )

    try:
        import gh
        gh._invalidate_device_health_cache()
    except (ImportError, AttributeError):
        pass

    return len(day_bounds)


def sample_series(points, max_points=1200):
    """Evenly sample an ordered series, retaining both endpoints.

    This is intended for display-only dense series; retain unsampled source data for
    statistics and detail APIs. Never return more than max_points when max_points >= 2.
    """
    if max_points < 2:
        raise ValueError("max_points must be at least 2")
    if not isinstance(points, list) or len(points) <= max_points:
        return points
    last_index = len(points) - 1
    indexes = sorted({round(i * last_index / (max_points - 1)) for i in range(max_points)})
    return [points[i] for i in indexes]