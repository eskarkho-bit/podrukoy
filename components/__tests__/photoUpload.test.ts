// Загрузка фото в Storage. SDK Firebase считает сетевые ошибки поправимыми и
// молча повторяет их до десяти минут — на экране это вечное «Сохраняем…».
// Тесты держат наш собственный предел ожидания: зависшая загрузка обязана
// превратиться в честную ошибку, а не в застывшую кнопку.

import { deleteObject, getDownloadURL, uploadBytes } from 'firebase/storage';
import { deleteVerificationPhoto, uploadOrderPhoto } from '../photoUpload';

// jest.mock поднимается выше импортов самим Jest — порядок здесь про читаемость
jest.mock('../../firebaseConfig', () => ({ storage: {} }));
jest.mock('firebase/storage', () => ({
  ref: jest.fn(() => ({})),
  uploadBytes: jest.fn(),
  getDownloadURL: jest.fn(),
  deleteObject: jest.fn(),
}));

const uploadBytesMock = uploadBytes as jest.Mock;
const getDownloadURLMock = getDownloadURL as jest.Mock;
const deleteObjectMock = deleteObject as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // expo-image-picker отдаёт локальный URI, который upload читает через fetch
  global.fetch = jest.fn(async () => ({
    blob: async () => ({ type: 'image/jpeg' }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

test('удачная загрузка возвращает постоянную ссылку', async () => {
  uploadBytesMock.mockResolvedValue(undefined);
  getDownloadURLMock.mockResolvedValue('https://example.com/photo.jpg');

  await expect(uploadOrderPhoto('order1', 'blob:local')).resolves.toBe(
    'https://example.com/photo.jpg',
  );
});

test('зависшая загрузка падает по своему сроку, а не висит вечно', async () => {
  jest.useFakeTimers();
  // Storage «завис»: промис не решается никогда — как при неподключённом бакете
  uploadBytesMock.mockReturnValue(new Promise(() => {}));

  const attempt = uploadOrderPhoto('order1', 'blob:local');
  const rejected = expect(attempt).rejects.toThrow('не уложилась');

  // Дать fetch и чтению blob провернуться до перевода часов
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  jest.advanceTimersByTime(30_000);

  await rejected;
});

test('ошибка Storage долетает до вызывающего, срок её не глотает', async () => {
  uploadBytesMock.mockRejectedValue(new Error('storage/unknown'));

  await expect(uploadOrderPhoto('order1', 'blob:local')).rejects.toThrow('storage/unknown');
});

test('удаление отсутствующего снимка — не ошибка', async () => {
  deleteObjectMock.mockRejectedValue(new Error('storage/object-not-found'));

  await expect(deleteVerificationPhoto('uid1')).resolves.toBeUndefined();
});
