ALTER TABLE trip_stops ADD COLUMN appointment_start timestamptz;
ALTER TABLE trip_stops ADD COLUMN appointment_end timestamptz;

UPDATE trip_stops SET
  appointment_start=expected_arrival_at-interval '30 minutes',
  appointment_end=expected_arrival_at+interval '30 minutes'
WHERE expected_arrival_at IS NOT NULL;

ALTER TABLE trip_stops ADD CONSTRAINT trip_stop_appointment_order
  CHECK(appointment_start IS NULL OR appointment_end IS NULL OR appointment_start<appointment_end);

CREATE TABLE trip_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  trip_id uuid NOT NULL REFERENCES trips(id),
  previous_driver_user_id uuid REFERENCES users(id),
  new_driver_user_id uuid REFERENCES users(id),
  previous_vehicle_id uuid REFERENCES vehicles(id),
  new_vehicle_id uuid REFERENCES vehicles(id),
  reason text NOT NULL,
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_assignment_history_trip_idx
  ON trip_assignment_history(trip_id,assigned_at DESC);
