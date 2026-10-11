import { createApp } from "./app";
import { openAppDatabase } from "./db/connection";

// Fixed because the Vite dev proxy points at this port.
const PORT = 3001;

createApp(openAppDatabase()).listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
