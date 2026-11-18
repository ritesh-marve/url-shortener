import express from "express";
import healthRoutes from "./routes/health.routes.js";
import { errorHandler } from "./middleware/errorhandler.js";
import linksRoutes from "./routes/links.routes.js";
import redirectRoutes from "./routes/redirect.routes.js";

const app = express();

// Middleware: parses JSON request bodies
app.use(express.json());

app.use(healthRoutes);
app.use(linksRoutes);
app.use(redirectRoutes);

app.use(errorHandler);

export default app;