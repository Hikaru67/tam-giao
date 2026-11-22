-- Đo độ trễ relay outbox (BE-S7-09) cho các event tạo từ thời điểm :since (psql -v since=<ISO-8601>).
-- Chạy: tests/e2e/run-local.sh outbox [since]   hoặc trên staging:
--   psql "$DATABASE_URL" -v since=2026-01-01T00:00:00Z -f tests/load/outbox-latency.sql
-- Chỉ đọc platform.outbox / platform.processed_events — không đọc payload (có thể chứa id người dùng).

\pset footer off

\echo '== (1) Relay: outbox.created_at -> published_at (worker đẩy event sang pg-boss) =='
SELECT event_type,
       count(*) AS events,
       round((percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM published_at - created_at)) * 1000)::numeric) AS p50_ms,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM published_at - created_at)) * 1000)::numeric) AS p95_ms,
       round((max(extract(epoch FROM published_at - created_at)) * 1000)::numeric) AS max_ms
FROM platform.outbox
WHERE created_at >= :'since'::timestamptz AND published_at IS NOT NULL
GROUP BY ROLLUP (event_type)
ORDER BY event_type NULLS LAST;

\echo '== (2) Đầu-cuối: outbox.created_at -> processed_events.processed_at (consumer xử lý xong) =='
SELECT p.consumer,
       count(*) AS deliveries,
       round((percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM p.processed_at - o.created_at)) * 1000)::numeric) AS p50_ms,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM p.processed_at - o.created_at)) * 1000)::numeric) AS p95_ms,
       round((max(extract(epoch FROM p.processed_at - o.created_at)) * 1000)::numeric) AS max_ms
FROM platform.processed_events p
JOIN platform.outbox o ON o.id = p.event_id
WHERE o.created_at >= :'since'::timestamptz
GROUP BY ROLLUP (p.consumer)
ORDER BY p.consumer NULLS LAST;

\echo '== (3) Tồn đọng: event chưa relay =='
SELECT count(*) AS unpublished,
       coalesce(round((extract(epoch FROM now() - min(created_at)) * 1000)::numeric), 0) AS oldest_age_ms
FROM platform.outbox
WHERE published_at IS NULL;
