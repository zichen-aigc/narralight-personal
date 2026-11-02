# Third-party notices

## moov-faststart 1.0.4

- Source: `https://github.com/kevincharm/moov-faststart`
- Package: `moov-faststart@1.0.4` (exactly pinned in `local-platform/package-lock.json`)
- License: Apache License 2.0
- npm integrity: `sha512-IQs5pSzgU4Of9Yyvg4qcZB56u+yQTZUp5dicRvQiwAx24kxNHaaPqjERFrgvTxx4XV6SOeW7wOXyViesGiO2Gw==`
- Runtime use: lossless relocation of MP4 `moov` metadata for progressive local playback.

The published package has no runtime dependencies and no install, preinstall, or postinstall script. It was last published in 2019 and has a small maintainer base, so this project limits it to local MP4 objects no larger than 128 MiB, one media-preparation worker at a time, validates unchanged byte length, media payload, and non-offset movie metadata, and falls back to the original immutable object on failure. It is not approved here for files larger than 128 MiB or arbitrary filesystem paths.

