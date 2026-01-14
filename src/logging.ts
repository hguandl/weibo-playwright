import pino from "pino";

const logger = pino({
  timestamp: pino.stdTimeFunctions.isoTime,
  name: "weibo-playwright",
  level: process.env.LOG_LEVEL || "info",
});

export default logger;
