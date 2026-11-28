import { env } from "./config/env.js";
import app from "./app.js";
import { logger } from "./observability/logger.js";
import "./workers/analyticsWorker.js";
const PORT = env.PORT;

app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server started")
});