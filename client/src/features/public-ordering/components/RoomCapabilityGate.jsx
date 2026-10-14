import { useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";

export function RoomCapabilityGate({ error, hotelName, loading, onSubmit, roomNumber }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const submit = (event) => {
    event.preventDefault();
    if (!value) { inputRef.current?.focus(); return; }
    onSubmit(value);
  };
  return (
    <section className="public-capability-panel" aria-labelledby="room-access-title">
      <span className="public-order-icon"><KeyRound aria-hidden="true" size={24} /></span>
      <p className="public-order-eyebrow">{hotelName}</p>
      <h1 id="room-access-title">Room {roomNumber}</h1>
      <p>Enter the room access code provided by hotel staff to view the menu.</p>
      <form onSubmit={submit}>
        <label htmlFor="room-capability">Room access code</label>
        <input autoCapitalize="none" autoComplete="off" id="room-capability" onChange={(event) => setValue(event.target.value)} ref={inputRef} spellCheck="false" type="password" value={value} />
        {error ? <p className="public-field-error" role="alert">{error}</p> : null}
        <Button disabled={loading || !value} type="submit">{loading ? "Verifying…" : "Continue to menu"}</Button>
      </form>
      <small>The code is used only for this page and is not saved on this device.</small>
    </section>
  );
}
