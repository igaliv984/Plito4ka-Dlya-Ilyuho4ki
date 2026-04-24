export interface Product {
  id: string;
  slug: string;
  name: string;
  category: string;
  country?: string;
  brand?: string;
  collection: string;
  shortDescription: string;
  description: string;
  priceM2: number;
  oldPriceM2?: number;
  tileLengthMm: number;
  tileWidthMm: number;
  piecesPerBox: number;
  boxAreaM2?: number;
  color: string;
  style: string;
  surface: string;
  sizeLabel: string;
  featured: boolean;
  sortOrder: number;
  mainImage: string;
  galleryImages: string[];
  altText: string;
  seoTitle: string;
  seoDescription: string;
  inStock: boolean;
  callToActionText: string;
  sku?: string;
  unit?: string;
  stockTotal?: number;
  warehouseStock?: Record<string, number>;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  heroTitle: string;
  heroText: string;
  image: string;
  featured: boolean;
  sortOrder: number;
  seoTitle: string;
  seoDescription: string;
}

export interface Creative {
  productId: string;
  type: string;
  url: string;
  alt: string;
  order: number;
  caption: string;
}

export interface PageEntry {
  slug: string;
  title: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
}

export interface FAQEntry {
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export interface SeoEntry {
  pageKey: string;
  title: string;
  description: string;
  h1: string;
  canonicalPath: string;
  ogImage: string;
}

export interface SocialLink {
  label: string;
  url: string;
}

export interface Settings {
  storeName: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  workingHours: string;
  currency: string;
  defaultWastePercent: number;
  mapLink: string;
  mapEmbedUrl?: string;
  socialLinks: SocialLink[];
}

export interface SiteData {
  products: Product[];
  categories: Category[];
  creatives: Creative[];
  pages: PageEntry[];
  faq: FAQEntry[];
  seo: SeoEntry[];
  settings: Settings;
}

export interface SeoProps {
  title: string;
  description: string;
  h1?: string;
  canonicalPath?: string;
  image?: string;
  noindex?: boolean;
}

export interface BreadcrumbItem {
  name: string;
  href: string;
}

export interface SearchItem {
  title: string;
  href: string;
  type: "product" | "category" | "page";
  description: string;
  keywords: string[];
}
