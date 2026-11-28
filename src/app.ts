import express from "express";
import healthRoutes from "./routes/health.routes.js";
import { errorHandler } from "./middleware/errorhandler.js";
import linksRoutes from "./routes/links.routes.js";
import redirectRoutes from "./routes/redirect.routes.js";
import pinoHttp from "pino-http";
import { logger } from "./observability/logger.js";

const app = express();
app.use(pinoHttp({ logger }));
// Middleware: parses JSON request bodies
app.use(express.json());

app.use(express.static("public"));
app.use(healthRoutes);
app.use(linksRoutes);
app.use(redirectRoutes);

app.use(errorHandler);

export default app;