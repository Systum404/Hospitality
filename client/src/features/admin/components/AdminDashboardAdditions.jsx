import { ArrowRight, BedDouble, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../../components/ui/Badge.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";

function PanelHeading({ icon: Icon, title, to }) {
  const navigate = useNavigate();
  return (
    <div className="admin-card-heading">
      <div className="admin-panel-title"><Icon aria-hidden="true" size={18} /><CardTitle>{title}</CardTitle></div>
      <Button className="view-all-link" onClick={() => navigate(to)} size="sm" variant="ghost">View all <ArrowRight size={15} /></Button>
    </div>
  );
}

function RoomBookingsPanel({ roomBookings }) {
  return (
    <Card className="admin-data-card admin-addition-card admin-balanced-table-card">
      <CardHeader><PanelHeading icon={BedDouble} title="Room Bookings" to="/admin/dashboard#room-bookings" /></CardHeader>
      <CardContent>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Booking ID</th><th>Room No</th><th>Guest Name</th><th>Room Type</th><th>Check In</th><th>Check Out</th></tr></thead><PaginatedTableBody colSpan={6} items={roomBookings}>{(booking) => <tr key={booking.bookingNumber}><td><strong><CopyableIdentifier label="booking ID" value={booking.bookingNumber} /></strong><br /><Badge variant={booking.status === "checked-in" ? "success" : booking.status === "cancelled" ? "danger" : "neutral"}>{booking.status}</Badge></td><td>{booking.roomNumber}</td><td><strong>{booking.guestName}</strong></td><td>{booking.roomType}</td><td>{booking.checkIn}</td><td>{booking.checkOut}</td></tr>}</PaginatedTableBody></table>{!roomBookings.length ? <p className="notification-popover__empty">No room bookings.</p> : null}</div>
      </CardContent>
    </Card>
  );
}

function StaffActivityPanel({ staffActivity }) {
  return (
    <Card className="admin-data-card admin-addition-card admin-balanced-table-card">
      <CardHeader><PanelHeading icon={UsersRound} title="Recent Staff Activity" to="/admin/users" /></CardHeader>
      <CardContent>
        {staffActivity.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Staff ID</th><th>Name</th><th>Role</th><th>Action</th><th>Time</th></tr></thead><PaginatedTableBody colSpan={5} items={staffActivity}>{(activity) => <tr key={activity.id}><td><strong><CopyableIdentifier label="staff ID" value={activity.id} /></strong></td><td><strong>{activity.name}</strong></td><td>{activity.role}</td><td>{activity.action}</td><td>{activity.time}</td></tr>}</PaginatedTableBody></table></div> : <EmptyState icon={UsersRound} title="No staff activity available" description="A staff activity event source is not configured." />}
      </CardContent>
    </Card>
  );
}

export function AdminDashboardAdditions({ roomBookings, staffActivity }) {
  return (
    <section className="admin-additions" aria-label="Additional administration information" id="room-bookings">
      <div className="admin-additions__upper"><RoomBookingsPanel roomBookings={roomBookings} /><StaffActivityPanel staffActivity={staffActivity} /></div>
    </section>
  );
}
