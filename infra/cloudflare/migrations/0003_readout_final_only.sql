-- v_readout counted a provisional or withheld day-7 snapshot as a finished result, so an experiment arm could
-- read as complete on numbers that will still change. Only 'final' snapshots count now; anything else is missing.
-- A view holds no data: dropping and recreating it loses nothing.
DROP VIEW IF EXISTS v_readout;
CREATE VIEW v_readout AS
SELECT o.experiment_id, o.arm,
       COUNT(*) AS n_published,
       SUM(CASE WHEN m.rel_retention_mean IS NULL THEN 1 ELSE 0 END) AS n_missing,
       AVG(m.rel_retention_mean) AS rel_retention_mean,
       AVG(m.avg_view_pct) AS avg_view_pct
FROM outputs o
LEFT JOIN metric_snapshots m ON m.output_id = o.id AND m.checkpoint_day = 7 AND m.status = 'final'
WHERE o.kind = 'short' AND o.published_at IS NOT NULL AND o.experiment_id IS NOT NULL
GROUP BY o.experiment_id, o.arm;
