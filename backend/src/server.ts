import { createApp } from "./app";

// Fixed because the Vite dev proxy points at this port.
const PORT = 3001;

createApp().listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
