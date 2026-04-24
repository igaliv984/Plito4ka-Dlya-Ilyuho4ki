import type { APIRoute } from "astro";
import { getSiteData } from "@/lib/google-sheets";

export const GET: APIRoute = async ({ site }) => {
  const data = await getSiteData();
  const baseUrl = site?.toString().replace(/\/$/, "") ?? "https://example-tile-store.netlify.app";

  const routes = [
    "/",
    "/catalog/",
    "/calculator/",
    "/search/",
    "/faq/",
    "/about/",
    "/contacts/",
    "/delivery-payment/",
    "/privacy-policy/",
    ...data.categories.map((category) => `/catalog/${category.slug}/`),
    ...data.products.map((product) => `/product/${product.slug}/`)
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (route) => `  <url>
    <loc>${new URL(route, baseUrl).toString()}</loc>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
};
