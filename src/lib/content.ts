import { getSiteData } from "@/lib/google-sheets";
import type { BreadcrumbItem, Category, PageEntry, Product, SearchItem, SeoEntry } from "@/lib/types";

export async function getFeaturedProducts(limit = 4): Promise<Product[]> {
  const data = await getSiteData();
  return data.products.filter((product) => product.featured).slice(0, limit);
}

export async function getFeaturedCategories(limit = 3): Promise<Category[]> {
  const data = await getSiteData();
  return data.categories.filter((category) => category.featured).slice(0, limit);
}

export async function getCategoryProducts(categorySlug: string): Promise<Product[]> {
  const data = await getSiteData();
  return data.products.filter((product) => product.category === categorySlug);
}

export async function getCategoryBySlug(categorySlug: string): Promise<Category | undefined> {
  const data = await getSiteData();
  return data.categories.find((category) => category.slug === categorySlug);
}

export async function getProductBySlug(slug: string): Promise<Product | undefined> {
  const data = await getSiteData();
  return data.products.find((product) => product.slug === slug);
}

export async function getPageBySlug(slug: string): Promise<PageEntry | undefined> {
  const data = await getSiteData();
  return data.pages.find((page) => page.slug === slug);
}

export async function getSeoEntry(pageKey: string): Promise<SeoEntry | undefined> {
  const data = await getSiteData();
  return data.seo.find((entry) => entry.pageKey === pageKey);
}

export async function getRelatedProducts(product: Product, limit = 3): Promise<Product[]> {
  const data = await getSiteData();

  return data.products
    .filter((item) => item.slug !== product.slug && item.category === product.category)
    .slice(0, limit);
}

export function buildBreadcrumbs(items: BreadcrumbItem[]): BreadcrumbItem[] {
  return [{ name: "Главная", href: "/" }, ...items];
}

export async function getSearchItems(): Promise<SearchItem[]> {
  const data = await getSiteData();

  const productItems: SearchItem[] = data.products.map((product) => ({
    title: product.name,
    href: `/product/${product.slug}/`,
    type: "product",
    description:
      product.shortDescription ||
      [product.brand, product.collection, product.country].filter(Boolean).join(" · ") ||
      "Товар каталога",
    keywords: [
      product.name,
      product.collection,
      product.brand ?? "",
      product.country ?? "",
      product.category,
      product.sku ?? ""
    ].filter(Boolean)
  }));

  const categoryItems: SearchItem[] = data.categories.map((category) => ({
    title: category.name,
    href: `/catalog/${category.slug}/`,
    type: "category",
    description: category.description,
    keywords: [category.name, category.description, category.heroTitle].filter(Boolean)
  }));

  const pageItems: SearchItem[] = data.pages.map((page) => ({
    title: page.title,
    href: `/${page.slug}/`,
    type: "page",
    description: page.seoDescription || page.title,
    keywords: [page.title, page.content].filter(Boolean)
  }));

  return [...productItems, ...categoryItems, ...pageItems];
}
