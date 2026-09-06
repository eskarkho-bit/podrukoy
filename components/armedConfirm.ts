import { useEffect, useRef, useState } from 'react';

// Двухшаговое подтверждение на одной кнопке («Отменить заявку» → «Точно
// отменить?»). Два защитных правила: сразу после взведения — короткая глухая
// пауза, чтобы случайный двойной тап не прошёл как «спросили и ответили»;
// вопрос без ответа не висит вечно — кнопка сама возвращается в исходное
// состояние, и следующее касание снова только спрашивает.
const ARM_DEADTIME_MS = 400;
const RESET_MS = 5000;

export function useArmedConfirm(onConfirm: () => void) {
  const [confirming, setConfirming] = useState(false);
  const armedAt = useRef(0);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), RESET_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  const press = () => {
    if (!confirming) {
      armedAt.current = Date.now();
      setConfirming(true);
      return;
    }
    if (Date.now() - armedAt.current < ARM_DEADTIME_MS) return;
    onConfirm();
  };

  return { confirming, press };
}
