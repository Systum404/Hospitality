import { checkDatabaseConnection } from "../services/healthService.js";

export async function getHealth(_req, res) {
  try {
    await checkDatabaseConnection();

    return res.status(200).json({
      status: "ok",
      server: "running",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return res.status(503).json({
      status: "degraded",
      server: "running",
      database: "unavailable",
      timestamp: new Date().toISOString(),
    });
  }
}
