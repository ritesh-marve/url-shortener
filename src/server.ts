import { env } from "./config/env.js";
import app from "./app";

const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});