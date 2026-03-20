ALTER TABLE budgets
  ADD COLUMN threshold_percentages integer[] NOT NULL DEFAULT '{50,80,90,95}';

ALTER TABLE budgets
  ADD CONSTRAINT budgets_threshold_percentages_range
  CHECK (
    array_length(threshold_percentages, 1) IS NULL
    OR (
      array_length(threshold_percentages, 1) <= 10
      AND 1 <= ALL(threshold_percentages)
      AND 100 >= ALL(threshold_percentages)
    )
  );
