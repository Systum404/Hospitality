export function createPendingAdminInvitationDelivery(token) {
  return {
    status: "NOT_SENT",
    invitation_url: `/accept-admin-invitation?token=${encodeURIComponent(token)}`,
  };
}
