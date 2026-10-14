import { prisma } from "../db/prisma.js";

export async function checkDatabaseConnection() {
  await prisma.$queryRaw`SELECT 1 AS "ok"`;
}
