import type { Session } from "./auth";

export function ListScreen(_props: { user: Session["user"] }) {
  return <section className="page"><p className="muted">Скоро</p></section>;
}
