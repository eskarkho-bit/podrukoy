// Единый дисплейный шрифт с кириллицей. Системным шрифтом заголовки не
// набираем — на разных машинах рендер разъезжается.
import { loadFont } from '@remotion/google-fonts/Montserrat';

const { fontFamily } = loadFont('normal', {
  weights: ['500', '600', '700', '800'],
  subsets: ['latin', 'cyrillic'],
});

export const displayFont = fontFamily;
