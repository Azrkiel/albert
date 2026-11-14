"use client";

import { useEffect, useState } from "react";

export function HealthStatus() {
  const [status, setStatus] = useState("Checking services");

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Health check failed");
        const health: unknown = await response.json();
        if (
          !health || typeof health !== "object" ||
          !("db" in health) || typeof health.db !== "boolean" ||
          !("llm" in health) || typeof health.llm !== "boolean" ||
          !("courseSource" in health) ||
          (health.courseSource !== null && typeof health.courseSource !== "boolean")
        ) throw new Error("Invalid health response");

        if (!controller.signal.aborted) {
          setStatus(health.db && health.llm && health.courseSource !== false
            ? "Services ready" : "Services not ready");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("Service status unavailable");
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, []);

  return (
    <span className="health-status" role="status">
      <span className="status-dot" data-ready={status === "Services ready"} aria-hidden="true" />
      {status}
    </span>
  );
}
