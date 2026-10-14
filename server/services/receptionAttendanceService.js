import { randomUUID } from "node:crypto";
import { ROLE_KEYS } from "../config/roles.js";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const allowedStatuses = new Set(["present", "absent"]);

export function hotelAttendanceDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseBusinessDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError("date must use YYYY-MM-DD format.", { code: "INVALID_ATTENDANCE_DATE", statusCode: 400 });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError("date must be a valid calendar date.", { code: "INVALID_ATTENDANCE_DATE", statusCode: 400 });
  }
  return date;
}

async function attendanceContext(client, hotelId, requestedDate, now = new Date()) {
  const hotel = await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true, timezone: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: hotel.timezone }).format(now);
  } catch {
    throw new AppError("The hotel's timezone configuration is invalid.", { code: "INVALID_HOTEL_TIMEZONE", statusCode: 500 });
  }
  const today = hotelAttendanceDateKey(now, hotel.timezone);
  const date = requestedDate ?? today;
  return { date, dateValue: parseBusinessDate(date), timezone: hotel.timezone, today };
}

function serializeRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    status: record.status,
    recordedAt: record.recorded_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export async function getReceptionAttendance(hotelId, requestedDate) {
  const context = await attendanceContext(prisma, hotelId, requestedDate);
  const [assignments, records] = await Promise.all([
    prisma.user_role.findMany({
      where: { hotel_id: hotelId, users: { is_active: true } },
      select: {
        users: { select: { id: true, name: true, email: true } },
        role: { select: { name: true } },
      },
      orderBy: [{ users: { name: "asc" } }, { role: { name: "asc" } }],
    }),
    prisma.attendance.findMany({
      where: { hotel_id: hotelId, attendance_date: context.dateValue },
      select: {
        id: true, status: true, recorded_at: true, updated_at: true,
        user: { select: { id: true, name: true, email: true, is_active: true } },
      },
    }),
  ]);

  const people = new Map();
  for (const assignment of assignments) {
    const current = people.get(assignment.users.id) ?? { ...assignment.users, roles: [] };
    if (!current.roles.includes(assignment.role.name)) current.roles.push(assignment.role.name);
    people.set(current.id, current);
  }
  for (const record of records) {
    if (!people.has(record.user.id)) people.set(record.user.id, { ...record.user, roles: [] });
  }
  const byUser = new Map(records.map(record => [record.user.id, record]));
  const users = [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles.sort(),
    isActive: user.is_active,
    attendance: serializeRecord(byUser.get(user.id)),
    attendanceStatus: byUser.get(user.id)?.status ?? "unmarked",
  }));

  return { date: context.date, timezone: context.timezone, users };
}

export async function recordReceptionAttendance(hotelId, actor, input) {
  if (!allowedStatuses.has(input.status)) {
    throw new AppError("status must be present or absent.", { code: "INVALID_ATTENDANCE_STATUS", statusCode: 400 });
  }

  const operation = () => prisma.$transaction(async tx => {
    const context = await attendanceContext(tx, hotelId, input.attendanceDate);
    if (context.date > context.today) {
      throw new AppError("Attendance cannot be recorded for a future hotel-local date.", { code: "FUTURE_ATTENDANCE_DATE", statusCode: 400 });
    }

    const assignment = await tx.user_role.findFirst({
      where: { hotel_id: hotelId, user_id: input.userId, users: { is_active: true } },
      select: { id: true, user_id: true },
    });
    if (!assignment) {
      throw new AppError("Active user not found for this hotel.", { code: "ATTENDANCE_USER_NOT_FOUND", statusCode: 404 });
    }

    const key = { hotel_id_user_id_attendance_date: { hotel_id: hotelId, user_id: input.userId, attendance_date: context.dateValue } };
    const existing = await tx.attendance.findUnique({ where: key });
    if (existing && actor.roleKey === ROLE_KEYS.RECEPTION && existing.status !== input.status) {
      throw new AppError("Reception cannot correct an attendance record after it has been marked.", { code: "ATTENDANCE_CORRECTION_FORBIDDEN", statusCode: 403 });
    }

    const now = new Date();
    return serializeRecord(await tx.attendance.upsert({
      where: key,
      create: {
          id: randomUUID(), hotel_id: hotelId, user_id: input.userId, user_role_id: assignment.id,
        attendance_date: context.dateValue, status: input.status,
          recorded_by: actor.userId, recorded_at: now, updated_at: now,
      },
      update: existing?.status === input.status ? {} : { status: input.status, recorded_by: actor.userId, updated_at: now },
    }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      if (attempt === 2) break;
    }
  }
  throw new AppError("Attendance could not be recorded.", { code: "ATTENDANCE_CONFLICT", statusCode: 409 });
}
