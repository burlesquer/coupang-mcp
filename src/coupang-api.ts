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
export interface SearchOptions {
  query: string;
  limit?: number;
  sortBy?: string;
  minPrice?: number;
  maxPrice?: number;
  rocketOnly?: boolean;
  page?: number;
}

export async function searchProducts(
  queryOrOpts: string | SearchOptions,
  limit: number = 10,
  sortBy: string = "scoreDesc"
): Promise<CoupangProduct[]> {
  const opts: SearchOptions = typeof queryOrOpts === "string"
    ? { query: queryOrOpts, limit, sortBy }
    : queryOrOpts;

  return withPage(async (page) => {
    const params = new URLSearchParams();
    params.set("q", opts.query);
    params.set("sorter", opts.sortBy || "scoreDesc");
    if (opts.minPrice) params.set("minPrice", String(opts.minPrice));
    if (opts.maxPrice) params.set("maxPrice", String(opts.maxPrice));
    if (opts.rocketOnly) params.set("rocketAll", "true");
    if (opts.page && opts.page > 1) params.set("page", String(opts.page));
    const url = `${COUPANG_BASE}/np/search?${params.toString()}`;
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
    }, opts.limit || 10);

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

      // 가격 (final-price-amount > sales-price-amount > total-price)
      const finalPriceEl = body.querySelector(".final-price-amount, .sales-price-amount, .total-price strong, [class*=total-price]");
      let priceText = finalPriceEl?.textContent?.trim().replace(/[,원\s]/g, "") || "";
      // fallback: price-container에서 마지막 가격 추출
      if (!priceText || priceText === "0") {
        const priceContainer = body.querySelector(".price-container, [class*=price-container]");
        const allPrices = priceContainer?.textContent?.match(/([\d,]+)원/g) || [];
        if (allPrices.length > 0) {
          priceText = allPrices[allPrices.length - 1].replace(/[,원]/g, "");
        }
      }

      // 원가 (original-price-amount > origin-price)
      const origEl = body.querySelector(".original-price-amount, .origin-price, .base-price");
      const origText = origEl?.textContent?.trim().replace(/[,원\s]/g, "") || "";

      // 할인율
      const priceContainer = body.querySelector(".price-container, [class*=price-container]");
      const discountMatch = priceContainer?.textContent?.match(/(\d+)\s*%/);
      const discountText = discountMatch ? discountMatch[1] + "%" : "";

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

// ── 상품 상세 스펙 ──────────────────────────────────
export interface ProductSpec {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  discount?: string;
  rating?: number;
  reviewCount?: number;
  isRocket: boolean;
  inStock: boolean;
  seller?: string;
  deliveryInfo?: string;
  specs: Record<string, string>;
  description?: string;
}

export async function getProductSpec(productId: string): Promise<ProductSpec | null> {
  return withPage(async (page) => {
    const url = `${COUPANG_BASE}/vp/products/${productId}`;
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    // 스펙 섹션까지 스크롤
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
    await page.waitForTimeout(1500);

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
      const finalPriceEl = body.querySelector(".final-price-amount, .sales-price-amount, .total-price strong");
      let priceText = finalPriceEl?.textContent?.trim().replace(/[,원\s]/g, "") || "";
      if (!priceText || priceText === "0") {
        const pc = body.querySelector(".price-container");
        const allPrices = pc?.textContent?.match(/([\d,]+)원/g) || [];
        if (allPrices.length > 0) priceText = allPrices[allPrices.length - 1].replace(/[,원]/g, "");
      }

      // 원가
      const origEl = body.querySelector(".original-price-amount, .origin-price");
      const origText = origEl?.textContent?.trim().replace(/[,원\s]/g, "") || "";

      // 할인율
      const pc = body.querySelector(".price-container");
      const discMatch = pc?.textContent?.match(/(\d+)\s*%/);
      const discountText = discMatch ? discMatch[1] + "%" : "";

      // 평점
      const ratingStyle = body.querySelector("[class*=rating-star-num], .star-rating [style]")?.getAttribute("style") || "";
      const ratingMatch = ratingStyle.match(/width:\s*([\d.]+)%/);

      // 리뷰수
      const fullText = body.textContent || "";
      const reviewMatch = fullText.match(/\(([\d,]+)개의 상품평\)/) || fullText.match(/상품평\s*\(([\d,]+)\)/);
      const reviewCountText = reviewMatch ? reviewMatch[1].replace(/,/g, "") : "";

      // 로켓배송
      const isRocket = fullText.includes("로켓배송") || !!body.querySelector("img[alt*=로켓]");

      // 재고
      const oosEl = body.querySelector(".oos-label, .out-of-stock, [class*=not-find], [class*=soldout]");
      const inStock = !oosEl;

      // 판매자
      const sellerEl = body.querySelector("[class*=vendor-name], .prod-sale-vendor-name, a[href*=vender]");
      const seller = sellerEl?.textContent?.trim() || "";

      // 배송
      const deliveryEl = body.querySelector("[class*=delivery], .prod-txt-onyx");
      const deliveryInfo = deliveryEl?.textContent?.trim().substring(0, 100) || "";

      // ── 스펙 테이블 파싱 ──
      const specs: Record<string, string> = {};

      // 필터: 배송/반품/교환 관련 키워드 제외
      const excludeKeywords = [
        "배송", "반품", "교환", "환불", "의류", "잡화", "수입명품",
        "계절상품", "식품", "화장품", "전자/가전", "설치상품",
        "자동차용품", "CD/DVD", "GAME", "BOOK", "판매자",
        "묶음배송", "A/S", "고객센터",
      ];
      const shouldExclude = (key: string, val: string) =>
        excludeKeywords.some((kw) => key.includes(kw) || val.length > 150);

      // 방법1: 첫 번째 테이블 (상품 정보 테이블)
      const tables = body.querySelectorAll("table");
      if (tables.length > 0) {
        const specTable = tables[0]; // 첫 번째 테이블이 스펙
        const rows = specTable.querySelectorAll("tr");
        rows.forEach((row) => {
          const cells = row.querySelectorAll("th, td");
          for (let i = 0; i < cells.length - 1; i += 2) {
            const key = cells[i]?.textContent?.trim();
            const val = cells[i + 1]?.textContent?.trim();
            if (key && val && key.length < 30 && !shouldExclude(key, val)) {
              specs[key] = val.substring(0, 200);
            }
          }
        });
      }

      // 방법2: dt/dd 쌍
      const dts = body.querySelectorAll("dt");
      dts.forEach((dt) => {
        const key = dt.textContent?.trim() || "";
        const dd = dt.nextElementSibling;
        const val = dd?.textContent?.trim() || "";
        if (key && val && key.length < 30) {
          specs[key] = val.substring(0, 200);
        }
      });

      // 방법3: prod-attr-item
      body.querySelectorAll(".prod-attr-item, [class*=attr-item]").forEach((el) => {
        const key = el.querySelector("dt, [class*=title]")?.textContent?.trim() || "";
        const val = el.querySelector("dd, [class*=desc]")?.textContent?.trim() || "";
        if (key && val) specs[key] = val.substring(0, 200);
      });

      // ── 상품 설명 (간략) ──
      const descEl = body.querySelector(
        ".product-detail-content-inside, [class*=productDetail], .detail-item"
      );
      const description = descEl?.textContent?.trim().substring(0, 500) || "";

      return {
        id: pid,
        name,
        price: parseInt(priceText) || 0,
        originalPrice: origText ? parseInt(origText) || null : null,
        discount: discountText || null,
        rating: ratingMatch ? Math.round((parseFloat(ratingMatch[1]) / 20) * 10) / 10 : null,
        reviewCount: reviewCountText ? parseInt(reviewCountText) : null,
        isRocket,
        inStock,
        seller: seller || null,
        deliveryInfo: deliveryInfo || null,
        specs,
        description: description || null,
      };
    }, productId);

    if (!detail) return null;

    return {
      ...detail,
      originalPrice: detail.originalPrice ?? undefined,
      discount: detail.discount ?? undefined,
      rating: detail.rating ?? undefined,
      reviewCount: detail.reviewCount ?? undefined,
      seller: detail.seller ?? undefined,
      deliveryInfo: detail.deliveryInfo ?? undefined,
      description: detail.description ?? undefined,
    };
  }).catch(() => null);
}

// ── 베스트 100 ──────────────────────────────────────
export interface BestProduct {
  rank: number;
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  discount?: string;
  reviewCount?: number;
  imageUrl?: string;
  url: string;
  isRocket: boolean;
}

export async function getBest100(
  categoryId?: string,
  limit: number = 20
): Promise<BestProduct[]> {
  return withPage(async (page) => {
    const url = categoryId
      ? `${COUPANG_BASE}/np/best100?categoryId=${categoryId}`
      : `${COUPANG_BASE}/np/best100`;
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    const products = await page.evaluate((maxItems: number) => {
      // 베스트100 페이지의 상품 리스트 파싱
      const items = document.querySelectorAll("li[class*=productUnit], li.best-item, li[class*=best]");
      const results: any[] = [];

      // 일반 검색과 동일한 구조일 수도 있음
      if (items.length === 0) {
        // fallback: 모든 상품 링크 기반 파싱
        const links = document.querySelectorAll("a[href*='/vp/products/']");
        const seen = new Set<string>();

        links.forEach((a) => {
          if (results.length >= maxItems) return;
          const href = a.getAttribute("href") || "";
          const idMatch = href.match(/products\/(\d+)/);
          if (!idMatch || seen.has(idMatch[1])) return;
          seen.add(idMatch[1]);

          const container = a.closest("li") || a.closest("div") || a;
          const text = container.textContent || "";

          // 상품명
          const nameEl = container.querySelector("[class*=productName], [class*=name]");
          const name = nameEl?.textContent?.trim() || text.substring(0, 80).trim();

          // 가격
          const priceMatch = text.match(/([\d,]+)원/g);
          const prices = priceMatch?.map((p) => parseInt(p.replace(/[,원]/g, ""))) || [];
          const price = prices.length > 1 ? prices[prices.length - 1] : prices[0] || 0;
          const originalPrice = prices.length > 1 ? prices[0] : undefined;

          // 할인율
          const discountMatch = text.match(/(\d+)\s*%/);

          // 리뷰
          const reviewMatch = text.match(/\(([\d,]+)\)/);

          // 이미지
          const imgEl = container.querySelector("img") as HTMLImageElement;
          const imgSrc = imgEl?.src || "";

          // 로켓
          const isRocket = text.includes("로켓") || !!container.querySelector("img[alt*=로켓]");

          if (!name || !price) return;

          results.push({
            rank: results.length + 1,
            id: idMatch[1],
            name,
            price,
            originalPrice: originalPrice || null,
            discount: discountMatch ? discountMatch[1] + "%" : null,
            reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, "")) : null,
            imageUrl: imgSrc || null,
            url: "https://www.coupang.com" + href.split("?")[0],
            isRocket,
          });
        });

        return results;
      }

      items.forEach((el, i) => {
        if (i >= maxItems) return;
        const linkEl = el.querySelector("a[href*=products]") as HTMLAnchorElement;
        const href = linkEl?.getAttribute("href") || "";
        const idMatch = href.match(/products\/(\d+)/);
        if (!idMatch) return;

        const nameEl = el.querySelector("[class*=productName], [class*=name]");
        const name = nameEl?.textContent?.trim() || "";
        const text = el.textContent || "";

        const priceMatch = text.match(/([\d,]+)원/g);
        const prices = priceMatch?.map((p) => parseInt(p.replace(/[,원]/g, ""))) || [];
        const price = prices.length > 1 ? prices[prices.length - 1] : prices[0] || 0;
        const originalPrice = prices.length > 1 ? prices[0] : undefined;

        const discountMatch = text.match(/(\d+)\s*%/);
        const reviewMatch = text.match(/\(([\d,]+)\)/);
        const imgEl = el.querySelector("figure img, img") as HTMLImageElement;
        const imgSrc = imgEl?.src || "";
        const isRocket = text.includes("로켓") || !!el.querySelector("img[alt*=로켓]");

        if (!name || !price) return;

        results.push({
          rank: i + 1,
          id: idMatch[1],
          name,
          price,
          originalPrice: originalPrice || null,
          discount: discountMatch ? discountMatch[1] + "%" : null,
          reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, "")) : null,
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
      reviewCount: p.reviewCount ?? undefined,
      imageUrl: p.imageUrl ?? undefined,
    }));
  });
}

// ── 상품 비교 ───────────────────────────────────────
export async function compareProducts(
  productIds: string[]
): Promise<ProductDetail[]> {
  const results: ProductDetail[] = [];
  for (const id of productIds) {
    const detail = await getProductDetail(id);
    if (detail) results.push(detail);
  }
  return results;
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
