# New Tab bundled fallback photos

Sockfish keeps two licensed CC0 landscape images in the renderer bundle as offline fallbacks for its local **New Tab** page. When a valid Wikimedia Commons photo cache is available, the page rotates those current photos; otherwise these local images keep the scenic background working without network access. Photo credits remain visible in the app when a fallback is active. CC0 permits copying, modification, and redistribution without attribution; credits are retained as good practice.

| Bundled fallback | Photo / creator | Original source | License record |
| --- | --- | --- | --- |
| `forest-lake.webp` | “Landscape-nature-forest-lake” — www.Pixel.la Free Stock Photos | [Flickr photo 24300004076](https://www.flickr.com/photos/137643065@N06/24300004076/) | [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Landscape-nature-forest-lake_(24300004076).jpg) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `tranquil-mountain-lake.webp` | “Tranquil mountain lake” — Andrew Spencer | [Unsplash photo g1GfGwh1FOg](https://unsplash.com/photos/g1GfGwh1FOg) | [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Tranquil_mountain_lake_(Unsplash).jpg) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the Commons record notes publication under CC0 before 5 June 2017) |

## Bonjourr comparison

[Bonjourr's official background documentation](https://bonjourr.fr/docs/customisation/backgrounds/) says its “Bonjourr Daylight” option uses the Unsplash API and four curated collections that vary by time of day; it also documents local files, remote URLs, Unsplash collections/search, and manual skip. Its [quick guide](https://bonjourr.fr/docs/quick-guide/) points users to Local files for personal backgrounds.

Sockfish keeps Bonjourr available as a selectable New Tab page. Its local New Tab normally uses a locally cached pair of licensed Commons photos and falls back to the two bundled CC0 images if the cache is empty or unavailable. The background rotation is local; browsing history and pinned-site data are never sent to Commons or Bonjourr. See [New Tab photo sources, licensing, and cache behavior](new-tab-photo-sources.md).

The repository also retains two earlier CC0 image assets (`waterfall.webp` and `lake-mountain.webp`); they are not part of the current renderer bundle.
