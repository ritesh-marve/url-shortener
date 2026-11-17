import express from "express";
import healthRoutes from "./routes/health.routes";

const app = express();

// Middleware: parses JSON request bodies
app.use(express.json());

app.use(healthRoutes);

export default app;