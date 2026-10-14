# AAZIRA Hotel Management System

AAZIRA is a multi-hotel operations platform covering hotel administration, room operations, restaurant operations, billing, customer QR ordering, reporting, notifications, attendance, and company-level control.

## Technology stack

- Node.js 24+ and Express 5
- React 19, React Router, and Vite
- PostgreSQL with Prisma 7 and `@prisma/adapter-pg`
- JWT session cookies and Argon2id password hashing

## Roles

The supported staff contexts are Super Admin, Hotel Admin, Manager, Reception, Captain, and Kitchen. Public customer workflows use scoped QR and order-tracking capabilities rather than staff authentication.

## Main modules

- Company hotel, plan, identity, assignment, and invitation management
- Hotel rooms, bookings, check-in/out, attendance, customers, inventory, and vendors
- Dining areas/tables, menu, restaurant and room-service orders
- Room and restaurant billing, taxes, discounts, service charge, payments, receipts, and PDFs
- Secure room/table QR ordering and customer order tracking
- Role-scoped dashboards, reports, and operational notifications

## Project structure

- `client/` — React frontend and frontend tests
- `server/` — Express application, domain services, scripts, and integration tests
- `prisma/` — authoritative schema and migration history
- `docs/` — retained product contracts and handover documentation
- `PRODUCTION_DEPLOYMENT.md` — production edge and deployment contract

## Prerequisites

- Node.js 24 or newer
- npm
- PostgreSQL

## Installation

```bash
npm ci
npm ci --prefix client
npx prisma generate
```

## Environment configuration

Copy `.env.example` to an uncommitted `.env` and replace placeholders with environment-specific values. Never commit database credentials, authentication secrets, provisioning passwords, QR capabilities, or other private tokens.

## Database setup

Apply committed migrations to the configured database:

```bash
npx prisma migrate deploy
```

Use `npx prisma migrate status` and `npx prisma validate` during release verification. Do not edit previously applied migrations.

## Development

Run the backend and frontend in separate terminals:

```bash
npm run dev
npm run dev --prefix client
```

The backend defaults to port 4000 and the Vite frontend defaults to port 5173.

## Production build

```bash
npm run check
npm run build --prefix client
npm start
```

Deploy the generated `client/dist` static artifact and the backend using the topology defined in [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md).

## Testing

Focused suites are exposed as `test:*` scripts in `package.json`, for example:

```bash
npm run test:billing
npm run test:bookings
npm run test:qr
npm run test:public-qr-orders
npm run test:reception-notifications
```

Database-backed tests must run against an isolated disposable database, never an operational database.

## Security and deployment responsibilities

- Configure strong secrets through the deployment secret store.
- Use HTTPS, an exact CORS allow-list, trusted-proxy configuration, secure cookies, and appropriate CSP/security headers.
- Configure production email/invitation delivery, monitoring, process supervision, database backups, and restore testing.
- Rate limits are process-local and require shared infrastructure before horizontal scaling.
- Physical QR generation, printing, placement, and operational rotation remain deployment responsibilities; the secure QR application workflows are implemented.
- Payment recording is implemented. External gateway execution, callbacks, online refunds, and settlement reconciliation require separate approved integrations.

See `server/BILLING.md`, `server/NOTIFICATIONS.md`, `server/QR_OPERATIONS.md`, and `docs/SETTINGS_CONTRACT.md` for retained domain documentation.
