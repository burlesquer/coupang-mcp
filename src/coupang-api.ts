import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const COUPANG_BASE = "https://www.coupang.com";
const CDP_URL = process.env.COUPANG_CDP_URL || "http://localhost:9222";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.connectOverCDP(CDP_URL);
  }
  return browser;
}

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const ctx = b.contexts()[0];
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export interface CoupangProduct {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  discount?: string;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  url: string;
  isRocket: boolean;
}

export interface ProductDetail {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  discount?: string;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  url: string;
  isRocket: boolean;
  inStock: boolean;
  deliveryInfo?: string;
  seller?: string;
}

export interface Review {
  userName: string;
  rating: number;
  date: string;
  title?: string;
  content: string;
  helpful?: number;
}

// ── 상품 검색 ───────────────────────────────────────
export async function searchProducts(
  query: string,
  limit: number = 10,
  sortBy: string = "scoreDesc"
): Promise<CoupangProduct[]> {
  return withPage(async (page) => {
    const url = `${COUPANG_BASE}/np/search?q=${encodeURIComponent(query)}&sorter=${sortBy}`;
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    const products = await page.evaluate((maxItems: number) => {
      const items = document.querySelectorAll("li[class*=productUnit]");
      const results: any[] = [];

      items.forEach((el, i) => {
        if (i >= maxItems) return;

        const linkEl = el.querySelector("a[href*=products]") as HTMLAnchorElement;
        const href = linkEl?.getAttribute("href") || "";
        const idMatch = href.match(/products\/(\d+)/);
        if (!idMatch) return;

        // 상품명
        const nameEl = el.querySelector("[class*=productName]");
        const name = nameEl?.textContent?.trim() || "";

        // 가격 영역
        const priceArea = el.querySelector("[class*=priceArea]");
        const delEl = priceArea?.querySelector("del");
        const originalPriceText = delEl?.textContent?.trim().replace(/[,원\s]/g, "") || "";

        // 할인율
        const allText = priceArea?.textContent || "";
        const discountMatch = allText.match(/(\d+)\s*%/);
        const discount = discountMatch ? discountMatch[1] + "%" : "";

        // 판매가 - span 안의 가격
        const priceSpans = priceArea?.querySelectorAll("span") || [];
        let priceText = "";
        priceSpans.forEach((span) => {
          const t = span.textContent?.trim() || "";
          if (t.match(/^[\d,]+원$/) && !span.closest("del")) {
            priceText = t.replace(/[,원]/g, "");
          }
        });
        // fallback: bold price text
        if (!priceText) {
          const boldPrice = priceArea?.querySelector("[class*=fw-font-bold] span, [class*=fw-text-]");
          priceText = boldPrice?.textContent?.trim().replace(/[,원%\s\d]*?(\d[\d,]+)원.*/, "$1").replace(/,/g, "") || "0";
        }

        // 이미지
        const imgEl = el.querySelector("figure img") as HTMLImageElement;
        const imgSrc = imgEl?.src || imgEl?.getAttribute("data-src") || "";

        // 리뷰 수: (4,609) 패턴
        const fullText = el.textContent || "";
        const reviewMatch = fullText.match(/\(([\d,]+)\)/);
        const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, "")) : 0;

        // 로켓배송
        const isRocket = fullText.includes("로켓") || !!el.querySelector("img[alt*=로켓], [class*=rocket]");

        if (!name || priceText === "0") return;

        results.push({
          id: idMatch[1],
          name,
          price: parseInt(priceText) || 0,
          originalPrice: originalPriceText ? parseInt(originalPriceText) || null : null,
          discount: discount || null,
          reviewCount: reviewCount || null,
          imageUrl: imgSrc || null,
          url: "https://www.coupang.com" + href.split("?")[0],
          isRocket,
        });
      });

      return results;
    }, limit);

    return products.map((p: any) => ({
      ...p,
      originalPrice: p.originalPrice ?? undefined,
      discount: p.discount ?? undefined,
      rating: p.rating ?? undefined,
      reviewCount: p.reviewCount ?? undefined,
      imageUrl: p.imageUrl ?? undefined,
    }));
  });
}

// ── 상품 상세 (가격/재고) ───────────────────────────
export async function getProductDetail(
  productId: string
): Promise<ProductDetail | null> {
  return withPage(async (page) => {
    const url = `${COUPANG_BASE}/vp/products/${productId}`;
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    const detail = await page.evaluate((pid: string) => {
      const body = document.body;
      if (!body) return null;

      // 상품명
      const nameEl = body.querySelector(
        "h1.prod-buy-header__title, .prod-buy-header__title, h1[class*=title], h2.prod-buy-header__title"
      );
      const name = nameEl?.textContent?.trim() || "";
      if (!name) return null;

      // 가격
      const priceEl = body.querySelector(
        ".total-price strong, [class*=total-price], .prod-sale-price strong"
      );
      const priceText = priceEl?.textContent?.trim().replace(/[,원\s]/g, "") || "0";

      // 원가
      const origEl = body.querySelector(".origin-price, .base-price, del");
      const origText = origEl?.textContent?.trim().replace(/[,원\s]/g, "") || "";

      // 할인율
      const discountEl = body.querySelector(".discount-rate, [class*=discount-rate]");
      const discountText = discountEl?.textContent?.trim() || "";

      // 평점
      const ratingStyle = body.querySelector("[class*=rating-star-num], .star-rating [style]")?.getAttribute("style") || "";
      const ratingMatch = ratingStyle.match(/width:\s*([\d.]+)%/);

      // 리뷰수
      const fullText = body.textContent || "";
      const reviewMatch = fullText.match(/\(([\d,]+)개의 상품평\)/) || fullText.match(/상품평\s*\(([\d,]+)\)/);
      const reviewCountText = reviewMatch ? reviewMatch[1].replace(/,/g, "") : "";

      // 이미지
      const imgEl = body.querySelector(".prod-image__detail img, .prod-image img, [class*=prodImage] img") as HTMLImageElement;
      const imgSrc = imgEl?.src || "";

      // 로켓배송
      const isRocket = fullText.includes("로켓배송") || !!body.querySelector("img[alt*=로켓]");

      // 재고
      const oosEl = body.querySelector(".oos-label, .out-of-stock, [class*=not-find], [class*=soldout]");
      const inStock = !oosEl;

      // 배송
      const deliveryEl = body.querySelector("[class*=delivery], .prod-txt-onyx");
      const deliveryInfo = deliveryEl?.textContent?.trim().substring(0, 100) || "";

      // 판매자
      const sellerEl = body.querySelector("[class*=vendor-name], .prod-sale-vendor-name, a[href*=vender]");
      const seller = sellerEl?.textContent?.trim() || "";

      return {
        id: pid,
        name,
        price: parseInt(priceText) || 0,
        originalPrice: origText ? parseInt(origText) || null : null,
        discount: discountText || null,
        rating: ratingMatch ? Math.round((parseFloat(ratingMatch[1]) / 20) * 10) / 10 : null,
        reviewCount: reviewCountText ? parseInt(reviewCountText) : null,
        imageUrl: imgSrc || null,
        url: window.location.href,
        isRocket,
        inStock,
        deliveryInfo: deliveryInfo || null,
        seller: seller || null,
      };
    }, productId);

    if (!detail) return null;

    return {
      ...detail,
      originalPrice: detail.originalPrice ?? undefined,
      discount: detail.discount ?? undefined,
      rating: detail.rating ?? undefined,
      reviewCount: detail.reviewCount ?? undefined,
      imageUrl: detail.imageUrl ?? undefined,
      deliveryInfo: detail.deliveryInfo ?? undefined,
      seller: detail.seller ?? undefined,
    };
  }).catch(() => null);
}

// ── 리뷰 조회 ──────────────────────────────────────
export async function getProductReviews(
  productId: string,
  reviewPage: number = 1
): Promise<Review[]> {
  return withPage(async (page) => {
    const url = `${COUPANG_BASE}/vp/products/${productId}`;
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    // 리뷰 섹션으로 스크롤
    await page.evaluate(() => {
      const el = document.querySelector("[class*=sdp-review], #btfTab");
      if (el) el.scrollIntoView();
      else window.scrollTo(0, document.body.scrollHeight * 0.7);
    });
    await page.waitForTimeout(2000);

    // 페이지 이동
    if (reviewPage > 1) {
      const btn = page.locator(`[data-page="${reviewPage}"]`);
      if ((await btn.count()) > 0) {
        await btn.click();
        await page.waitForTimeout(2000);
      }
    }

    const reviews = await page.evaluate(() => {
      const items = document.querySelectorAll(
        "[class*=sdp-review__article__list__review], [class*=ReviewContent]"
      );
      return Array.from(items).map((el) => {
        const userEl = el.querySelector("[class*=user__name], [class*=ProfileName]");
        const userName = userEl?.textContent?.trim() || "익명";

        const ratingStyle =
          el.querySelector("[class*=star__mask], [class*=RatingMask]")?.getAttribute("style") || "";
        const ratingMatch = ratingStyle.match(/width:\s*([\d.]+)%/);

        const dateEl = el.querySelector("[class*=reg-date], [class*=RegistDate]");
        const date = dateEl?.textContent?.trim() || "";

        const titleEl = el.querySelector("[class*=headline], [class*=Headline]");
        const title = titleEl?.textContent?.trim() || "";

        const contentEl = el.querySelector("[class*=review__content], [class*=Content]");
        const content = contentEl?.textContent?.trim() || "";

        const helpfulEl = el.querySelector("[class*=help__count], [class*=HelpfulCount]");
        const helpfulText = helpfulEl?.textContent?.trim() || "0";

        return {
          userName,
          rating: ratingMatch ? Math.round((parseFloat(ratingMatch[1]) / 20) * 10) / 10 : 0,
          date,
          title: title || null,
          content,
          helpful: parseInt(helpfulText) || 0,
        };
      });
    });

    return reviews.map((r: any) => ({
      ...r,
      title: r.title ?? undefined,
    }));
  }).catch(() => []);
}

// ── 재고 확인 ───────────────────────────────────────
export async function checkInventory(
  productId: string
): Promise<{ inStock: boolean; deliveryInfo?: string; seller?: string; price?: number }> {
  const detail = await getProductDetail(productId);
  if (!detail) return { inStock: false };
  return {
    inStock: detail.inStock,
    deliveryInfo: detail.deliveryInfo,
    seller: detail.seller,
    price: detail.price,
  };
}

// ── 브라우저 연결 해제 ──────────────────────────────
export async function closeBrowser(): Promise<void> {
  if (browser) {
    browser.close().catch(() => {});
    browser = null;
  }
}
