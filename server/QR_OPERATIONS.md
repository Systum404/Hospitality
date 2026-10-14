# QR Operations Boundary

Company Operations owns creation and provision of QR mappings, physical QR generation, printing, placement, and replacement. AAZIRA does not provide a staff-facing QR generation or provisioning workflow.

AAZIRA software consumes configured room and dining-table mappings, validates token and hotel/target eligibility, serves the customer experience at `/qr/:token`, and enforces room capability, hotel scope, table scope, and order security.

Room access capabilities remain separate from physical QR provisioning. An authorized Hotel Admin, Manager, or Reception user may issue or reissue the existing one-time room capability for an eligible checked-in booking; only its SHA-256 hash is persisted.
