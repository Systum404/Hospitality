import "dotenv/config";
import { bootstrapDevelopmentSuperAdmin, validateDevelopmentSuperAdminEnvironment } from "../services/developmentSuperAdminBootstrapService.js";

let prisma;
try {
  const config = validateDevelopmentSuperAdminEnvironment(process.env);
  ({ prisma } = await import("../db/prisma.js"));
  const result = await bootstrapDevelopmentSuperAdmin(prisma, config);

  console.log("Development Super Admin bootstrap completed.");
  console.log(`Email: ${result.email}`);
  console.log(`Role: ${result.roleKey}`);
  console.log(`Scope: ${result.scope}`);
  console.log(`Status: ${result.status}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Development Super Admin bootstrap failed.");
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect();
}
