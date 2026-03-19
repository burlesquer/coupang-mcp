#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  searchProducts,
  getProductDetail,
  getProductReviews,
  checkInventory,
  closeBrowser,
} from "./coupang-api.js";

const server = new McpServer({
  name: "coupang-mcp",
  version: "1.0.0",
});

// ── Tool 1: 상품 검색 ──────────────────────────────────
server.tool(
  "coupang_search_products",
  "쿠팡에서 상품을 키워드로 검색합니다. 상품명, 가격, 평점, 리뷰 수, 로켓배송 여부 등을 조회합니다.",
  {
    keyword: z.string().describe("검색 키워드 (예: '아이폰 15', '무선 이어폰')"),
    limit: z.number().optional().default(10).describe("결과 수 (기본값: 10)"),
    sortBy: z
      .enum(["scoreDesc", "salePriceAsc", "salePriceDesc", "saleCountDesc"])
      .optional()
      .default("scoreDesc")
      .describe("정렬: scoreDesc(추천순), salePriceAsc(낮은가격순), salePriceDesc(높은가격순), saleCountDesc(판매량순)"),
  },
  async ({ keyword, limit, sortBy }) => {
    try {
      const products = await searchProducts(keyword, limit, sortBy);

      if (products.length === 0) {
        return {
          content: [{ type: "text" as const, text: `"${keyword}" 검색 결과가 없습니다.` }],
        };
      }

      const result = products.map((p, i) => {
        let line = `${i + 1}. **${p.name}**\n`;
        line += `   - 가격: ${p.price.toLocaleString()}원`;
        if (p.originalPrice) line += ` (원가: ${p.originalPrice.toLocaleString()}원)`;
        if (p.discount) line += ` ${p.discount}`;
        line += "\n";
        if (p.rating) line += `   - 평점: ${p.rating}점`;
        if (p.reviewCount) line += ` (리뷰 ${p.reviewCount.toLocaleString()}개)`;
        if (p.rating || p.reviewCount) line += "\n";
        if (p.isRocket) line += `   - 🚀 로켓배송\n`;
        line += `   - 상품ID: ${p.id}\n`;
        line += `   - URL: ${p.url}`;
        return line;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `## 쿠팡 검색 결과: "${keyword}" (${products.length}개)\n\n${result.join("\n\n")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `검색 중 오류: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 2: 가격 조회 ──────────────────────────────────
server.tool(
  "coupang_get_price",
  "쿠팡 상품의 상세 가격 정보를 조회합니다. 상품 ID로 할인가, 원가, 할인율, 판매자 등을 확인합니다.",
  {
    productId: z.string().describe("쿠팡 상품 ID (검색 결과에서 확인 가능)"),
  },
  async ({ productId }) => {
    try {
      const detail = await getProductDetail(productId);

      if (!detail) {
        return {
          content: [
            { type: "text" as const, text: `상품 ID ${productId}를 찾을 수 없습니다.` },
          ],
          isError: true,
        };
      }

      let text = `## ${detail.name}\n\n`;
      text += `| 항목 | 내용 |\n|------|------|\n`;
      text += `| 판매가 | **${detail.price.toLocaleString()}원** |\n`;
      if (detail.originalPrice) text += `| 원가 | ${detail.originalPrice.toLocaleString()}원 |\n`;
      if (detail.discount) text += `| 할인율 | ${detail.discount} |\n`;
      if (detail.rating) text += `| 평점 | ${detail.rating.toFixed(1)}점 |\n`;
      if (detail.reviewCount) text += `| 리뷰 수 | ${detail.reviewCount.toLocaleString()}개 |\n`;
      text += `| 재고 | ${detail.inStock ? "✅ 재고 있음" : "❌ 품절"} |\n`;
      text += `| 로켓배송 | ${detail.isRocket ? "🚀 가능" : "일반배송"} |\n`;
      if (detail.deliveryInfo) text += `| 배송 | ${detail.deliveryInfo} |\n`;
      if (detail.seller) text += `| 판매자 | ${detail.seller} |\n`;
      text += `\n🔗 [쿠팡에서 보기](${detail.url})`;

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `가격 조회 오류: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 3: 재고 확인 ──────────────────────────────────
server.tool(
  "coupang_check_inventory",
  "쿠팡 상품의 재고 상태를 확인합니다. 재고 유무, 현재 가격, 배송 정보, 판매자를 조회합니다.",
  {
    productId: z.string().describe("쿠팡 상품 ID"),
  },
  async ({ productId }) => {
    try {
      const inv = await checkInventory(productId);

      let text = `## 재고 확인 (상품 ID: ${productId})\n\n`;
      text += `- 재고 상태: ${inv.inStock ? "✅ **재고 있음**" : "❌ **품절**"}\n`;
      if (inv.price) text += `- 현재 가격: ${inv.price.toLocaleString()}원\n`;
      if (inv.deliveryInfo) text += `- 배송 정보: ${inv.deliveryInfo}\n`;
      if (inv.seller) text += `- 판매자: ${inv.seller}\n`;

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `재고 확인 오류: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 4: 리뷰 조회 ──────────────────────────────────
server.tool(
  "coupang_get_reviews",
  "쿠팡 상품의 리뷰를 조회합니다. 리뷰 내용, 평점, 작성일, 도움 수 등을 확인할 수 있습니다.",
  {
    productId: z.string().describe("쿠팡 상품 ID"),
    page: z.number().optional().default(1).describe("페이지 번호 (기본값: 1)"),
  },
  async ({ productId, page }) => {
    try {
      const reviews = await getProductReviews(productId, page);

      if (reviews.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `상품 ID ${productId}의 리뷰가 없거나 조회할 수 없습니다.` },
          ],
        };
      }

      const result = reviews.map((r, i) => {
        let line = `### ${i + 1}. ${r.userName} — ${"⭐".repeat(Math.round(r.rating))} (${r.rating.toFixed(1)}점)\n`;
        if (r.date) line += `📅 ${r.date}\n`;
        if (r.title) line += `**${r.title}**\n`;
        line += `${r.content}\n`;
        if (r.helpful) line += `👍 도움이 됨: ${r.helpful}명`;
        return line;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `## 리뷰 (상품 ID: ${productId}, ${page}페이지)\n\n${result.join("\n\n---\n\n")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `리뷰 조회 오류: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── 서버 시작 ───────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await closeBrowser();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await closeBrowser();
    process.exit(0);
  });

  await server.connect(transport);
  console.error("Coupang MCP server started (Playwright)");
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
