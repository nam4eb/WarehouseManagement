CREATE INDEX trips_driver_schedule_idx
  ON trips(organization_id,driver_user_id,service_date)
  WHERE driver_user_id IS NOT NULL;

CREATE INDEX trips_vehicle_schedule_idx
  ON trips(organization_id,vehicle_id,service_date)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX trip_assignment_history_org_idx
  ON trip_assignment_history(organization_id,assigned_at DESC);
