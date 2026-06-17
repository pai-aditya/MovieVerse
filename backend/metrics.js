// Prometheus instrumentation. Exposes default process/Node metrics plus custom
// HTTP request counters and latency histograms scraped at GET /metrics.

import client from "prom-client";

const register = new client.Registry();
register.setDefaultLabels({ app: "movieverse-backend" });
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Express middleware: records count + duration per request once the response
// finishes. Uses the matched route template (e.g. /lists/getList/:listID) as the
// label to keep cardinality bounded.
export function metricsMiddleware(req, res, next) {
  const stop = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route?.path || req.path || "unknown";
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    stop(labels);
  });
  next();
}

export { register };
