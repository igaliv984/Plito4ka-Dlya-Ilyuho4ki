import categoriesJson from "@/data/sample/categories.json";
import creativesJson from "@/data/sample/creatives.json";
import faqJson from "@/data/sample/faq.json";
import pagesJson from "@/data/sample/pages.json";
import productsJson from "@/data/sample/products.json";
import seoJson from "@/data/sample/seo.json";
import settingsJson from "@/data/sample/settings.json";
import { parseBoolean, parseCsv, parseCsvRows, parseNumber, slugify, sortByOrder, splitMultiValue, splitPipePairs } from "@/lib/csv";
import type { Category, Creative, FAQEntry, PageEntry, Product, SeoEntry, Settings, SiteData } from "@/lib/types";
import { readXlsxRows } from "@/lib/xlsx-reader";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type RawRecord = Record<string, string>;
type OptionalSheetKey = "PAGES" | "FAQ" | "SEO" | "SETTINGS";

const OPTIONAL_SHEET_KEYS: OptionalSheetKey[] = ["PAGES", "FAQ", "SEO", "SETTINGS"];
const env = import.meta.env as Record<string, string | undefined>;
const fallbackImage = "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80";

let siteDataCache: Promise<SiteData> | null = null;

function getLocalXlsxPath(): string {
  return resolve(process.cwd(), env.LOCAL_XLSX_PATH ?? "data/catalog.xlsx");
}

function hasLocalCatalogFile(): boolean {
  return existsSync(getLocalXlsxPath());
}

function getSheetEnvKey(sheetName: OptionalSheetKey): string {
  return `GOOGLE_SHEETS_${sheetName}_GID`;
}

function isGoogleSheetsConfigured(): boolean {
  return Boolean(env.GOOGLE_SHEETS_ID && env.GOOGLE_SHEETS_PRODUCTS_GID);
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

function rowsToRecords(rows: string[][]): RawRecord[] {
  if (rows.length === 0) {
    return [];
  }

  const [headers, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0))
    .map((row) =>
      headers.reduce<RawRecord>((record, header, index) => {
        record[String(header ?? "").trim()] = String(row[index] ?? "").trim();
        return record;
      }, {})
    );
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[().,/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRecordValue(record: RawRecord, aliases: string[]): string {
  const normalizedRecord = Object.entries(record).reduce<Record<string, string>>((bucket, [key, value]) => {
    bucket[normalizeHeader(key)] = value;
    return bucket;
  }, {});

  for (const alias of aliases) {
    const value = normalizedRecord[normalizeHeader(alias)];
    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

function parseImages(value: string): string[] {
  return value
    .split(/\r?\n|,|;|\|/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function parseSize(sizeLabel: string): { lengthMm: number; widthMm: number; normalizedLabel: string } {
  const match = sizeLabel.match(/(\d{1,4})\s*[xх×]\s*(\d{1,4})/i);
  if (!match) {
    return {
      lengthMm: 600,
      widthMm: 600,
      normalizedLabel: sizeLabel.trim()
    };
  }

  const first = parseNumber(match[1], 60);
  const second = parseNumber(match[2], 60);
  const unitFactor = Math.max(first, second) <= 200 ? 10 : 1;
  const lengthMm = Math.max(first, second) * unitFactor;
  const widthMm = Math.min(first, second) * unitFactor;

  return {
    lengthMm,
    widthMm,
    normalizedLabel: `${match[1]}x${match[2]}`
  };
}

function parseAvailability(value: string): boolean {
  const normalized = value.toLowerCase().trim();

  if (!normalized) {
    return true;
  }

  if (parseBoolean(normalized)) {
    return true;
  }

  if (["нет", "0", "под заказ", "out of stock", "unavailable"].includes(normalized)) {
    return false;
  }

  const numeric = parseNumber(normalized, Number.NaN);
  return Number.isNaN(numeric) ? true : numeric > 0;
}

function getAssortmentProducts(records: RawRecord[]): Product[] {
  return records
    .map((record, index) => {
      const id = getRecordValue(record, ["Код номенклатуры", "id"]) || getRecordValue(record, ["Артикул", "sku"]);
      const article = getRecordValue(record, ["Артикул", "sku"]);
      const name = getRecordValue(record, ["Наименование", "name"]);

      if (!name) {
        return null;
      }

      const mainImage =
        getRecordValue(record, ["Изображение", "Фото", "main_image"]) ||
        parseImages(getRecordValue(record, ["Изображения", "gallery_images"]))[0] ||
        fallbackImage;
      const galleryImages = parseImages(getRecordValue(record, ["Изображения", "gallery_images"])).filter(
        (image) => image !== mainImage
      );
      const brand = getRecordValue(record, ["Производитель", "Бренд", "brand"]);
      const country = getRecordValue(record, ["Страна", "country"]);
      const texture = getRecordValue(record, ["Текстура", "Коллекция", "collection"]);
      const surface = getRecordValue(record, ["Тип поверхности", "Поверхность", "surface"]);
      const color = getRecordValue(record, ["Цвет", "color"]);
      const size = getRecordValue(record, ["Размер", "Формат", "size_label"]);
      const purpose = getRecordValue(record, ["Назначение", "style"]);
      const retailPrice = parseNumber(getRecordValue(record, ["Розничная цена", "Цена", "price_m2"]));
      const piecesPerBox = parseNumber(getRecordValue(record, ["Штук в упаковке", "pieces_per_box"]), 1);
      const boxAreaM2 = parseNumber(getRecordValue(record, ["м2 в упаковке", "м² в упаковке", "box_area_m2"]), 0);
      const availabilityValue = getRecordValue(record, ["Наличие", "in_stock"]);
      const inStock = parseAvailability(availabilityValue);
      const { lengthMm, widthMm, normalizedLabel } = parseSize(size);
      const categoryName = country || brand || "Каталог";
      const categorySlug = slugify(categoryName || "catalog");
      const slugBase = [name, article, id].filter(Boolean).join(" ");

      return {
        id: id || slugify(slugBase) || `product-${index + 1}`,
        slug: slugify(slugBase) || `product-${index + 1}`,
        name,
        category: categorySlug || "catalog",
        country,
        brand,
        collection: texture || brand || country || "Коллекция",
        shortDescription: [brand, country, surface, normalizedLabel].filter(Boolean).join(" · "),
        description: [
          brand ? `Производитель: ${brand}.` : "",
          country ? `Страна: ${country}.` : "",
          texture ? `Текстура: ${texture}.` : "",
          surface ? `Поверхность: ${surface}.` : "",
          color ? `Цвет: ${color}.` : "",
          purpose ? `Назначение: ${purpose}.` : "",
          size ? `Формат: ${normalizedLabel}.` : ""
        ]
          .filter(Boolean)
          .join(" "),
        priceM2: retailPrice,
        oldPriceM2: 0,
        tileLengthMm: lengthMm,
        tileWidthMm: widthMm,
        piecesPerBox,
        boxAreaM2,
        color,
        style: purpose,
        surface,
        sizeLabel: normalizedLabel || size,
        featured: index < 8,
        sortOrder: index + 1,
        mainImage,
        galleryImages,
        altText: name,
        seoTitle: `${name} | ${brand || "Каталог плитки"}`,
        seoDescription: [name, brand, country, normalizedLabel].filter(Boolean).join(", "),
        inStock,
        callToActionText: inStock ? "Оставить заявку" : "Уточнить наличие",
        sku: article || id,
        unit: "м²"
      } satisfies Product;
    })
    .filter((product): product is Product => Boolean(product));
}

function getLegacyStockProducts(rows: string[][]): Product[] {
  const products: Product[] = [];
  let currentCountry = "";
  let currentBrand = "";
  let currentCollection = "";

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex].map((cell) => String(cell ?? "").trim());

    if (row.every((cell) => !cell)) {
      continue;
    }

    if (row.length === 1 || row.slice(1).every((cell) => !cell)) {
      const value = row[0];
      if (!value || value.includes("Номенклатура") || value === "Складской") {
        continue;
      }

      if (!currentCountry) {
        currentCountry = value;
      } else if (!currentBrand) {
        currentBrand = value;
      } else {
        currentCollection = value;
      }
      continue;
    }

    const name = row[0];
    const id = row[1] || slugify(name);

    if (!name || name.includes("Номенклатура")) {
      continue;
    }

    const sizeMatch = name.match(/(\d{1,4})\s*[xх×]\s*(\d{1,4})/i);
    const sizeLabel = sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}` : "";
    const { lengthMm, widthMm } = parseSize(sizeLabel || "60x60");
    const stockCells = row.slice(5).filter(Boolean);
    const stockTotal = stockCells.reduce((sum, value) => sum + parseNumber(value, 0), 0);
    const categoryName = currentCountry || currentBrand || "Каталог";

    products.push({
      id,
      slug: slugify([currentBrand, currentCollection, name, id].filter(Boolean).join(" ")) || `product-${products.length + 1}`,
      name,
      category: slugify(categoryName) || "catalog",
      country: currentCountry,
      brand: currentBrand,
      collection: currentCollection || currentBrand || currentCountry || "Коллекция",
      shortDescription: [currentBrand, currentCollection, currentCountry].filter(Boolean).join(" · "),
      description:
        stockTotal > 0
          ? `Товар из складского отчета. Суммарный остаток: ${stockTotal} м².`
          : "Товар из складского отчета. Наличие уточняйте у менеджера.",
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
      mainImage: fallbackImage,
      galleryImages: [],
      altText: name,
      seoTitle: `${name} | ${currentBrand || "Каталог плитки"}`,
      seoDescription: [name, currentCollection, currentCountry].filter(Boolean).join(", "),
      inStock: stockTotal > 0,
      callToActionText: stockTotal > 0 ? "Оставить заявку" : "Уточнить наличие",
      sku: row[2] || id,
      unit: "м²",
      stockTotal
    });
  }

  return products;
}

function isAssortmentFormat(rows: string[][]): boolean {
  const headers = (rows[0] ?? []).map((header) => normalizeHeader(header));
  return headers.includes(normalizeHeader("Код номенклатуры")) && headers.includes(normalizeHeader("Наименование"));
}

function buildProductsFromRows(rows: string[][]): Product[] {
  if (isAssortmentFormat(rows)) {
    return getAssortmentProducts(rowsToRecords(rows));
  }

  return getLegacyStockProducts(rows);
}

function buildCategoriesFromProducts(products: Product[]): Category[] {
  const categoryMap = new Map<string, Category>();

  products.forEach((product) => {
    if (categoryMap.has(product.category)) {
      return;
    }

    const name = product.country || product.brand || product.collection || "Каталог";
    categoryMap.set(product.category, {
      id: product.category,
      slug: product.category,
      name,
      description: `Подборка плитки и керамогранита по направлению ${name}.`,
      heroTitle: `${name}: каталог плитки и керамогранита`,
      heroText: `Собрали товары по направлению ${name} с быстрым переходом к карточке и заявке.`,
      image: product.mainImage,
      featured: categoryMap.size < 4,
      sortOrder: categoryMap.size + 1,
      seoTitle: `${name} | Каталог плитки`,
      seoDescription: `Каталог плитки по направлению ${name}: актуальные позиции, фото и быстрый запрос на расчет.`
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
        galleryImages: [...new Set([...row.galleryImages, ...directGallery])]
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
      tileLengthMm: parseNumber(row.tile_length_mm, 600),
      tileWidthMm: parseNumber(row.tile_width_mm, 600),
      piecesPerBox: parseNumber(row.pieces_per_box, 1),
      boxAreaM2: parseNumber(row.box_area_m2),
      color: row.color ?? "",
      style: row.style ?? "",
      surface: row.surface ?? "",
      sizeLabel: row.size_label ?? "",
      featured: parseBoolean(row.featured ?? ""),
      sortOrder: parseNumber(row.sort_order, 0),
      mainImage: row.main_image ?? fallbackImage,
      galleryImages: [...new Set([...csvGallery, ...creativeGallery])],
      altText: row.alt_text ?? row.name ?? "",
      seoTitle: row.seo_title ?? row.name ?? "",
      seoDescription: row.seo_description ?? row.short_description ?? "",
      inStock: parseBoolean(row.in_stock ?? ""),
      callToActionText: row.call_to_action_text ?? "Оставить заявку",
      sku: row.sku ?? row.article ?? "",
      unit: row.unit ?? "м²",
      stockTotal: parseNumber(row.stock_total ?? "", 0)
    } satisfies Product;
  });

  return sortByOrder(products);
}

function normalizeCategories(rows: Array<RawRecord | Category>): Category[] {
  return sortByOrder(
    rows.map((row) => {
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
        image: row.image ?? fallbackImage,
        featured: parseBoolean(row.featured ?? ""),
        sortOrder: parseNumber(row.sort_order, 0),
        seoTitle: row.seo_title ?? row.name ?? "",
        seoDescription: row.seo_description ?? row.description ?? ""
      };
    })
  );
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
    mapEmbedUrl: row.map_embed_url ?? `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(address)}&z=16`,
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

async function loadOptionalRemoteRows(): Promise<Partial<Record<OptionalSheetKey, RawRecord[]>>> {
  const results = await Promise.all(
    OPTIONAL_SHEET_KEYS.map(async (key) => {
      const gid = env[getSheetEnvKey(key)];
      if (!gid) {
        return [key, []] as const;
      }

      return [key, await fetchSheetRows(gid)] as const;
    })
  );

  return Object.fromEntries(results) as Partial<Record<OptionalSheetKey, RawRecord[]>>;
}

async function loadProductsFromSource(): Promise<Product[]> {
  if (hasLocalCatalogFile()) {
    return buildProductsFromRows(await readXlsxRows(getLocalXlsxPath()));
  }

  if (isGoogleSheetsConfigured() && env.GOOGLE_SHEETS_PRODUCTS_GID) {
    const csv = await fetchSheetCsv(env.GOOGLE_SHEETS_PRODUCTS_GID);
    return buildProductsFromRows(parseCsvRows(csv));
  }

  const sampleCreatives = normalizeCreatives(creativesJson as Creative[]);
  return normalizeProducts(productsJson as Product[], sampleCreatives);
}

async function loadRemoteOrLocalCatalog(): Promise<SiteData> {
  const base = loadLocalData();
  const products = await loadProductsFromSource();
  const categories = products.length > 0 ? buildCategoriesFromProducts(products) : base.categories;

  let optionalRows: Partial<Record<OptionalSheetKey, RawRecord[]>> = {};
  if (isGoogleSheetsConfigured()) {
    optionalRows = await loadOptionalRemoteRows();
  }

  return {
    creatives: [],
    products,
    categories,
    pages: optionalRows.PAGES?.length ? normalizePages(optionalRows.PAGES) : base.pages,
    faq: optionalRows.FAQ?.length ? normalizeFaq(optionalRows.FAQ) : base.faq,
    seo: optionalRows.SEO?.length ? normalizeSeo(optionalRows.SEO) : base.seo,
    settings: optionalRows.SETTINGS?.length ? normalizeSettings(optionalRows.SETTINGS) : base.settings
  };
}

export async function getSiteData(): Promise<SiteData> {
  if (!siteDataCache) {
    siteDataCache = loadRemoteOrLocalCatalog().catch(() => loadLocalData());
  }

  return siteDataCache;
}
