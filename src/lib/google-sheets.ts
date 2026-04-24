import categoriesJson from "@/data/sample/categories.json";
import creativesJson from "@/data/sample/creatives.json";
import faqJson from "@/data/sample/faq.json";
import pagesJson from "@/data/sample/pages.json";
import productsJson from "@/data/sample/products.json";
import seoJson from "@/data/sample/seo.json";
import settingsJson from "@/data/sample/settings.json";
import {
  parseBoolean,
  parseCsv,
  parseCsvRows,
  parseNumber,
  slugify,
  sortByOrder,
  splitMultiValue,
  splitPipePairs
} from "@/lib/csv";
import type { Category, Creative, FAQEntry, PageEntry, Product, SeoEntry, Settings, SiteData } from "@/lib/types";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readXlsxRows } from "@/lib/xlsx-reader";

type RawRecord = Record<string, string>;

const SHEET_KEYS = ["PRODUCTS", "CATEGORIES", "CREATIVES", "PAGES", "FAQ", "SEO", "SETTINGS"] as const;
const env = import.meta.env as Record<string, string | undefined>;
let siteDataCache: Promise<SiteData> | null = null;

function getSheetEnvKey(sheetName: (typeof SHEET_KEYS)[number]): string {
  return `GOOGLE_SHEETS_${sheetName}_GID`;
}

function getExplicitProductsFormat(): string | null {
  const format = env.GOOGLE_SHEETS_PRODUCTS_FORMAT?.toLowerCase().trim();
  return format || null;
}

function hasLocalStockReportFile(): boolean {
  return existsSync(getLocalXlsxPath());
}

function getProductsFormat(): string {
  const explicitFormat = getExplicitProductsFormat();
  if (explicitFormat === "stock_report") {
    return explicitFormat;
  }

  if (hasLocalStockReportFile()) {
    return "stock_report";
  }

  if (explicitFormat) {
    return explicitFormat;
  }

  return "catalog";
}

function getLocalXlsxPath(): string {
  return resolve(process.cwd(), env.LOCAL_XLSX_PATH ?? "data/catalog.xlsx");
}

function isRemoteConfigured() {
  if (getProductsFormat() === "stock_report" && hasLocalStockReportFile()) {
    return true;
  }

  if (getProductsFormat() === "stock_report") {
    return Boolean(env.GOOGLE_SHEETS_PRODUCTS_GID);
  }

  return Boolean(env.GOOGLE_SHEETS_ID && SHEET_KEYS.every((key) => Boolean(env[getSheetEnvKey(key)])));
}

async function fetchSheetCsv(gid: string): Promise<string> {
  const sheetId = env.GOOGLE_SHEETS_ID;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to load Google Sheet ${gid}: ${response.status}`);
  }

  return response.text();
}

async function fetchSheetRows(gid: string): Promise<RawRecord[]> {
  return parseCsv(await fetchSheetCsv(gid));
}

function extractSizeLabel(name: string): string {
  const match = name.match(/(\d{1,3})\s*[xх]\s*(\d{1,4})/i);
  return match ? `${match[1]}x${match[2]} см` : "";
}

function extractTileDimensions(name: string): { lengthMm: number; widthMm: number } {
  const match = name.match(/(\d{1,3})\s*[xх]\s*(\d{1,4})/i);
  if (!match) {
    return { lengthMm: 600, widthMm: 600 };
  }

  const first = parseNumber(match[1]) * 10;
  const second = parseNumber(match[2]) * 10;
  return {
    lengthMm: Math.max(first, second),
    widthMm: Math.min(first, second)
  };
}

function buildWarehouseHeaders(rows: string[][]): Array<{ index: number; name: string }> {
  const row1 = rows[0] ?? [];
  const row3 = rows[2] ?? [];
  const headers: Array<{ index: number; name: string }> = [];

  for (let index = 0; index < row1.length; index += 1) {
    const warehouse = row1[index]?.trim();
    const metric = row3[index]?.trim();

    if (warehouse && warehouse.toLowerCase().includes("склад") && (!metric || metric.toLowerCase() === "наличие")) {
      headers.push({ index, name: warehouse });
    }
  }

  return headers;
}

function isOnlyFirstCellFilled(row: string[]): boolean {
  return Boolean(row[0]?.trim()) && row.slice(1).every((cell) => !cell?.trim());
}

function buildStockReportProducts(rows: string[][]): Product[] {
  const warehouseHeaders = buildWarehouseHeaders(rows);
  const products: Product[] = [];
  let currentCountry = "";
  let currentBrand = "";
  let currentCollection = "";

  for (let rowIndex = 5; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex].map((cell) => cell?.trim?.() ?? "");

    if (row.every((cell) => !cell)) {
      continue;
    }

    if (isOnlyFirstCellFilled(row)) {
      const value = row[0];
      if (!value || value === "Складской") {
        continue;
      }

      if (/^[А-ЯA-Z\s]+$/.test(value) && !value.includes("(") && value.length < 40) {
        currentCountry = value;
      } else if (value.includes("(")) {
        currentBrand = value;
      } else {
        currentCollection = value;
      }
      continue;
    }

    const name = row[0];
    const id = row[1] || slugify(name);
    const article = row[2] || "";
    const unit = row[3] || "м2";
    const warehouseStock = warehouseHeaders.reduce<Record<string, number>>((bucket, item) => {
      bucket[item.name] = parseNumber(row[item.index], 0);
      return bucket;
    }, {});
    const stockTotal = Object.values(warehouseStock).reduce((sum, value) => sum + value, 0);
    const photoCandidate = row[row.length - 2] ?? "";
    const availabilityCandidate = row[row.length - 1] ?? "";
    const looksLikeUrl = /^https?:\/\//i.test(photoCandidate) || /\.(png|jpe?g|webp|avif|gif|svg)(\?|#|$)/i.test(photoCandidate);
    const availabilityText = availabilityCandidate.trim().toLowerCase();
    const availabilityAsStock =
      availabilityText && !Number.isNaN(Number(availabilityCandidate))
        ? Number(availabilityCandidate) > 0
        : undefined;
    const availabilityAsBool =
      availabilityText === "наличие" ||
      ["да", "есть", "true", "yes", "1", "в наличии", "available"].includes(availabilityText)
        ? true
        : ["нет", "0", "false", "no", "out", "out of stock", "закончился", "под заказ"].includes(availabilityText)
          ? false
          : availabilityAsStock;
    const { lengthMm, widthMm } = extractTileDimensions(name);
    const sizeLabel = extractSizeLabel(name);
    const countrySlug = slugify(currentCountry || "Каталог");
    const productSlug = slugify(`${currentBrand} ${currentCollection} ${name} ${id}`);

    products.push({
      id,
      slug: productSlug,
      name,
      category: countrySlug,
      country: currentCountry,
      brand: currentBrand,
      collection: currentCollection || currentBrand || currentCountry,
      shortDescription: `${currentBrand || "Плитка"} ${currentCollection ? `из коллекции ${currentCollection}` : ""}`.trim(),
      description: [
        currentCountry ? `Страна: ${currentCountry}.` : "",
        currentBrand ? `Бренд: ${currentBrand}.` : "",
        currentCollection ? `Коллекция: ${currentCollection}.` : "",
        stockTotal > 0 ? `Суммарный остаток по складам: ${stockTotal} ${unit}.` : "Наличие уточняйте у менеджера."
      ]
        .filter(Boolean)
        .join(" "),
      priceM2: 0,
      oldPriceM2: 0,
      tileLengthMm: lengthMm,
      tileWidthMm: widthMm,
      piecesPerBox: 1,
      boxAreaM2: 0,
      color: "",
      style: "",
      surface: "",
      sizeLabel,
      featured: products.length < 8,
      sortOrder: products.length + 1,
      mainImage: looksLikeUrl ? photoCandidate : "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
      galleryImages: [],
      altText: name,
      seoTitle: `${name} | ${currentBrand || "Каталог плитки"}`,
      seoDescription: `${name}${currentCollection ? `, коллекция ${currentCollection}` : ""}${currentCountry ? `, ${currentCountry}` : ""}.`,
      inStock: availabilityAsBool ?? stockTotal > 0,
      callToActionText: (availabilityAsBool ?? stockTotal > 0) ? "Оставить заявку" : "Уточнить наличие",
      sku: article || id,
      unit,
      stockTotal,
      warehouseStock
    });
  }

  return products;
}

function buildCategoriesFromProducts(products: Product[]): Category[] {
  const categoryMap = new Map<string, Category>();

  products.forEach((product) => {
    if (categoryMap.has(product.category)) {
      return;
    }

    const name = product.country || product.category;
    categoryMap.set(product.category, {
      id: product.category,
      slug: product.category,
      name,
      description: `Плитка и керамогранит по направлению ${name}.`,
      heroTitle: `${name}: каталог плитки и керамогранита`,
      heroText: `Серии, коллекции и остатки по складам для направления ${name}.`,
      image: product.mainImage,
      featured: categoryMap.size < 4,
      sortOrder: categoryMap.size + 1,
      seoTitle: `${name} | Каталог плитки`,
      seoDescription: `Каталог плитки по направлению ${name}: коллекции, остатки и быстрый переход к заявке.`
    });
  });

  return [...categoryMap.values()];
}

function normalizeCreatives(rows: Array<RawRecord | Creative>): Creative[] {
  return rows.map((row) => {
    if ("productId" in row) {
      return row;
    }

    return {
      productId: row.product_id ?? "",
      type: row.type ?? "gallery",
      url: row.url ?? "",
      alt: row.alt ?? "",
      order: parseNumber(row.order, 0),
      caption: row.caption ?? ""
    };
  });
}

function normalizeProducts(rows: Array<RawRecord | Product>, creatives: Creative[]): Product[] {
  const creativesByProduct = creatives.reduce<Record<string, Creative[]>>((bucket, item) => {
    if (!bucket[item.productId]) {
      bucket[item.productId] = [];
    }
    bucket[item.productId].push(item);
    return bucket;
  }, {});

  const products = rows.map((row) => {
    if ("priceM2" in row) {
      const directGallery = sortByOrder(creativesByProduct[row.id] ?? []).map((item) => item.url);
      return {
        ...row,
        galleryImages: [...row.galleryImages, ...directGallery.filter((url) => !row.galleryImages.includes(url))]
      };
    }

    const creativeGallery = sortByOrder(creativesByProduct[row.id] ?? []).map((item) => item.url);
    const csvGallery = splitMultiValue(row.gallery_images ?? "");

    return {
      id: row.id ?? "",
      slug: row.slug ?? "",
      name: row.name ?? "",
      category: row.category ?? "",
      country: row.country ?? "",
      brand: row.brand ?? "",
      collection: row.collection ?? "",
      shortDescription: row.short_description ?? "",
      description: row.description ?? "",
      priceM2: parseNumber(row.price_m2),
      oldPriceM2: parseNumber(row.old_price_m2),
      tileLengthMm: parseNumber(row.tile_length_mm),
      tileWidthMm: parseNumber(row.tile_width_mm),
      piecesPerBox: parseNumber(row.pieces_per_box, 1),
      boxAreaM2: parseNumber(row.box_area_m2),
      color: row.color ?? "",
      style: row.style ?? "",
      surface: row.surface ?? "",
      sizeLabel: row.size_label ?? "",
      featured: parseBoolean(row.featured ?? ""),
      sortOrder: parseNumber(row.sort_order, 0),
      mainImage: row.main_image ?? "",
      galleryImages: [...csvGallery, ...creativeGallery.filter((url) => !csvGallery.includes(url))],
      altText: row.alt_text ?? row.name ?? "",
      seoTitle: row.seo_title ?? row.name ?? "",
      seoDescription: row.seo_description ?? row.short_description ?? "",
      inStock: parseBoolean(row.in_stock ?? ""),
      callToActionText: row.call_to_action_text ?? "Оставить заявку",
      sku: row.sku ?? row.article ?? "",
      unit: row.unit ?? "",
      stockTotal: parseNumber(row.stock_total ?? "", 0)
    };
  });

  return sortByOrder(products);
}

function normalizeCategories(rows: Array<RawRecord | Category>): Category[] {
  const categories = rows.map((row) => {
    if ("heroTitle" in row) {
      return row;
    }

    return {
      id: row.id ?? "",
      slug: row.slug ?? "",
      name: row.name ?? "",
      description: row.description ?? "",
      heroTitle: row.hero_title ?? row.name ?? "",
      heroText: row.hero_text ?? row.description ?? "",
      image: row.image ?? "",
      featured: parseBoolean(row.featured ?? ""),
      sortOrder: parseNumber(row.sort_order, 0),
      seoTitle: row.seo_title ?? row.name ?? "",
      seoDescription: row.seo_description ?? row.description ?? ""
    };
  });

  return sortByOrder(categories);
}

function normalizePages(rows: Array<RawRecord | PageEntry>): PageEntry[] {
  return rows.map((row) => {
    if ("seoTitle" in row) {
      return row;
    }

    return {
      slug: row.slug ?? "",
      title: row.title ?? "",
      content: row.content ?? "",
      seoTitle: row.seo_title ?? row.title ?? "",
      seoDescription: row.seo_description ?? ""
    };
  });
}

function normalizeFaq(rows: Array<RawRecord | FAQEntry>): FAQEntry[] {
  return sortByOrder(
    rows.map((row) => {
      if ("sortOrder" in row) {
        return row;
      }

      return {
        category: row.category ?? "",
        question: row.question ?? "",
        answer: row.answer ?? "",
        sortOrder: parseNumber(row.sort_order, 0)
      };
    })
  );
}

function normalizeSeo(rows: Array<RawRecord | SeoEntry>): SeoEntry[] {
  return rows.map((row) => {
    if ("pageKey" in row) {
      return row;
    }

    return {
      pageKey: row.page_key ?? "",
      title: row.title ?? "",
      description: row.description ?? "",
      h1: row.h1 ?? "",
      canonicalPath: row.canonical_path ?? "",
      ogImage: row.og_image ?? ""
    };
  });
}

function normalizeSettings(input: RawRecord[] | Settings): Settings {
  if ("storeName" in input) {
    return {
      ...input,
      mapEmbedUrl: input.mapEmbedUrl || `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(input.address)}&z=16`
    };
  }

  const row = input[0] ?? {};
  const address = row.address ?? "";

  return {
    storeName: row.store_name ?? "Kerama Luxe",
    phone: row.phone ?? "",
    whatsapp: row.whatsapp ?? "",
    email: row.email ?? "",
    address,
    workingHours: row.working_hours ?? "",
    currency: row.currency ?? "₽",
    defaultWastePercent: parseNumber(row.default_waste_percent, 10),
    mapLink: row.map_link ?? "",
    mapEmbedUrl:
      row.map_embed_url ?? `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(address)}&z=16`,
    socialLinks: splitPipePairs(row.social_links ?? "")
  };
}

function loadLocalData(): SiteData {
  const creatives = normalizeCreatives(creativesJson as Creative[]);

  return {
    creatives,
    products: normalizeProducts(productsJson as Product[], creatives),
    categories: normalizeCategories(categoriesJson as Category[]),
    pages: normalizePages(pagesJson as PageEntry[]),
    faq: normalizeFaq(faqJson as FAQEntry[]),
    seo: normalizeSeo(seoJson as SeoEntry[]),
    settings: normalizeSettings(settingsJson as Settings)
  };
}

async function loadRemoteCatalogData(): Promise<SiteData> {
  const sheetResults = await Promise.all(
    SHEET_KEYS.map(async (key) => {
      const gid = env[getSheetEnvKey(key)];
      if (!gid) {
        return [key, null] as const;
      }
      return [key, await fetchSheetRows(gid)] as const;
    })
  );

  const dataMap = Object.fromEntries(sheetResults) as Partial<Record<(typeof SHEET_KEYS)[number], RawRecord[] | null>>;
  const creatives = normalizeCreatives((dataMap.CREATIVES ?? []) as RawRecord[]);
  const products = normalizeProducts((dataMap.PRODUCTS ?? []) as RawRecord[], creatives);
  const categoriesRows = (dataMap.CATEGORIES ?? []) as RawRecord[];
  const categories = categoriesRows.length > 0 ? normalizeCategories(categoriesRows) : buildCategoriesFromProducts(products);

  return {
    creatives,
    products,
    categories,
    pages: normalizePages((dataMap.PAGES ?? []) as RawRecord[]),
    faq: normalizeFaq((dataMap.FAQ ?? []) as RawRecord[]),
    seo: normalizeSeo((dataMap.SEO ?? []) as RawRecord[]),
    settings: normalizeSettings(((dataMap.SETTINGS ?? []) as RawRecord[]) || [])
  };
}

async function loadRemoteStockReportData(): Promise<SiteData> {
  let products: Product[] = [];
  const localXlsxPath = getLocalXlsxPath();

  if (existsSync(localXlsxPath)) {
    const rows = await readXlsxRows(localXlsxPath);
    products = buildStockReportProducts(rows);
  } else if (env.GOOGLE_SHEETS_PRODUCTS_GID) {
    const productsCsv = await fetchSheetCsv(env.GOOGLE_SHEETS_PRODUCTS_GID);
    products = buildStockReportProducts(parseCsvRows(productsCsv));
  } else {
    products = normalizeProducts(productsJson as Product[], normalizeCreatives(creativesJson as Creative[]));
  }

  const categories = buildCategoriesFromProducts(products);

  const optionalRows = await Promise.all(
    ["PAGES", "FAQ", "SEO", "SETTINGS"].map(async (key) => {
      const gid = env[getSheetEnvKey(key as (typeof SHEET_KEYS)[number])];
      if (!gid) {
        return [key, []] as const;
      }
      return [key, await fetchSheetRows(gid)] as const;
    })
  );

  const dataMap = Object.fromEntries(optionalRows) as Record<string, RawRecord[]>;

  return {
    creatives: [],
    products,
    categories,
    pages: dataMap.PAGES?.length ? normalizePages(dataMap.PAGES) : loadLocalData().pages,
    faq: dataMap.FAQ?.length ? normalizeFaq(dataMap.FAQ) : loadLocalData().faq,
    seo: dataMap.SEO?.length ? normalizeSeo(dataMap.SEO) : loadLocalData().seo,
    settings: dataMap.SETTINGS?.length ? normalizeSettings(dataMap.SETTINGS) : loadLocalData().settings
  };
}

async function loadRemoteData(): Promise<SiteData> {
  const format = getProductsFormat();
  if (format === "stock_report") {
    return loadRemoteStockReportData();
  }

  return loadRemoteCatalogData();
}

export async function getSiteData(): Promise<SiteData> {
  if (!siteDataCache) {
    siteDataCache = isRemoteConfigured() ? loadRemoteData().catch(() => loadLocalData()) : Promise.resolve(loadLocalData());
  }

  return siteDataCache;
}
