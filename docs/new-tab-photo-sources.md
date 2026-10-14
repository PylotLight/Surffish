# New Tab nature-photo sources and cache

Surffish's local **New Tab** uses a small set of nature photos behind its site-icon grid. It keeps two bundled CC0 images as an offline fallback and refreshes a local cache from Wikimedia Commons while the local New Tab is in use. A standard refresh uses the fixed nature-specific searches `filetype:bitmap mountain lake photo` and `filetype:bitmap forest lake landscape photo`, normally no more than once per 24 hours; the footer also offers manual refresh with a short cooldown. The photos rotate locally every 15 minutes. A live review rejected a broad “scenic landscape” query after it returned an urban city-sunset image.

## Network and privacy boundary

- Search terms are built into Surffish (`mountain lake photo` and `forest lake landscape photo`); they do not include the current page, history, favorites, typed address, or other user data. Top Commons results reviewed for these focused queries include mountain-lake and forest-lake landscapes; only the license/type/dimension-validated candidates are considered for the cache.
- Requests go from the main process through the existing persistent browser session, so its already-saved SOCKS proxy choice is honored. They omit cookies and referrers and use a descriptive Surffish user-agent.
- Requests occur when the local New Tab is displayed, not when the Bonjourr or search-engine page is selected. The app downloads thumbnails only from Wikimedia's HTTPS thumbnail hosts, validates the file type and size, then displays local data URLs.
- At most two remote thumbnails (no more than 2 MiB each) and their small attribution records are stored in `new-tab-photo-cache.json` in Surffish's app-data directory. This is a separate, atomically replaced cache file; it does not edit proxy preferences, browser history, pins, cookies, or the encrypted session-cookie store. Clearing browser history does not clear the photo cache.
- A failed or unavailable source leaves the existing photo cache intact. On first use or if the cache is empty, Surffish uses its two bundled CC0 fallbacks.

## License and attribution checks

A search result is eligible only when its file metadata includes a creator, a landscape raster image at least 1280 × 720, a trusted Wikimedia Commons file page and thumbnail URL, and a matching declared license record for either **CC0 1.0** or attribution-only **CC BY 2.0, 2.5, 3.0, or 4.0**. ShareAlike, NonCommercial, NoDerivatives, ambiguous, and unsupported records are skipped. The displayed credit links the title to its Commons file page and the license name to the license text; the creator and title remain visible. Surffish cannot independently guarantee that a Commons uploader's source claim is accurate, so the file page is available for inspection.

The two offline fallbacks are bundled WebP copies of CC0 1.0 files:

The files live in `src/renderer/src/assets/quick-links-backgrounds/`. CC0 needs no attribution; the credits are shown anyway.

| Bundled fallback | Creator | Original source | Commons source and license |
| --- | --- | --- | --- |
| `forest-lake.webp` — “Landscape-nature-forest-lake” | Pixel.la Free Stock Photos | [Flickr 24300004076](https://www.flickr.com/photos/137643065@N06/24300004076/) | [Commons file page](https://commons.wikimedia.org/wiki/File:Landscape-nature-forest-lake_(24300004076).jpg) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `tranquil-mountain-lake.webp` — “Tranquil mountain lake” | Andrew Spencer | [Unsplash g1GfGwh1FOg](https://unsplash.com/photos/g1GfGwh1FOg) | [Commons file page](https://commons.wikimedia.org/wiki/File:Tranquil_mountain_lake_(Unsplash).jpg) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the Commons record notes publication under CC0 before 5 June 2017) |

## Official reference material

- Wikimedia Commons [reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- MediaWiki API [Search](https://www.mediawiki.org/wiki/API:Search), [Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo), and [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette)
- [Bonjourr background documentation](https://bonjourr.fr/docs/customisation/backgrounds/) describes its separately selectable hosted-page background options, including its Unsplash-backed Daylight mode. Bonjourr's [Quick Links extension](https://bonjourr.fr/docs/widgets/quick-links/) is distinct from Surffish's local site-icon grid and is not installed here.

Surffish does not send local history or bookmarks to Bonjourr or Commons. The Bonjourr hosted start page remains an optional New Tab preference; its own remote background behavior applies only when that hosted page is selected.
