# Public assets and attribution

The public distribution uses neutral placeholders and blank size-table backgrounds. It contains no user model photo, product detail photo, size-chart screenshot, shop watermark, brand logo, or copied measurement illustration.

The following resources are original drawings created by this project from a fresh bitmap with [`generate-public-assets.ps1`](../scripts/generate-public-assets.ps1). Copyright and distribution terms are described in the repository's [`COPYRIGHT.txt`](../COPYRIGHT.txt). No third-party product photography is included.

| Resource | Dimensions | Purpose |
| --- | --- | --- |
| `cover.jpg`, `look.jpg` | 1440 × 1920 each | Replaceable cover and model placeholders; real JPEG encoding |
| `turntide-template/hero.png` | 1500 × 1996 | Replaceable first-product-image placeholder |
| `turntide-template/detail-01.png` | 416 × 312 | Replaceable detail placeholder |
| `turntide-template/detail-02.png` | 414 × 312 | Replaceable detail placeholder |
| `turntide-template/detail-03.png` | 418 × 319 | Replaceable detail placeholder |
| `turntide-template/detail-04.png` | 414 × 319 | Replaceable detail placeholder |
| `turntide-template/model-01.png` … `model-09.png` | 911 × 1206 each | Replaceable model placeholders |
| `turntide-template/size-template.png`, `size-original.png` | 1037 × 562 each | Freshly drawn blank size tables |
| `turntide-template/footer-service-cn.png` | 1026 × 900 | Generic purchasing/service-text placeholder |
| `pants-reference/size-template.png`, `size-original.png` | 899 × 742 each | Freshly drawn blank size table and original vector pants diagram |
| `pants-reference/recommendation-template.png`, `recommendation-original.png` | 899 × 356 each | Blank optional size recommendation table |
| `pants-reference/measurement-diagram-original.png` | 260 × 464 | Original vector drawing made for this distribution |
| `pants-reference/information-title-original.png` | 255 × 87 | Generic product-information title |

Compatibility filenames containing `original` identify the existing application's asset slot. Their pixels are newly drawn; those filenames do not mean that user attachment pixels are included. The JSON schema retains layout dimensions, table cell positions and masks for application compatibility. Private image paths, attachment hashes, exact-copy assertions, original numeric measurements and historical screenshot-processing notes have been removed. Example cell values and numeric recommendation headers are empty.

The generator uses the .NET drawing library supplied by Windows and the system `Microsoft YaHei` font. No font files, external image files, image-generation service, or downloaded dependencies are bundled by that script. Rasterization may vary slightly with the installed Windows font version.

`lucide.min.js` is the third-party Lucide icon library. Its ISC license and copyright notices are preserved in [`lucide-LICENSE`](lucide-LICENSE). The placeholders and pants diagram above are independently drawn and do not copy Lucide icon paths.

To regenerate on Windows, keep this project under `E:\Codex工作盘` and run:

```powershell
powershell -NoProfile -File .\scripts\generate-public-assets.ps1
```

Windows PowerShell and PowerShell 7 are both supported. The script writes only inside this project's `assets` directory, performs no network request, asserts that the photo layout and table coordinates are unchanged, and produces [`public-assets.json`](public-assets.json) with all 25 image dimensions and byte sizes. It reads only the three public geometry/manifest JSON files. It does not read any source product image or application user-data directory.

Supply your own product pictures and verified measurements before publishing a product detail page. The generic footer is editable placeholder wording, not a shop service commitment.
