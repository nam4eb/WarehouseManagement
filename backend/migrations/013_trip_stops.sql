ALTER TABLE locations ADD COLUMN address_line text;
ALTER TABLE locations ADD COLUMN latitude numeric(9,6) CHECK(latitude BETWEEN -90 AND 90);
ALTER TABLE locations ADD COLUMN longitude numeric(9,6) CHECK(longitude BETWEEN -180 AND 180);

CREATE TABLE trip_stops (
  trip_id uuid NOT NULL REFERENCES trips(id),
  customer_location_id uuid NOT NULL REFERENCES locations(id),
  stop_sequence integer NOT NULL CHECK(stop_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(trip_id,customer_location_id),
  UNIQUE(trip_id,stop_sequence)
);

INSERT INTO trip_stops(trip_id,customer_location_id,stop_sequence)
SELECT trip_id,customer_location_id,
  row_number() OVER(PARTITION BY trip_id ORDER BY min(created_at),customer_location_id)
FROM trip_manifest_lines
GROUP BY trip_id,customer_location_id
ON CONFLICT DO NOTHING;

CREATE INDEX trip_stops_route_idx ON trip_stops(trip_id,stop_sequence);
