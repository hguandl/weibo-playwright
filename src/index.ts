import "dotenv/config";

import logger from "./logging.js";
import { notify_custom } from "./notifier.js";
import WeiboScraper from "./WeiboScraper.js";

(async () => {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    logger.error("API_URL is not set in environment variables");
    return;
  }

  const scraper = new WeiboScraper(6279793937);

  scraper.onNewMblog((notification) => {
    notify_custom(apiUrl, notification, process.env.API_KEY)
      .then(() => logger.info("Notification sent successfully"))
      .catch((error) => logger.error(error, "Failed to send notification"));
  });

  while (true) {
    try {
      await scraper.update();
      await scraper.sleep(15_000);
    } catch (error) {
      logger.error(error, "Error occurred during scraping, exiting...");
      break;
    }
  }

  await scraper.close();
})();
