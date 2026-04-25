import express from "express";
import http from "http";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;
const BACKEND_PORT = process.env.BACKEND_PORT || 3008;

// Proxy /api to the backend
app.use("/api", (req, res) => {
  const options = {
    hostname: "localhost",
    port: BACKEND_PORT,
    path: "/api" + req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${BACKEND_PORT}` },
  };
  const proxy = http.request(options, (backendRes) => {
    res.writeHead(backendRes.statusCode, backendRes.headers);
    backendRes.pipe(res);
  });
  proxy.on("error", (err) => {
    console.error("Proxy error:", err.message);
    res.status(502).json({ error: "Backend unavailable" });
  });
  req.pipe(proxy);
});

// Serve built React app from public/
app.use(express.static("public"));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dev server running on http://0.0.0.0:${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT",  () => server.close(() => process.exit(0)));
