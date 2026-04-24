# Google Sheets Schema

Ниже схема Google Таблицы, которую можно использовать как простую mini-CMS без отдельной админки.

## Лист `products`

Обязательные поля:

- `id`
- `slug`
- `name`
- `category`
- `collection`
- `short_description`
- `description`
- `price_m2`
- `old_price_m2`
- `tile_length_mm`
- `tile_width_mm`
- `pieces_per_box`
- `box_area_m2`
- `color`
- `style`
- `surface`
- `size_label`
- `featured`
- `sort_order`
- `main_image`
- `gallery_images`
- `alt_text`
- `seo_title`
- `seo_description`
- `in_stock`
- `call_to_action_text`

Рекомендации:

- `slug` только латиницей и через дефис.
- `gallery_images` храните в одной ячейке, по одной ссылке на строку.
- `featured` и `in_stock` используйте как `TRUE/FALSE`.

## Лист `categories`

Рекомендуемые поля:

- `id`
- `slug`
- `name`
- `description`
- `hero_title`
- `hero_text`
- `image`
- `featured`
- `sort_order`
- `seo_title`
- `seo_description`

## Лист `creatives`

Обязательные поля:

- `product_id`
- `type`
- `url`
- `alt`
- `order`
- `caption`

Используйте этот лист для дополнительных изображений, баннеров и галереи.

## Лист `pages`

Обязательные поля:

- `slug`
- `title`
- `content`
- `seo_title`
- `seo_description`

Для `content` используйте простой текст с такими правилами:

- строка с `##` создаёт заголовок второго уровня;
- строка с `###` создаёт заголовок третьего уровня;
- строка с `-` создаёт пункт списка;
- пустая строка разделяет абзацы.

## Лист `faq`

Рекомендуемые поля:

- `category`
- `question`
- `answer`
- `sort_order`

## Лист `seo`

Рекомендуемые поля:

- `page_key`
- `title`
- `description`
- `h1`
- `canonical_path`
- `og_image`

Примеры `page_key`:

- `home`
- `catalog`
- `faq`
- `calculator`
- `404`

## Лист `settings`

Обязательные поля:

- `store_name`
- `phone`
- `whatsapp`
- `email`
- `address`
- `working_hours`
- `currency`
- `default_waste_percent`
- `map_link`
- `map_embed_url`
- `social_links`

Для `social_links` используйте по одной ссылке на строку в формате:

```text
Telegram|https://t.me/brand
WhatsApp|https://wa.me/79990000000
VK|https://vk.com/brand
```

## Как публиковать изображения проще всего

Практичный вариант без тяжёлой админки:

1. Создать папку в Cloudinary или Supabase Storage.
2. Загружать туда фото.
3. Копировать прямую ссылку.
4. Вставлять ссылку в таблицу.

Это проще и стабильнее, чем пытаться строить собственную медиа-библиотеку на бесплатном хостинге.

## Поддержка выгрузки остатков

Сайт умеет читать выгрузку остатков в стиле 1С, где:

- верхние строки содержат служебную шапку;
- дальше идут уровни `страна -> бренд -> коллекция -> товар`;
- остатки разнесены по складам.

Чтобы использовать такую таблицу:

1. Загрузите её в Google Sheets без изменения структуры.
2. Укажите `GOOGLE_SHEETS_PRODUCTS_GID`.
3. Укажите `GOOGLE_SHEETS_PRODUCTS_FORMAT=stock_report`.

Если не хочется публиковать таблицу в Google Sheets, можно просто положить XLSX в `data/catalog.xlsx` и сайт прочитает его при сборке.

Из такой выгрузки сайт автоматически берёт:

- название товара;
- страну;
- бренд;
- коллекцию;
- код и артикул;
- остатки по складам;
- размер из названия, если он записан как `20x120`.

Отдельно желательно дополнять:

- фото;
- цены;
- SEO;
- длинные описания;
- маркетинговые блоки.
