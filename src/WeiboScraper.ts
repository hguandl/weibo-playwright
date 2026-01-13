import { chromium, type Browser, type Page } from "playwright";
import { z } from "zod";

const IndexSchema = z.object({
  data: z.object({
    userInfo: z.object({
      screen_name: z.string(),
    }),
  }),
});

const MblogSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string(),
  original_pic: z.string().optional(),
  page_info: z
    .object({
      type: z.string(),
      page_pic: z.object({
        url: z.string(),
      }),
      page_url: z.string(),
    })
    .optional(),
  retweeted_status: z.object().optional(),
});

const CardListSchema = z.object({
  data: z.object({
    cards: z.array(
      z.object({
        card_type: z.number().optional(),
        mblog: MblogSchema,
      }),
    ),
  }),
});

export default class WeiboScraper {
  private uid: string;
  private browser: Browser | null = null;

  private ownsBrowser: boolean = false;
  private page: Page | null = null;

  private uname: string | null = null;
  private latestDate: Date | null = null;

  private newMblogCallback:
    | ((title: string, body: string, url: string, picUrl: string) => void)
    | null = null;

  constructor(uid: string | number, browser?: Browser) {
    this.uid = String(uid);
    this.browser = browser || null;
  }

  private async start() {
    if (!this.browser) {
      this.browser = await chromium.launch();
      this.ownsBrowser = true;
    }
    if (!this.page) {
      this.page = await this.browser.newPage();
    }

    this.page.on("response", (response) => {
      const request = response.request();
      if (request.resourceType() !== "xhr") {
        return;
      }
      if (!request.url().includes("/api/container/getIndex")) {
        return;
      }
      (async () => {
        const payload = await response.json();

        if (!this.uname) {
          const isIndex = IndexSchema.safeParse(payload);
          if (isIndex.success) {
            this.uname = isIndex.data.data.userInfo.screen_name;
          }
          return;
        }

        const isCardList = CardListSchema.safeParse(payload);
        if (isCardList.success) {
          for (const card of isCardList.data.data.cards) {
            if (card.card_type !== 9) {
              continue;
            }

            const mblog = card.mblog;
            if (mblog.retweeted_status) {
              continue;
            }

            const date = new Date(mblog.created_at);
            if (!this.latestDate) {
              this.latestDate = date;
            } else if (date.getTime() > this.latestDate.getTime()) {
              this.latestDate = date;
            } else {
              continue;
            }

            const text = mblog.text
              .replace(/<a [^>]+>.+?<\/a>/g, "")
              .replace(/<br\s*\/>/g, "\n")
              .trim();
            if (
              text.includes("微博官方唯一抽奖工具") &&
              text.includes("结果公正有效")
            ) {
              continue;
            }

            let picUrl = mblog.original_pic || "";
            let pageUrl = `https://m.weibo.cn/status/${mblog.id}`;

            if (
              mblog.page_info?.type === "article" ||
              mblog.page_info?.type === "video"
            ) {
              picUrl = mblog.page_info.page_pic.url;
            }

            if (mblog.page_info?.type === "article") {
              pageUrl = mblog.page_info.page_url;
            }

            console.log("New Mblog found at", mblog.created_at);
            console.log("Text:", text);
            console.log("URL:", pageUrl);
            console.log("Picture URL:", picUrl);
            console.log("-----");

            // this.newMblogCallback?.(this.uname, text, pageUrl, picUrl);
          }
        }
      })();
    });

    await this.page.goto(`https://m.weibo.cn/u/${this.uid}`);
    await this.page.waitForLoadState("networkidle");
  }

  async update() {
    if (!this.latestDate) {
      await this.start();
      return;
    }

    if (!this.page) {
      throw new Error("Page is not initialized.");
    }

    await this.page.reload();
    await this.page.waitForLoadState("networkidle");
  }

  async sleep(timeout: number) {
    if (!this.page) {
      throw new Error("Page is not initialized.");
    }
    await this.page.waitForTimeout(timeout);
  }

  async close() {
    await this.page?.close();
    this.page = null;
    if (this.ownsBrowser) await this.browser?.close();
    this.browser = null;
  }
}
