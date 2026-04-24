# Catalog XLSX

If you want the simplest workflow, put your spreadsheet here as:

`data/catalog.xlsx`

Then set:

```env
GOOGLE_SHEETS_PRODUCTS_FORMAT=stock_report
```

What the file should contain:

- your existing product list;
- one column named `Наличие`;
- one last column with a photo URL, or a column named `Фото`.

The site will read the spreadsheet at build time and generate the catalog automatically.

If you prefer Google Sheets instead, you can still use the existing mini-CMS mode.
