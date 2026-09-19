export function Loading() {
  return <div className="state">Đang tải dữ liệu…</div>;
}
export function Failure({ message }: { message: string }) {
  return <div className="state error">{message}</div>;
}
export function Status({ value }: { value: string }) {
  return <span className={`status status-${value.toLowerCase()}`}>{value}</span>;
}
