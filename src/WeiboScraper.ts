import { chromium, type Browser, type Page, type Response } from "playwright";
import { z } from "zod";
import logger from "./logging.js";
import type { NotifyCallback } from "./notifier.js";

const IndexSchema = z.object({
  data: z.object({
    userInfo: z.object({
      screen_name: z.string(),
    }),
    tabsInfo: z.object({
      tabs: z.array(
        z.object({
          tab_type: z.string(),
          containerid: z.string(),
        }),
      ),
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
  private containerId: string | null = null;

  private latestDate: Date | null = null;
  private newMblogCallback: NotifyCallback | null = null;

  constructor(uid: string | number, browser?: Browser) {
    this.uid = String(uid);
    this.browser = browser || null;
  }

  private process = async (response: Response) => {
    const text = await response.text();
    if (!text) return;

    const payload = (() => {
      try {
        return JSON.parse(text);
      } catch (err) {
        logger.error(err, "Failed to parse JSON response: %s", text);
        return null;
      }
    })();
    if (!payload) {
      return;
    }

    if (!this.uname || !this.containerId) {
      const isIndex = IndexSchema.safeParse(payload);
      if (isIndex.success) {
        this.uname = isIndex.data.data.userInfo.screen_name;
        logger.info(`Initializing user info: ${this.uname}`);
        const tabs = isIndex.data.data.tabsInfo.tabs;
        for (const tab of tabs) {
          if (tab.tab_type === "weibo") {
            this.containerId = tab.containerid;
            logger.info(`Found container id: ${this.containerId}`);
            break;
          }
        }
      }
      return;
    }

    if (!response.request().url().includes(`containerid=${this.containerId}`)) {
      return;
    }

    const isCardList = CardListSchema.safeParse(payload);
    if (!isCardList.success) {
      logger.error(isCardList.error, "Failed to parse card list:");
      return;
    }

    logger.info(`Processing ${isCardList.data.data.cards.length} cards`);

    if (!this.latestDate) {
      for (const card of isCardList.data.data.cards) {
        const date = new Date(card.mblog.created_at);
        if (!this.latestDate || date.getTime() > this.latestDate.getTime()) {
          this.latestDate = date;
        }
      }
      logger.info("Initialized latest date to %s", this.latestDate);
      return;
    }

    for (const card of isCardList.data.data.cards) {
      if (card.card_type !== 9) {
        continue;
      }

      const mblog = card.mblog;
      if (mblog.retweeted_status) {
        continue;
      }

      const date = new Date(mblog.created_at);
      if (date.getTime() > this.latestDate.getTime()) {
        this.latestDate = date;
      } else {
        continue;
      }

      const text = mblog.text
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<img[^>]+alt=["']([^"']+)["'][^>]*>/g, "$1")
        .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, (_m, p1) => {
          const label = ((p1 as string) ?? "").replace(/<[^>]+>/g, "");
          if (label === "全文") return "";
          if (label === "明日方舟") return "";
          if (label.startsWith("#") && label.endsWith("#")) return "";
          return label;
        })
        .replace(/<[^>]+>/g, "")
        .replace(/&[a-z\d#]+;/gi, (match: string): string => {
          const entities: Record<string, string> = {
            "&nbsp;": " ",
            "&lt;": "<",
            "&gt;": ">",
            "&amp;": "&",
            "&quot;": '"',
          };
          return entities[match.toLowerCase()] || match;
        })
        .replace(/[^\S\r\n]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
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

      const notification = {
        title: `微博 ${this.uname}`,
        body: text,
        url: pageUrl,
        picurl: picUrl,
      };

      logger.info(notification, "New mblog at %s", date);
      this.newMblogCallback?.(notification);
    }
  };

  private start = async () => {
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
      this.process(response);
    });

    await this.page.goto(`https://m.weibo.cn/u/${this.uid}`);
    await this.page.waitForLoadState("networkidle");
  };

  onNewMblog = (callback: NotifyCallback) => {
    this.newMblogCallback = callback;
  };

  update = async () => {
    if (!this.latestDate) {
      await this.start();
      return;
    }

    if (!this.page) {
      throw new Error("Page is not initialized.");
    }

    await this.page.reload();
    await this.page.waitForLoadState("networkidle");
  };

  sleep = async (timeout: number) => {
    if (!this.page) {
      throw new Error("Page is not initialized.");
    }
    await this.page.waitForTimeout(timeout);
  };

  close = async () => {
    await this.page?.close();
    this.page = null;
    if (this.ownsBrowser) await this.browser?.close();
    this.browser = null;
  };
}
