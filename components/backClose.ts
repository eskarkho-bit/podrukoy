import { useEffect } from 'react';
import { BackHandler } from 'react-native';

// Системная кнопка «назад» на Android закрывает верхний слой, а не экран
// под ним. Навигация внутри вкладок живёт в useState, роутер о шторках и
// оверлеях не знает — поэтому каждый слой вешает свой обработчик, пока
// открыт. BackHandler зовёт слушателей с конца: вложенный слой монтируется
// позже родителя и перехватывает нажатие раньше него.
export function useBackClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [active, onClose]);
}
