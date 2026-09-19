ALTER TABLE trip_stops ADD COLUMN expected_arrival_at timestamptz;

UPDATE trip_stops ts SET expected_arrival_at=
  t.service_date + time '17:00' + (ts.stop_sequence-1) * interval '1 hour'
FROM trips t WHERE t.id=ts.trip_id AND ts.expected_arrival_at IS NULL;

CREATE INDEX trip_stops_expected_arrival_idx
  ON trip_stops(expected_arrival_at) WHERE expected_arrival_at IS NOT NULL;
