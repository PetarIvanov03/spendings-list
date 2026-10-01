import type { Session } from "./auth";
import { Sheet } from "./components";

export function ChangePinSheet(props: { user: Session["user"]; onClose: () => void; onChanged: () => void }) {
  return <Sheet title="Смяна на ПИН" onClose={props.onClose}><p className="muted">Скоро</p></Sheet>;
}
