import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { environment } from "../config/environment.js";

const adapter = new PrismaPg({
  connectionString: environment.databaseUrl,
});

export const prisma = new PrismaClient({
  adapter,
  log: environment.isProduction ? ["error"] : ["warn", "error"],
});
