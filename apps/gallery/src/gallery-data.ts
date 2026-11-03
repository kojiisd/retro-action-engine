/** What the gallery page shows. Built from site.json by vite.config.ts at build time. */
export interface GalleryCard {
  /** Relative to the gallery page, e.g. "play/2dsample/". */
  readonly href: string;
  readonly title: string;
  readonly description: string;
  /** Relative to the gallery page, e.g. "images/2dsample.svg". */
  readonly image: string;
  readonly imageAlt: string;
}

export interface GalleryData {
  readonly page: { readonly title: string; readonly heading: string; readonly lead: string };
  readonly cards: readonly GalleryCard[];
}

/** Relative links only, so the page works both at "/" and under a preview prefix. */
export function isRelativePath(path: string): boolean {
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(path) &&
    !path.split('/').includes('..')
  );
}
