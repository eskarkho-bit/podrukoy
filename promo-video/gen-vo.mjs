// Нейро-озвучка обоих роликов. Голос — Microsoft Dmitry Neural (русский),
// работает без ключей. Захотим Яндекс SpeechKit — фразы те же, меняется
// только функция synth() на вызов их REST API с ключом из окружения.
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Ударение в «До́мио» — комбинирующий акут, нейроголос его уважает
const PHRASES = {
  // «Башня»: медленный рассказчик
  b1: { text: 'Веками дом охраняла башня.', rate: '-15%' },
  b2: { text: 'Её строили мастера, которым доверяли.', rate: '-15%' },
  b3: { text: 'Башня осталась. И мастера — тоже.', rate: '-15%' },
  b4: {
    text: 'Опишите задачу — и проверенные мастера вашего города сами предложат цену.',
    rate: '-8%',
  },
  b5: { text: 'Оплата — только когда работа принята.', rate: '-12%' },
  b6: { text: 'До́мио. Дом под присмотром.', rate: '-18%' },
  // «Цена»: энергичнее, но без крика. Фразы короткие — хук должен остаться
  // быстрым, поэтому режем слова, а не растягиваем сцены сверх меры.
  t1: { text: 'Восемь тысяч — за смеситель.', rate: '+5%' },
  t2: { text: 'Не соглашайтесь на первую цену.', rate: '+0%' },
  t3: { text: 'Мастера сами пришлют цены. Смотрите, как цена падает.', rate: '+4%' },
  t4: { text: 'Почти пять тысяч разницы — цены конкурируют.', rate: '+2%' },
  t5: { text: 'Имя, стаж и рейтинг — вы знаете, кто придёт в дом.', rate: '+8%' },
  t6: { text: 'А оплата — только после приёмки.', rate: '+5%' },
  t7: { text: 'До́мио. Ссылка в профиле.', rate: '-5%' },
};

mkdirSync('public/vo', { recursive: true });

for (const [name, { text, rate }] of Object.entries(PHRASES)) {
  const dir = `public/vo/${name}`;
  mkdirSync(dir, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata('ru-RU-DmitryNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  // Библиотека кладёт audio.mp3 внутрь каталога — переносим в плоский файл
  await tts.toFile(dir, text, { rate });
  renameSync(`${dir}/audio.mp3`, `public/vo/${name}.mp3`);
  rmSync(dir, { recursive: true, force: true });
  console.log(name, 'готов');
}
console.log('Озвучка готова');
