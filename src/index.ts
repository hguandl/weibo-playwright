import WeiboScraper from "./WeiboScraper.js";

async function main() {
  const scraper = new WeiboScraper(6279793937);

  while (true) {
    try {
      await scraper.update();
      await scraper.sleep(15 * 1000);
    } catch (error) {
      console.error("An error occurred:", error);
      break;
    }
  }

  await scraper.close();
}

main();
