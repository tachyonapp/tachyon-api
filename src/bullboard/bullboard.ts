import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import basicAuth from "basic-auth-connect";
import { type Express } from "express";
import { getAllQueues } from "../queues";

export function mountDashboard(app: Express): void {
  if (process.env.NODE_ENV === "production") return;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/internal/bull-board");

  createBullBoard({
    queues: getAllQueues().map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  // Basic auth in staging; open in local dev
  if (process.env.NODE_ENV === "staging") {
    app.use(
      "/internal/bull-board",
      basicAuth(
        process.env.BULL_BOARD_USERNAME ?? "",
        process.env.BULL_BOARD_PASSWORD ?? "",
      ),
    );
  }

  app.use("/internal/bull-board", serverAdapter.getRouter());
  console.log("Bull Board mounted at /internal/bull-board");
}

