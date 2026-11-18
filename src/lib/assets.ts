import craftsmanshipLoomImg from '../assets/images/craftsmanship_loom_1795026586550.jpg';
import heroAtelierImg from '../assets/images/hero_pakistani_atelier_1795026585328.jpg';
import productFestiveSilkImg from '../assets/images/product_festive_silk_1795026586489.jpg';
import productGentsShalwarImg from '../assets/images/product_gents_shalwar_1795026587658.jpg';
import productLadiesLawnImg from '../assets/images/product_ladies_lawn_1795026585565.jpg';

export const ASSETS = {
  heroAtelier: heroAtelierImg,
  craftsmanshipLoom: craftsmanshipLoomImg,
  productLadiesLawn: productLadiesLawnImg,
  productGentsShalwar: productGentsShalwarImg,
  productFestiveSilk: productFestiveSilkImg,
};

const LEGACY_PATH_MAP: Record<string, string> = {
  '/src/assets/images/hero_pakistani_atelier_1795026585328.jpg': heroAtelierImg,
  '/src/assets/images/craftsmanship_loom_1795026586550.jpg': craftsmanshipLoomImg,
  '/src/assets/images/product_ladies_lawn_1795026585565.jpg': productLadiesLawnImg,
  '/src/assets/images/product_gents_shalwar_1795026587658.jpg': productGentsShalwarImg,
  '/src/assets/images/product_festive_silk_1795026586489.jpg': productFestiveSilkImg,
};

export function resolveAssetUrl(src?: string): string | undefined {
  if (!src) return undefined;
  if (LEGACY_PATH_MAP[src]) {
    return LEGACY_PATH_MAP[src];
  }
  if (src.startsWith('/src/assets/')) {
    return `${import.meta.env.BASE_URL}${src.slice(1)}`;
  }
  return src;
}
