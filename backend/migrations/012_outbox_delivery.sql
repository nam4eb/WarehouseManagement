ALTER TABLE outbox_events
  ADD COLUMN delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error text,
  ADD COLUMN dead_lettered_at timestamptz;

CREATE INDEX outbox_delivery_due_idx ON outbox_events(next_attempt_at,occurred_at)
WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX outbox_dead_letter_idx ON outbox_events(dead_lettered_at)
WHERE dead_lettered_at IS NOT NULL;
