import express from "express";
import healthRRoutes from "./routes/health.routes";

const app = express();

// Middleware: parses JSON request bodies
app.use(express.json());

app.use(healthRRoutes);

export default app;