import { app } from "./app.js";
import { environment } from "./config/environment.js";
import { prisma } from "./db/prisma.js";

const server = app.listen(environment.port, () => {
  console.log(`AAZIRA backend listening on port ${environment.port}`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received. Shutting down gracefully.`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error("Failed to disconnect Prisma cleanly:", error);
      process.exit(1);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
