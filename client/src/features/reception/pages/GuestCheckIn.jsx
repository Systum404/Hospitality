import { useState } from "react";
import { AlertTriangle, BedDouble, CalendarDays, ClipboardCopy, KeyRound, Search, UserCheck } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { receptionNavigationGroups, receptionProfile } from "../receptionConfig.js";
import { issueReceptionRoomCapability, lookupReceptionBooking } from "../services/receptionService.js";
import { updateRoomBookingStatus } from "../services/roomBookingsService.js";

const statusLabels = {
  reserved: "Reserved",
  confirmed: "Confirmed",
  "checked-in": "Checked In",
  "checked-out": "Checked Out",
  cancelled: "Cancelled",
};

const statusVariants = {
  reserved: "warning",
  confirmed: "info",
  "checked-in": "success",
  "checked-out": "neutral",
  cancelled: "danger",
};

const formatBookingDate = value => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)) : "—";
const formatTimestamp = value => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const money = value => value == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value));

export function GuestCheckIn() {
  const { signOut, user } = useAuth();
  const [bookingNumber, setBookingNumber] = useState("");
  const [booking, setBooking] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [issuedCapability, setIssuedCapability] = useState(null);
  const [isIssuingCapability, setIsIssuingCapability] = useState(false);
  const [toast, setToast] = useState(null);

  const handleError = async (error, title) => {
    if (error?.status === 401) {
      await signOut().catch(() => {});
      return;
    }
    setToast({ title, message: error?.message || "Please try again.", variant: "error" });
  };

  const findBooking = async event => {
    event?.preventDefault();
    const reference = bookingNumber.trim();
    if (!reference || !user?.hotelId || isLookingUp) return;
    setIsLookingUp(true);
    setLookupError("");
    try {
      setBooking(await lookupReceptionBooking(user.hotelId, reference));
      setCapabilityOpen(false);
      setIssuedCapability(null);
    } catch (error) {
      setBooking(null);
      if (error?.status === 401) await signOut().catch(() => {});
      else setLookupError(error?.message || "Booking lookup failed.");
    } finally {
      setIsLookingUp(false);
    }
  };

  const closeCapability = () => {
    if (isIssuingCapability) return;
    setCapabilityOpen(false);
    setIssuedCapability(null);
  };

  const issueCapability = async () => {
    if (!booking || !user?.hotelId || isIssuingCapability) return;
    setIsIssuingCapability(true);
    try {
      setIssuedCapability(await issueReceptionRoomCapability(user.hotelId, booking.bookingId));
    } catch (error) {
      await handleError(error, "Room access not issued");
    } finally {
      setIsIssuingCapability(false);
    }
  };

  const changeStatus = async nextStatus => {
    if (!booking || !user?.hotelId || isUpdating) return;
    setIsUpdating(true);
    try {
      await updateRoomBookingStatus(user.hotelId, booking.bookingId, nextStatus);
      const refreshed = await lookupReceptionBooking(user.hotelId, booking.bookingNumber);
      setBooking(refreshed);
      setToast({
        title: nextStatus === "confirmed" ? "Booking confirmed" : "Guest checked in",
        message: `${refreshed.bookingNumber} · ${statusLabels[refreshed.status] || refreshed.status}`,
      });
    } catch (error) {
      await handleError(error, nextStatus === "confirmed" ? "Booking not confirmed" : "Check-in not completed");
    } finally {
      setIsUpdating(false);
    }
  };

  return <AppShell navigationGroups={receptionNavigationGroups} profile={receptionProfile} title="Reception Dashboard">
    <main className="guest-checkin-page">
      <header className="guest-checkin-header">
        <div>
          <p className="eyebrow">Reception operations</p>
          <h2>Guest Check-In</h2>
          <Breadcrumb />
          <p>Look up a room booking and verify the guest before check-in.</p>
        </div>
      </header>

      <Card className="guest-checkin-lookup-card">
        <CardContent>
          <form className="guest-checkin-lookup" onSubmit={findBooking}>
            <Input
              autoComplete="off"
              label="Booking Reference"
              onChange={event => { setBookingNumber(event.target.value); setLookupError(""); }}
              placeholder="Enter booking reference"
              value={bookingNumber}
            />
            <Button disabled={!bookingNumber.trim() || isLookingUp} icon={Search} type="submit">
              {isLookingUp ? "Looking up..." : "Find Booking"}
            </Button>
          </form>
          {lookupError ? <p className="guest-checkin-lookup__error" role="alert">{lookupError}</p> : null}
        </CardContent>
      </Card>

      {booking ? <Card className="guest-checkin-result-card">
        <CardContent>
          <header className="guest-checkin-result-card__header">
            <div>
              <span className="guest-checkin-result-card__icon"><UserCheck aria-hidden="true" size={22} /></span>
              <div><small>Booking found</small><h3>{booking.guestName}</h3><p><CopyableIdentifier label="booking ID" value={booking.bookingNumber} /></p></div>
            </div>
            <Badge variant={statusVariants[booking.status] || "neutral"}>{statusLabels[booking.status] || booking.status}</Badge>
          </header>

          <dl className="guest-checkin-detail">
            <div><dt>Room</dt><dd>{booking.roomNumber}{booking.roomType ? ` · ${booking.roomType}` : ""}</dd></div>
            <div><dt>Guests</dt><dd>{booking.totalOccupants} ({booking.adults} adults, {booking.children} children)</dd></div>
            <div><dt>Arrival</dt><dd>{formatBookingDate(booking.arrivalAt)}</dd></div>
            <div><dt>Departure</dt><dd>{formatBookingDate(booking.departureAt)}</dd></div>
            <div><dt>Phone</dt><dd>{booking.phone || "—"}</dd></div>
            <div><dt>Email</dt><dd>{booking.email || "—"}</dd></div>
            <div><dt>Room rate</dt><dd>{money(booking.roomRate)}</dd></div>
            <div><dt>Checked in</dt><dd>{formatTimestamp(booking.checkedInAt)}</dd></div>
          </dl>

          <div className="guest-checkin-result-card__footer">
            <div>
              <CalendarDays aria-hidden="true" size={18} />
              <p>{booking.status === "reserved" ? "Confirm this reservation before checking in the guest." : booking.status === "confirmed" ? "This booking is confirmed and ready for check-in." : booking.status === "checked-in" ? "This guest is already checked in." : booking.status === "checked-out" ? "This stay has already been checked out." : "This booking cannot be checked in."}</p>
            </div>
            {booking.status === "reserved" ? <Button disabled={isUpdating} onClick={() => changeStatus("confirmed")}>{isUpdating ? "Confirming..." : "Confirm Booking"}</Button> : null}
            {booking.status === "confirmed" ? <Button disabled={isUpdating} icon={BedDouble} onClick={() => changeStatus("checked-in")} variant="success">{isUpdating ? "Checking in..." : "Check In"}</Button> : null}
            {booking.status === "checked-in" ? <Button disabled={isUpdating} icon={KeyRound} onClick={() => { setIssuedCapability(null); setCapabilityOpen(true); }} variant="outline">Issue room access</Button> : null}
          </div>
        </CardContent>
      </Card> : null}

      <Modal actions={issuedCapability ? <><Button disabled={isIssuingCapability} onClick={closeCapability} variant="ghost">Close</Button><Button disabled={isIssuingCapability} onClick={issueCapability} variant="outline">{isIssuingCapability ? "Reissuing…" : "Reissue access"}</Button></> : <><Button disabled={isIssuingCapability} onClick={closeCapability} variant="ghost">Cancel</Button><Button disabled={isIssuingCapability} onClick={issueCapability}>{isIssuingCapability ? "Issuing…" : "Issue access"}</Button></>} description={booking ? `${booking.bookingNumber} · Room ${booking.roomNumber}` : "Issue room ordering access for this checked-in booking."} isOpen={capabilityOpen} onClose={closeCapability} title="Room ordering access">
        {booking ? <div className="room-capability-handoff">{issuedCapability ? <><div className="room-capability-handoff__warning"><AlertTriangle aria-hidden="true" size={18} /><p>This sensitive access code is shown only now. Reissuing it invalidates the previous code.</p></div><label>Room access code<input aria-label="Issued room access code" autoComplete="off" readOnly type="text" value={issuedCapability.capability} /></label><Button icon={ClipboardCopy} onClick={async () => { try { await navigator.clipboard.writeText(issuedCapability.capability); setToast({ title: "Copied", message: "Room access code copied." }); } catch { setToast({ title: "Unable to copy", message: "Select the code and copy it manually.", variant: "error" }); } }} variant="outline">Copy access code</Button></> : <p className="modal-copy">The code will be displayed once for an in-person handoff. It is not saved in this browser.</p>}</div> : null}
      </Modal>

      {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}
    </main>
  </AppShell>;
}
